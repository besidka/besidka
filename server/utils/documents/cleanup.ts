import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import { DOCUMENT_ERROR_CODES } from '#shared/utils/documents'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  deleteDocumentSpecObjects,
  getDocumentUserPrefix,
} from '~~/server/utils/documents/store'

type DbClient = ReturnType<typeof useDb>

const MAX_BATCH_QUERY_PARAMS = 90
const ORPHAN_SWEEP_BATCH_LIMIT = 200
const ORPHAN_SWEEP_GRACE_SECONDS = 24 * 60 * 60
const LIST_PAGE_LIMIT = 1000

type CleanupPhase
  = | 'file-delete'
    | 'chat-delete'
    | 'message-delete'
    | 'sweep'
    | 'purge'

interface CleanupRow {
  id: string
  specR2Key: string | null
  fileId: string | null
}

export interface DocumentCleanupResult {
  rowsFound: number
  rowsDeleted: number
  rowsDetached: number
  specObjectsDeleted: number
  specDeleteFailed: boolean
}

export interface PurgeUserDocumentsResult {
  documentsDeleted: number
  documentObjectsDeleted: number
}

export interface SweepOrphanedDocumentsOptions {
  now?: Date
  graceSeconds?: number
  limit?: number
}

function chunkItems<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

function createEmptyResult(): DocumentCleanupResult {
  return {
    rowsFound: 0,
    rowsDeleted: 0,
    rowsDetached: 0,
    specObjectsDeleted: 0,
    specDeleteFailed: false,
  }
}

function recordCleanup(
  logger: LoggerLike,
  phase: CleanupPhase,
  result: DocumentCleanupResult,
  errorMessage?: string,
): void {
  logger.set({
    attributes: {
      documents: {
        cleanup: {
          [phase]: {
            ...result,
            ...(errorMessage ? { error: errorMessage } : {}),
          },
        },
      },
    },
  })
}

function collectSpecKeys(rows: CleanupRow[]): string[] {
  return rows
    .map((row) => {
      return row.specR2Key
    })
    .filter((key): key is string => {
      return key !== null
    })
}

async function tryDeleteSpecObjects(
  rows: CleanupRow[],
  result: DocumentCleanupResult,
): Promise<boolean> {
  const keys = collectSpecKeys(rows)

  try {
    result.specObjectsDeleted += await deleteDocumentSpecObjects(keys)

    return true
  } catch {
    result.specDeleteFailed = true

    return false
  }
}

async function detachRowsFromOrigin(
  db: DbClient,
  userId: number,
  rowIds: string[],
  extra: Partial<typeof schema.documents.$inferInsert> = {},
): Promise<number> {
  let detached = 0

  for (const chunk of chunkItems(rowIds, MAX_BATCH_QUERY_PARAMS)) {
    const rows = await db.update(schema.documents)
      .set({
        title: null,
        originChatId: sql`NULL`,
        originMessageId: null,
        originMessagePublicId: null,
        ...extra,
      })
      .where(and(
        eq(schema.documents.userId, userId),
        inArray(schema.documents.id, chunk),
      ))
      .returning({ id: schema.documents.id })

    detached += rows.length
  }

  return detached
}

async function deleteRowsById(
  db: DbClient,
  userId: number,
  rowIds: string[],
): Promise<number> {
  let deleted = 0

  for (const chunk of chunkItems(rowIds, MAX_BATCH_QUERY_PARAMS)) {
    const rows = await db.delete(schema.documents)
      .where(and(
        eq(schema.documents.userId, userId),
        inArray(schema.documents.id, chunk),
      ))
      .returning({ id: schema.documents.id })

    deleted += rows.length
  }

  return deleted
}

/**
 * Applies the chat or message deletion rule to origin rows. A row without a
 * file goes away with its spec object. A row whose file survives (the file is
 * still referenced elsewhere) keeps the spec, because spec lifetime equals
 * file lifetime, but loses its title and every link to the deleted origin.
 * When the spec object cannot be deleted the row is detached as a failed
 * orphan instead of deleted, so the sweep retries the object delete.
 */
async function resolveOriginRows(
  db: DbClient,
  userId: number,
  rows: CleanupRow[],
  result: DocumentCleanupResult,
): Promise<void> {
  const withoutFile = rows.filter((row) => {
    return row.fileId === null
  })
  const withFile = rows.filter((row) => {
    return row.fileId !== null
  })

  if (withoutFile.length > 0) {
    const isSpecDeleted = await tryDeleteSpecObjects(withoutFile, result)
    const rowIds = withoutFile.map((row) => {
      return row.id
    })

    if (isSpecDeleted) {
      result.rowsDeleted += await deleteRowsById(db, userId, rowIds)
    } else {
      result.rowsDetached += await detachRowsFromOrigin(db, userId, rowIds, {
        status: 'failed',
      })
    }
  }

  if (withFile.length > 0) {
    result.rowsDetached += await detachRowsFromOrigin(
      db,
      userId,
      withFile.map((row) => {
        return row.id
      }),
    )
  }
}

