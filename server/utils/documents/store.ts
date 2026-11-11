import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import { decodePublicId } from '~~/server/utils/custom-db-types'
import {
  DOCUMENT_ERROR_CODES,
  DOCUMENT_RENDER_LEASE_SECONDS,
} from '#shared/utils/documents'
import type {
  DocumentFileRef,
  DocumentStatusResponse,
} from '#shared/utils/documents'

type DbClient = ReturnType<typeof useDb>

export type DocumentRow = typeof schema.documents.$inferSelect
export type NewDocumentRow = typeof schema.documents.$inferInsert

export const DOCUMENT_STORAGE_PREFIX = 'documents'

const R2_BATCH_DELETE_LIMIT = 1000
const SAFE_KEY_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/

export interface InsertDocumentValues extends Omit<
  NewDocumentRow,
  'id' | 'createdAt' | 'updatedAt' | 'status' | 'specR2Key' | 'renderAttempts'
> {
  status?: NewDocumentRow['status']
}

export interface CreateDocumentInput extends InsertDocumentValues {
  specJson: string
}

export interface PutDocumentSpecResult {
  specR2Key: string
  specBytes: number
}

export interface ChatDocumentSummary {
  id: string
  format: DocumentRow['format']
  title: string | null
  status: DocumentRow['status']
  specVersion: number | null
  stats: DocumentRow['stats']
  fileId: string | null
  originMessagePublicId: string | null
  createdAt: Date
}

function assertPositiveInteger(value: number, label: string): void {
  if (Number.isSafeInteger(value) && value > 0) {
    return
  }

  throw createError({
    message: 'Invalid document storage key',
    status: 500,
    why: `${label} must be a positive safe integer, received ${value}`,
    fix: 'Pass the internal user id, never client input',
  })
}

function assertKeySegment(value: string, label: string): void {
  if (SAFE_KEY_SEGMENT_PATTERN.test(value)) {
    return
  }

  throw createError({
    message: 'Invalid document storage key',
    status: 500,
    why: `${label} is not a safe key segment`,
    fix: 'Pass the document public id returned by the database',
  })
}

function decodeDocumentId(documentId: string): number | null {
  if (!SAFE_KEY_SEGMENT_PATTERN.test(documentId)) {
    return null
  }

  try {
    const decoded = decodePublicId(documentId)

    return Number.isFinite(decoded) && decoded > 0 ? decoded : null
  } catch {
    return null
  }
}

function chunkItems<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

export function getDocumentUserPrefix(userId: number): string {
  assertPositiveInteger(userId, 'userId')

  return `${DOCUMENT_STORAGE_PREFIX}/${userId}/`
}

export function getDocumentSpecKey(
  userId: number,
  documentId: string,
  specVersion: number,
): string {
  assertKeySegment(documentId, 'documentId')
  assertPositiveInteger(specVersion, 'specVersion')

  return `${getDocumentUserPrefix(userId)}${documentId}/spec.v${specVersion}.json`
}

export async function putDocumentSpec(
  userId: number,
  documentId: string,
  specVersion: number,
  specJson: string,
): Promise<PutDocumentSpecResult> {
  const specR2Key = getDocumentSpecKey(userId, documentId, specVersion)
  const specBytes = new TextEncoder().encode(specJson).byteLength

  await useFileStorage().put(specR2Key, specJson, {
    httpMetadata: { contentType: 'application/json' },
  })

  return { specR2Key, specBytes }
}

export async function readDocumentSpec(
  specR2Key: string,
): Promise<string | null> {
  const object = await useFileStorage().get(specR2Key)

  if (!object) {
    return null
  }

  return object.text()
}

/**
 * Deletes spec objects in R2 batches, one `delete(chunk)` call per chunk of
 * at most 1000 keys, so a Worker never holds more than one R2 connection.
 */
export async function deleteDocumentSpecObjects(
  keys: string[],
): Promise<number> {
  const uniqueKeys = [...new Set(keys)]

  if (uniqueKeys.length === 0) {
    return 0
  }

  const storage = useFileStorage()

  for (const chunk of chunkItems(uniqueKeys, R2_BATCH_DELETE_LIMIT)) {
    await storage.delete(chunk)
  }

  return uniqueKeys.length
}

async function deleteSpecObjectBestEffort(specR2Key: string): Promise<void> {
  try {
    await deleteDocumentSpecObjects([specR2Key])
  } catch {
    return
  }
}

/**
 * Step one of creating a document: inserts the row without a spec key. The
 * public id is only known after the insert, so the R2 key is derived from the
 * returned row. Without an explicit `status` the row is stored as
 * `failed`/`spec_missing`, so nothing can claim it before step two
 * (`attachDocumentSpec`) has written the spec object.
 */
export async function insertDocumentRow(
  db: DbClient,
  values: InsertDocumentValues,
): Promise<DocumentRow> {
  const { status, ...rest } = values
  const isPending = status === undefined
  const [row] = await db.insert(schema.documents)
    .values({
      ...rest,
      status: status ?? 'failed',
      errorCode: isPending
        ? DOCUMENT_ERROR_CODES.specMissing
        : rest.errorCode,
    })
    .returning()

  return row!
}

/**
 * Step two: writes the spec object, then records its key and size and moves
 * the row to `spec_ready`. Returns null when the row is gone or not owned.
 */
export async function attachDocumentSpec(
  db: DbClient,
  input: {
    userId: number
    documentId: string
    specVersion: number
    specJson: string
  },
): Promise<DocumentRow | null> {
  const { specR2Key, specBytes } = await putDocumentSpec(
    input.userId,
    input.documentId,
    input.specVersion,
    input.specJson,
  )
  const [row] = await db.update(schema.documents)
    .set({
      specR2Key,
      specBytes,
      specVersion: input.specVersion,
      status: 'spec_ready',
      errorCode: sql`NULL`,
    })
    .where(and(
      eq(schema.documents.id, input.documentId),
      eq(schema.documents.userId, input.userId),
    ))
    .returning()

  return row ?? null
}

/**
 * Both steps in one call. When a step fails the half-created row is deleted
 * again, the spec object is deleted best effort (it may already be written
 * when only the row update failed) and the error is rethrown, so no row ever
 * points at a missing spec object and no spec object is left without a row.
 */
export async function createDocument(
  db: DbClient,
  input: CreateDocumentInput,
): Promise<DocumentRow> {
  const { specJson, ...values } = input
  const specVersion = values.specVersion ?? 1
  const inserted = await insertDocumentRow(db, { ...values, specVersion })

  try {
    const attached = await attachDocumentSpec(db, {
      userId: inserted.userId,
      documentId: inserted.id,
      specVersion,
      specJson,
    })

    if (!attached) {
      throw createError({
        message: 'Document row disappeared before its spec was stored',
        status: 500,
      })
    }

    return attached
  } catch (exception) {
    await deleteSpecObjectBestEffort(
      getDocumentSpecKey(inserted.userId, inserted.id, specVersion),
    )
    await db.delete(schema.documents)
      .where(and(
        eq(schema.documents.id, inserted.id),
        eq(schema.documents.userId, inserted.userId),
      ))

    throw exception
  }
}

export async function getOwnedDocument(
  db: DbClient,
  userId: number,
  documentId: string,
): Promise<DocumentRow | null> {
  if (decodeDocumentId(documentId) === null) {
    return null
  }

  const [row] = await db.select()
    .from(schema.documents)
    .where(and(
      eq(schema.documents.id, documentId),
      eq(schema.documents.userId, userId),
    ))
    .limit(1)

  return row ?? null
}

/**
 * Takes the render lease in one atomic UPDATE. Wins for a `spec_ready` or
 * `failed` row and for a `rendering` row whose lease has expired; returns
 * null when another caller holds a live lease, the row is `ready`, or it is
 * not owned by `userId`.
 */
export async function claimDocumentRender(
  db: DbClient,
  input: { userId: number, documentId: string, now?: Date },
): Promise<DocumentRow | null> {
  if (decodeDocumentId(input.documentId) === null) {
    return null
  }

  const now = input.now ?? new Date()
  const leaseUntil = new Date(
    now.getTime() + DOCUMENT_RENDER_LEASE_SECONDS * 1000,
  )
  const [row] = await db.update(schema.documents)
    .set({
      status: 'rendering',
      renderLeaseUntil: leaseUntil,
      renderAttempts: sql`${schema.documents.renderAttempts} + 1`,
    })
    .where(and(
      eq(schema.documents.id, input.documentId),
      eq(schema.documents.userId, input.userId),
      or(
        inArray(schema.documents.status, ['spec_ready', 'failed']),
        and(
          eq(schema.documents.status, 'rendering'),
          lt(schema.documents.renderLeaseUntil, now),
        ),
      ),
    ))
    .returning()

  return row ?? null
}

export interface DocumentClaim {
  renderLeaseUntil: Date
  renderAttempts: number
}