/**
 * Files are gone (retention, bulk or single delete, orphaned by a chat
 * delete): the spec objects of their documents are deleted and the rows are
 * kept as `failed`/`file_deleted` with no title and no file, because a
 * persisted `data-document` part (a branch copy included) may still point at
 * the id and shows "unavailable". Best effort, never throws: the file delete
 * has already happened.
 */
export async function cleanupDocumentsForDeletedFiles(
  db: DbClient,
  input: { userId: number, fileIds: string[], logger: LoggerLike },
): Promise<DocumentCleanupResult> {
  const result = createEmptyResult()

  try {
    for (const chunk of chunkItems(
      [...new Set(input.fileIds)],
      MAX_BATCH_QUERY_PARAMS,
    )) {
      const rows = await db.select({
        id: schema.documents.id,
        specR2Key: schema.documents.specR2Key,
        fileId: schema.documents.fileId,
      })
        .from(schema.documents)
        .where(and(
          eq(schema.documents.userId, input.userId),
          inArray(schema.documents.fileId, chunk),
        ))

      if (rows.length === 0) {
        continue
      }

      result.rowsFound += rows.length

      const isSpecDeleted = await tryDeleteSpecObjects(rows, result)
      const rowIds = rows.map((row) => {
        return row.id
      })

      for (const idChunk of chunkItems(rowIds, MAX_BATCH_QUERY_PARAMS)) {
        const updated = await db.update(schema.documents)
          .set({
            title: null,
            status: 'failed',
            errorCode: DOCUMENT_ERROR_CODES.fileDeleted,
            fileId: sql`NULL`,
            renderLeaseUntil: null,
            ...(isSpecDeleted ? { specR2Key: null, specBytes: null } : {}),
          })
          .where(and(
            eq(schema.documents.userId, input.userId),
            inArray(schema.documents.id, idChunk),
          ))
          .returning({ id: schema.documents.id })

        result.rowsDetached += updated.length
      }
    }
  } catch (exception) {
    recordCleanup(
      input.logger,
      'file-delete',
      result,
      exceptionMessage(exception),
    )

    return result
  }

  if (result.rowsFound > 0) {
    recordCleanup(input.logger, 'file-delete', result)
  }

  return result
}

/**
 * Chats are deleted. Must run after the chats' orphaned files were cleaned up
 * (those rows then have no file and are deleted outright). Best effort,
 * never throws.
 */
export async function cleanupDocumentsForDeletedChats(
  db: DbClient,
  input: { userId: number, chatIds: string[], logger: LoggerLike },
): Promise<DocumentCleanupResult> {
  const result = createEmptyResult()

  try {
    for (const chunk of chunkItems(
      [...new Set(input.chatIds)],
      MAX_BATCH_QUERY_PARAMS,
    )) {
      const rows = await db.select({
        id: schema.documents.id,
        specR2Key: schema.documents.specR2Key,
        fileId: schema.documents.fileId,
      })
        .from(schema.documents)
        .where(and(
          eq(schema.documents.userId, input.userId),
          inArray(schema.documents.originChatId, chunk),
        ))

      result.rowsFound += rows.length

      await resolveOriginRows(db, input.userId, rows, result)
    }
  } catch (exception) {
    recordCleanup(
      input.logger,
      'chat-delete',
      result,
      exceptionMessage(exception),
    )

    return result
  }

  if (result.rowsFound > 0) {
    recordCleanup(input.logger, 'chat-delete', result)
  }

  return result
}

/**
 * One message is deleted. Matches a document by the integer message id or by
 * the message public id (a row keeps only the public id until its file is
 * persisted). Same rule as a chat delete. Best effort, never throws.
 */
export async function cleanupDocumentsForDeletedMessage(
  db: DbClient,
  input: {
    userId: number
    messageRowId: number | null
    messagePublicId: string | null
    logger: LoggerLike
  },
): Promise<DocumentCleanupResult> {
  const result = createEmptyResult()
  const originConditions = []

  if (input.messageRowId !== null) {
    originConditions.push(
      eq(schema.documents.originMessageId, input.messageRowId),
    )
  }

  if (input.messagePublicId !== null) {
    originConditions.push(
      eq(schema.documents.originMessagePublicId, input.messagePublicId),
    )
  }

  if (originConditions.length === 0) {
    return result
  }

  try {
    const rows = await db.select({
      id: schema.documents.id,
      specR2Key: schema.documents.specR2Key,
      fileId: schema.documents.fileId,
    })
      .from(schema.documents)
      .where(and(
        eq(schema.documents.userId, input.userId),
        or(...originConditions),
      ))

    result.rowsFound += rows.length

    await resolveOriginRows(db, input.userId, rows, result)
  } catch (exception) {
    recordCleanup(
      input.logger,
      'message-delete',
      result,
      exceptionMessage(exception),
    )

    return result
  }

  if (result.rowsFound > 0) {
    recordCleanup(input.logger, 'message-delete', result)
  }

  return result
}

/**
 * Removes failed rows that no file and no chat can reach any more (a failed
 * file-deleted row whose chat is gone, an MCP document that never rendered).
 * Rows younger than the grace period stay, so a retry of a fresh failure is
 * not lost. A row whose spec object cannot be deleted is kept for the next
 * run. Best effort, never throws.
 */
export async function sweepOrphanedDocuments(
  db: DbClient,
  logger: LoggerLike,
  options: SweepOrphanedDocumentsOptions = {},
): Promise<DocumentCleanupResult> {
  const result = createEmptyResult()
  const now = options.now ?? new Date()
  const graceSeconds = options.graceSeconds ?? ORPHAN_SWEEP_GRACE_SECONDS
  const cutoff = new Date(now.getTime() - graceSeconds * 1000)

  try {
    const rows = await db.select({
      id: schema.documents.id,
      userId: schema.documents.userId,
      specR2Key: schema.documents.specR2Key,
      fileId: schema.documents.fileId,
    })
      .from(schema.documents)
      .where(and(
        isNull(schema.documents.fileId),
        isNull(schema.documents.originChatId),
        eq(schema.documents.status, 'failed'),
        lt(schema.documents.updatedAt, cutoff),
      ))
      .limit(options.limit ?? ORPHAN_SWEEP_BATCH_LIMIT)

    result.rowsFound = rows.length

    if (rows.length > 0 && await tryDeleteSpecObjects(rows, result)) {
      const rowIdsByUser = new Map<number, string[]>()

      for (const row of rows) {
        const rowIds = rowIdsByUser.get(row.userId) ?? []

        rowIds.push(row.id)
        rowIdsByUser.set(row.userId, rowIds)
      }

      for (const [userId, rowIds] of rowIdsByUser) {
        result.rowsDeleted += await deleteRowsById(db, userId, rowIds)
      }
    }
  } catch (exception) {
    recordCleanup(logger, 'sweep', result, exceptionMessage(exception))

    return result
  }

  if (result.rowsFound > 0) {
    recordCleanup(logger, 'sweep', result)
  }

  return result
}

/**
 * Deletes every R2 object under `documents/<userId>/`, one listed page at a
 * time with one batched delete per page. `getDocumentUserPrefix` only accepts
 * a positive integer user id, so the delete cannot widen beyond one user.
 */
async function deleteUserSpecPrefix(userId: number): Promise<number> {
  const prefix = getDocumentUserPrefix(userId)

  const storage = useFileStorage()
  let objectsDeleted = 0
  let cursor: string | undefined

  do {
    const page = await storage.list({
      prefix,
      cursor,
      limit: LIST_PAGE_LIMIT,
    })
    const keys = page.objects.map((object) => {
      return object.key
    })

    if (keys.length > 0) {
      await storage.delete(keys)

      objectsDeleted += keys.length
    }

    if (page.truncated && !page.cursor) {
      throw createError({
        message: 'Document purge stopped before listing finished',
        status: 500,
        why: `R2 reported a truncated page under "${prefix}" without a cursor`,
        fix: 'Retry the purge; the remaining objects were not deleted',
      })
    }

    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  return objectsDeleted
}

/**
 * Account deletion. The `documents` table has no foreign key to `users`, so
 * the rows are deleted explicitly, after every spec object under the user's
 * prefix. Errors are rethrown so the account deletion aborts and stays
 * retryable instead of leaving spec objects behind.
 */
export async function purgeUserDocuments(
  db: DbClient,
  userId: number,
  logger: LoggerLike,
): Promise<PurgeUserDocumentsResult> {
  const documentObjectsDeleted = await deleteUserSpecPrefix(userId)
  const deletedRows = await db.delete(schema.documents)
    .where(eq(schema.documents.userId, userId))
    .returning({ id: schema.documents.id })
  const result = {
    documentsDeleted: deletedRows.length,
    documentObjectsDeleted,
  }

  recordCleanup(
    logger,
    'purge',
    {
      ...createEmptyResult(),
      rowsFound: result.documentsDeleted,
      rowsDeleted: result.documentsDeleted,
      specObjectsDeleted: result.documentObjectsDeleted,
    },
  )

  return result
}