/**
 * Reads the identity of a claim from the row `claimDocumentRender` returned.
 * The lease end and the attempt counter together identify one claim: a later
 * claim of the same row always changes both.
 */
export function toDocumentClaim(
  row: Pick<DocumentRow, 'renderLeaseUntil' | 'renderAttempts'>,
): DocumentClaim {
  if (row.renderLeaseUntil === null) {
    throw createError({
      message: 'The document claim has no lease',
      status: 500,
      why: 'A claimed row must carry a render lease',
      fix: 'Pass the row returned by claimDocumentRender',
    })
  }

  return {
    renderLeaseUntil: row.renderLeaseUntil,
    renderAttempts: row.renderAttempts,
  }
}

function matchesClaim(documentId: string, claim: DocumentClaim) {
  return and(
    eq(schema.documents.id, documentId),
    eq(schema.documents.status, 'rendering'),
    eq(schema.documents.renderLeaseUntil, claim.renderLeaseUntil),
    eq(schema.documents.renderAttempts, claim.renderAttempts),
  )
}

/**
 * Completes a claimed render. The row only changes while the caller's own
 * claim (same lease end and attempt number) still holds it, so a caller whose
 * lease expired and was taken over cannot overwrite the new owner. Returns
 * null for a lost claim.
 */
export async function markDocumentReady(
  db: DbClient,
  input: {
    documentId: string
    claim: DocumentClaim
    fileId: string
    renderedBy: NonNullable<DocumentRow['renderedBy']>
  },
): Promise<DocumentRow | null> {
  const [row] = await db.update(schema.documents)
    .set({
      status: 'ready',
      fileId: input.fileId,
      renderedBy: input.renderedBy,
      errorCode: sql`NULL`,
      renderLeaseUntil: sql`NULL`,
    })
    .where(matchesClaim(input.documentId, input.claim))
    .returning()

  return row ?? null
}

/**
 * Records a failed render, only while the caller's own claim still holds the
 * row. Returns null for a lost claim, so a late failure never marks a row
 * that another caller is rendering or has finished.
 */
export async function markDocumentFailed(
  db: DbClient,
  input: { documentId: string, claim: DocumentClaim, errorCode: string },
): Promise<DocumentRow | null> {
  const [row] = await db.update(schema.documents)
    .set({
      status: 'failed',
      errorCode: input.errorCode,
      renderLeaseUntil: sql`NULL`,
    })
    .where(matchesClaim(input.documentId, input.claim))
    .returning()

  return row ?? null
}

/**
 * Gives the caller's own claim back without counting a failure, for a request
 * rejected before any rendering happened (for example an oversized upload).
 * Returns null when the claim was already lost or finished.
 */
export async function releaseDocumentClaim(
  db: DbClient,
  input: { documentId: string, claim: DocumentClaim },
): Promise<DocumentRow | null> {
  const [row] = await db.update(schema.documents)
    .set({
      status: 'spec_ready',
      renderLeaseUntil: sql`NULL`,
    })
    .where(matchesClaim(input.documentId, input.claim))
    .returning()

  return row ?? null
}

export function toDocumentStatusResponse(
  row: DocumentRow,
  file: DocumentFileRef | null,
): DocumentStatusResponse {
  return {
    id: row.id,
    format: row.format,
    title: row.title,
    status: row.status,
    file: file
      ? {
        id: file.id,
        storageKey: file.storageKey,
        name: file.name,
        size: file.size,
        type: file.type,
      }
      : null,
    renderedBy: row.renderedBy,
    errorCode: row.errorCode,
    stats: row.stats,
  }
}

/**
 * Newest documents of a chat, for the model context line and the context
 * panel. Only the owner's rows are returned.
 */
export async function listChatDocuments(
  db: DbClient,
  input: { userId: number, chatId: string, limit: number },
): Promise<ChatDocumentSummary[]> {
  return db.select({
    id: schema.documents.id,
    format: schema.documents.format,
    title: schema.documents.title,
    status: schema.documents.status,
    specVersion: schema.documents.specVersion,
    stats: schema.documents.stats,
    fileId: schema.documents.fileId,
    originMessagePublicId: schema.documents.originMessagePublicId,
    createdAt: schema.documents.createdAt,
  })
    .from(schema.documents)
    .where(and(
      eq(schema.documents.userId, input.userId),
      eq(schema.documents.originChatId, input.chatId),
    ))
    .orderBy(desc(schema.documents.createdAt), desc(schema.documents.id))
    .limit(Math.max(input.limit, 1))
}
