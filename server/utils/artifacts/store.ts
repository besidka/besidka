import type {
  ArtifactCreatedVia,
  ArtifactKind,
  ArtifactVersionContent,
  ArtifactVersionCreatedBy,
} from '#shared/utils/artifacts'
import type { BlobStore } from '~~/server/utils/platform/types'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { createError } from 'evlog'
import {
  ARTIFACT_KINDS,
  ARTIFACT_MAX_VERSIONS,
  ARTIFACT_TITLE_MAX,
  ARTIFACT_USER_QUOTA_BYTES,
  ARTIFACT_VERSION_MAX_BYTES,
} from '#shared/utils/artifacts'
import * as schema from '~~/server/db/schema'
import { decodePublicId, encodePublicId } from '~~/server/utils/custom-db-types'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { resolveServerLogger } from '~~/server/utils/files/logger'

type DbClient = ReturnType<typeof useDb>

export const ARTIFACT_CONTENT_TYPE = 'text/plain; charset=utf-8'
export const ARTIFACT_ID_CHUNK_SIZE = 90

export const ARTIFACT_ERROR_CODES = {
  tooLarge: 'artifact_too_large',
  quotaExceeded: 'artifact_quota_exceeded',
  versionCap: 'artifact_version_cap',
  versionConflict: 'artifact_version_conflict',
  notFound: 'artifact_not_found',
  contentMissing: 'artifact_content_missing',
  takenDown: 'artifact_taken_down',
  invalidInput: 'artifact_invalid_input',
  writeFailed: 'artifact_write_failed',
} as const

const BYTES_PER_MEGABYTE = 1024 * 1024

interface ArtifactStoreDeps {
  db: DbClient
  storage: BlobStore
  logger?: LoggerLike
}

export interface CreateArtifactInput extends ArtifactStoreDeps {
  userId: number
  kind: ArtifactKind
  title: string
  content: string
  originChatId?: string | null
  originMessageId?: string | null
  createdVia: ArtifactCreatedVia
  createdBy: ArtifactVersionCreatedBy
  modelId?: string | null
}

export interface AppendArtifactVersionInput extends ArtifactStoreDeps {
  userId: number
  artifactId: string
  content: string
  title?: string
  createdBy: ArtifactVersionCreatedBy
  modelId?: string | null
  expectedVersion?: number
}

export interface ArtifactWriteResult {
  artifactId: string
  version: number
  kind: ArtifactKind
  title: string
}

export interface ReadArtifactVersionInput {
  db: DbClient
  storage: BlobStore
  userId: number
  artifactId: string
  version?: number
}

export interface DeleteArtifactsInput extends ArtifactStoreDeps {
  userId: number
  artifactIds: string[]
  now?: Date
}

export interface DeleteArtifactsResult {
  deletedIds: string[]
  heldIds: string[]
  objectsDeleted: number
}

export function encodeArtifactId(id: number): string {
  return encodePublicId(id)
}

/**
 * Turns a public artifact id into the internal integer, or null for any
 * string Hashids cannot decode. Callers answer 404 on null, so a forged id
 * and another user's id look the same.
 */
export function decodeArtifactId(publicId: string): number | null {
  if (typeof publicId !== 'string' || !publicId) {
    return null
  }

  try {
    const id = decodePublicId(publicId)

    if (!Number.isSafeInteger(id) || id <= 0) {
      return null
    }

    return encodePublicId(id) === publicId ? id : null
  } catch {
    return null
  }
}

export function buildArtifactR2Key(
  userId: number,
  artifactId: number,
  version: number,
): string {
  return `artifacts/${userId}/${artifactId}/v${version}-${crypto.randomUUID()}`
}

export function createArtifactNotFoundError() {
  return createError({
    message: 'Artifact not found',
    status: 404,
    code: ARTIFACT_ERROR_CODES.notFound,
    why: 'No artifact with this id belongs to your account',
  })
}

function createInvalidInputError(why: string) {
  return createError({
    message: 'Invalid artifact',
    status: 400,
    code: ARTIFACT_ERROR_CODES.invalidInput,
    why,
  })
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / BYTES_PER_MEGABYTE).toFixed(2)} MB`
}

export function normalizeArtifactTitle(title: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim()

  if (!normalized) {
    throw createInvalidInputError('The title is empty')
  }

  if (normalized.length > ARTIFACT_TITLE_MAX) {
    throw createInvalidInputError(
      `The title is longer than ${ARTIFACT_TITLE_MAX} characters`,
    )
  }

  return normalized
}

/**
 * Encodes the content and enforces the per-version limit on its UTF-8 size,
 * which is what R2 stores and the quota counts.
 */
export function encodeArtifactContent(
  content: string,
): Uint8Array<ArrayBuffer> {
  if (typeof content !== 'string' || content.length === 0) {
    throw createInvalidInputError('The content is empty')
  }

  const bytes = new TextEncoder().encode(content)

  if (bytes.byteLength > ARTIFACT_VERSION_MAX_BYTES) {
    throw createError({
      message: 'This artifact is too large',
      status: 413,
      code: ARTIFACT_ERROR_CODES.tooLarge,
      why: `One version can be at most ${ARTIFACT_VERSION_MAX_BYTES} bytes, `
        + `this one is ${bytes.byteLength} bytes`,
      fix: 'Make the artifact smaller or split it into several artifacts',
    })
  }

  return bytes
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return Array.from(new Uint8Array(digest), (byte) => {
    return byte.toString(16).padStart(2, '0')
  }).join('')
}

export async function getArtifactUsageBytes(
  db: DbClient,
  userId: number,
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${schema.artifacts.totalBytes}), 0)`,
    })
    .from(schema.artifacts)
    .where(eq(schema.artifacts.userId, userId))

  return Number(row?.total ?? 0)
}

async function assertArtifactQuota(
  db: DbClient,
  userId: number,
  additionalBytes: number,
): Promise<void> {
  const usedBytes = await getArtifactUsageBytes(db, userId)

  if (usedBytes + additionalBytes <= ARTIFACT_USER_QUOTA_BYTES) {
    return
  }

  throw createError({
    message: 'Not enough artifact storage',
    status: 413,
    code: ARTIFACT_ERROR_CODES.quotaExceeded,
    why: `Artifacts use ${formatMegabytes(usedBytes)} of `
      + `${formatMegabytes(ARTIFACT_USER_QUOTA_BYTES)}, this version needs `
      + `${formatMegabytes(additionalBytes)} more`,
    fix: 'Delete artifacts in History → Artifacts',
  })
}

function createWriteFailedError() {
  return createError({
    message: 'Failed to save the artifact',
    status: 500,
    code: ARTIFACT_ERROR_CODES.writeFailed,
  })
}

async function rollbackObject(
  storage: BlobStore,
  key: string,
  logger: LoggerLike,
): Promise<void> {
  try {
    await storage.delete([key])
  } catch (exception) {
    logger.set({
      attributes: {
        artifacts: {
          rollback: 'r2-delete-failed',
          error: exceptionMessage(exception),
        },
      },
    })
  }
}

async function putArtifactObject(
  storage: BlobStore,
  key: string,
  bytes: Uint8Array,
  logger: LoggerLike,
): Promise<void> {
  try {
    await storage.put(key, bytes, { contentType: ARTIFACT_CONTENT_TYPE })
  } catch (exception) {
    logger.set({
      attributes: {
        artifacts: {
          write: 'r2-put-failed',
          error: exceptionMessage(exception),
        },
      },
    })

    throw createWriteFailedError()
  }
}

async function deleteArtifactHeader(
  db: DbClient,
  artifactId: number,
  logger: LoggerLike,
): Promise<void> {
  try {
    await db.delete(schema.artifacts).where(eq(schema.artifacts.id, artifactId))
  } catch (exception) {
    logger.set({
      attributes: {
        artifacts: {
          rollback: 'header-delete-failed',
          error: exceptionMessage(exception),
        },
      },
    })
  }
}

/**
 * Creates an artifact with its first immutable version. Order: size check,
 * quota check, a pending header row (`currentVersion` 0, invisible to every
 * reader and counting 0 bytes), R2 put, then the version row and the header
 * update in one D1 batch. A failure removes what was written; an invocation
 * killed mid-write leaves at most a pending header and its object, which no
 * reader shows and the quota does not count. The quota check is
 * read-then-write, so concurrent writes can overshoot the quota by one
 * version each (accepted, ticket A-1).
 */
export async function createArtifact(
  input: CreateArtifactInput,
): Promise<ArtifactWriteResult> {
  const logger = resolveServerLogger(input.logger)

  if (!(ARTIFACT_KINDS as readonly string[]).includes(input.kind)) {
    throw createInvalidInputError('Unknown artifact kind')
  }

  const title = normalizeArtifactTitle(input.title)
  const bytes = encodeArtifactContent(input.content)

  await assertArtifactQuota(input.db, input.userId, bytes.byteLength)

  const sha256 = await sha256Hex(bytes)
  const [header] = await input.db
    .insert(schema.artifacts)
    .values({
      userId: input.userId,
      originChatId: input.originChatId ?? undefined,
      originMessageId: input.originMessageId ?? null,
      kind: input.kind,
      title,
      currentVersion: 0,
      totalBytes: 0,
      createdVia: input.createdVia,
    })
    .returning({ id: schema.artifacts.id })

  if (!header) {
    throw createWriteFailedError()
  }

  const r2Key = buildArtifactR2Key(input.userId, header.id, 1)

  try {
    await putArtifactObject(input.storage, r2Key, bytes, logger)
  } catch (exception) {
    await deleteArtifactHeader(input.db, header.id, logger)

    throw exception
  }

  try {
    await input.db.batch([
      input.db.insert(schema.artifactVersions).values({
        artifactId: header.id,
        version: 1,
        r2Key,
        sha256,
        sizeBytes: bytes.byteLength,
        createdBy: input.createdBy,
        modelId: input.modelId ?? null,
      }),
      input.db.update(schema.artifacts)
        .set({ currentVersion: 1, totalBytes: bytes.byteLength })
        .where(eq(schema.artifacts.id, header.id)),
    ])
  } catch (exception) {
    logger.set({
      attributes: {
        artifacts: {
          write: 'version-insert-failed',
          error: exceptionMessage(exception),
        },
      },
    })

    await rollbackObject(input.storage, r2Key, logger)
    await deleteArtifactHeader(input.db, header.id, logger)

    throw createWriteFailedError()
  }

  return {
    artifactId: encodeArtifactId(header.id),
    version: 1,
    kind: input.kind,
    title,
  }
}

async function findOwnedArtifact(
  db: DbClient,
  userId: number,
  artifactId: number,
) {
  const [artifact] = await db
    .select()
    .from(schema.artifacts)
    .where(and(
      eq(schema.artifacts.id, artifactId),
      eq(schema.artifacts.userId, userId),
      gt(schema.artifacts.currentVersion, 0),
    ))
    .limit(1)

  return artifact
}

function assertNotTakenDown(artifact: { takedownAt: Date | null }) {
  if (!artifact.takedownAt) {
    return
  }

  throw createError({
    message: 'This artifact is unavailable',
    status: 451,
    code: ARTIFACT_ERROR_CODES.takenDown,
    why: 'The artifact was disabled after a report',
  })
}

function createVersionConflictError() {
  return createError({
    message: 'This artifact changed while it was being saved',
    status: 409,
    code: ARTIFACT_ERROR_CODES.versionConflict,
    why: 'Another write created a newer version first',
    fix: 'Read the artifact again and repeat the change',
  })
}

async function rollbackVersionRow(
  db: DbClient,
  artifactId: number,
  version: number,
  logger: LoggerLike,
): Promise<void> {
  try {
    await db.delete(schema.artifactVersions).where(and(
      eq(schema.artifactVersions.artifactId, artifactId),
      eq(schema.artifactVersions.version, version),
    ))
  } catch (exception) {
    logger.set({
      attributes: {
        artifacts: {
          rollback: 'version-delete-failed',
          error: exceptionMessage(exception),
        },
      },
    })
  }
}

/**
 * Writes a new immutable version. With `expectedVersion` the write is
 * refused (409 `artifact_version_conflict`) unless that is still the
 * current version, so an edit computed from an older version never
 * replaces a newer one. The header update is conditional on the version
 * read here and `(artifact_id, version)` is unique, so a concurrent writer
 * fails instead of overwriting; the R2 key carries a random suffix so the
 * loser never clobbers the winner's object. When the header update matches
 * no row (the artifact was deleted or moved on meanwhile), the version row
 * and object are removed again.
 */
export async function appendArtifactVersion(
  input: AppendArtifactVersionInput,
): Promise<ArtifactWriteResult> {
  const logger = resolveServerLogger(input.logger)
  const internalId = decodeArtifactId(input.artifactId)

  if (internalId === null) {
    throw createArtifactNotFoundError()
  }

  const artifact = await findOwnedArtifact(input.db, input.userId, internalId)

  if (!artifact) {
    throw createArtifactNotFoundError()
  }

  assertNotTakenDown(artifact)

  if (
    input.expectedVersion !== undefined
    && artifact.currentVersion !== input.expectedVersion
  ) {
    throw createVersionConflictError()
  }

  if (artifact.currentVersion >= ARTIFACT_MAX_VERSIONS) {
    throw createError({
      message: `This artifact has reached ${ARTIFACT_MAX_VERSIONS} versions`,
      status: 409,
      code: ARTIFACT_ERROR_CODES.versionCap,
      why: `An artifact keeps at most ${ARTIFACT_MAX_VERSIONS} versions`,
      fix: 'Create a new artifact',
    })
  }

  const title = input.title === undefined
    ? artifact.title
    : normalizeArtifactTitle(input.title)
  const bytes = encodeArtifactContent(input.content)

  await assertArtifactQuota(input.db, input.userId, bytes.byteLength)

  const version = artifact.currentVersion + 1
  const sha256 = await sha256Hex(bytes)
  const r2Key = buildArtifactR2Key(input.userId, internalId, version)

  await putArtifactObject(input.storage, r2Key, bytes, logger)

  let updatedHeaders: Array<{ id: number }>

  try {
    const [, updated] = await input.db.batch([
      input.db.insert(schema.artifactVersions).values({
        artifactId: internalId,
        version,
        r2Key,
        sha256,
        sizeBytes: bytes.byteLength,
        createdBy: input.createdBy,
        modelId: input.modelId ?? null,
      }),
      input.db.update(schema.artifacts)
        .set({
          currentVersion: version,
          totalBytes: sql`${schema.artifacts.totalBytes} + ${bytes.byteLength}`,
          title,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.artifacts.id, internalId),
          eq(schema.artifacts.userId, input.userId),
          eq(schema.artifacts.currentVersion, artifact.currentVersion),
        ))
        .returning({ id: schema.artifacts.id }),
    ])

    updatedHeaders = updated
  } catch (exception) {
    logger.set({
      attributes: {
        artifacts: {
          write: 'version-batch-failed',
          error: exceptionMessage(exception),
        },
      },
    })

    await rollbackObject(input.storage, r2Key, logger)

    const current = await findOwnedArtifact(
      input.db,
      input.userId,
      internalId,
    )

    if (current && current.currentVersion !== artifact.currentVersion) {
      throw createVersionConflictError()
    }

    throw createWriteFailedError()
  }

  if (updatedHeaders.length === 0) {
    await rollbackVersionRow(input.db, internalId, version, logger)
    await rollbackObject(input.storage, r2Key, logger)

    throw createVersionConflictError()
  }

  return {
    artifactId: input.artifactId,
    version,
    kind: artifact.kind,
    title,
  }
}

async function readObjectText(
  storage: BlobStore,
  key: string,
): Promise<string | null> {
  const object = await storage.get(key)

  if (!object) {
    return null
  }

  return await new Response(object.body).text()
}

/**
 * Reads one version (the current one by default) of an owned artifact.
 * 404 for an unknown or foreign id or version, 451 for an artifact taken
 * down after a report, 410 when the D1 row exists but its R2 object is gone
 * (for example after a D1 Time Travel restore).
 */
export async function readArtifactVersion(
  input: ReadArtifactVersionInput,
): Promise<ArtifactVersionContent> {
  const internalId = decodeArtifactId(input.artifactId)

  if (internalId === null) {
    throw createArtifactNotFoundError()
  }

  const artifact = await findOwnedArtifact(input.db, input.userId, internalId)

  if (!artifact) {
    throw createArtifactNotFoundError()
  }

  assertNotTakenDown(artifact)

  const version = input.version ?? artifact.currentVersion
  const [versionRow] = await input.db
    .select()
    .from(schema.artifactVersions)
    .where(and(
      eq(schema.artifactVersions.artifactId, internalId),
      eq(schema.artifactVersions.version, version),
    ))
    .limit(1)

  if (!versionRow) {
    throw createArtifactNotFoundError()
  }

  const content = await readObjectText(input.storage, versionRow.r2Key)

  if (content === null) {
    throw createError({
      message: 'The content of this artifact is missing',
      status: 410,
      code: ARTIFACT_ERROR_CODES.contentMissing,
      why: 'The stored object of this version no longer exists',
    })
  }

  return {
    artifactId: input.artifactId,
    kind: artifact.kind,
    title: artifact.title,
    version: versionRow.version,
    content,
    sizeBytes: versionRow.sizeBytes,
    createdAt: versionRow.createdAt.toISOString(),
  }
}

function chunkIds<T>(ids: T[]): T[][] {
  const chunks: T[][] = []

  for (let offset = 0; offset < ids.length; offset += ARTIFACT_ID_CHUNK_SIZE) {
    chunks.push(ids.slice(offset, offset + ARTIFACT_ID_CHUNK_SIZE))
  }

  return chunks
}

/**
 * Deletes owned artifacts: R2 objects first (one batch call per 1000 keys
 * through `BlobStore.delete`), then the versions, shares, viewer storage and
 * artifact rows in one D1 batch per id chunk. Artifacts under a legal hold
 * (`legalHoldUntil` in the future) are skipped entirely and reported in
 * `heldIds`. `artifact_reports` rows are never deleted here; the retention
 * sweep removes them. Unknown and foreign ids are ignored.
 */
export async function deleteArtifacts(
  input: DeleteArtifactsInput,
): Promise<DeleteArtifactsResult> {
  const now = input.now ?? new Date()
  const internalIds = [...new Set(input.artifactIds
    .map(decodeArtifactId)
    .filter((id): id is number => id !== null))]

  return deleteArtifactsByInternalIds({
    db: input.db,
    storage: input.storage,
    userId: input.userId,
    internalIds,
    now,
    logger: input.logger,
  })
}

async function deleteArtifactsByInternalIds(input: {
  db: DbClient
  storage: BlobStore
  userId: number
  internalIds: number[]
  now: Date
  logger?: LoggerLike
}): Promise<DeleteArtifactsResult> {
  const result: DeleteArtifactsResult = {
    deletedIds: [],
    heldIds: [],
    objectsDeleted: 0,
  }

  for (const chunk of chunkIds(input.internalIds)) {
    const owned = await input.db
      .select({
        id: schema.artifacts.id,
        legalHoldUntil: schema.artifacts.legalHoldUntil,
      })
      .from(schema.artifacts)
      .where(and(
        eq(schema.artifacts.userId, input.userId),
        inArray(schema.artifacts.id, chunk),
      ))
    const deletable: number[] = []

    const held: number[] = []

    for (const artifact of owned) {
      if (artifact.legalHoldUntil && artifact.legalHoldUntil > input.now) {
        held.push(artifact.id)
      } else {
        deletable.push(artifact.id)
      }
    }

    if (held.length > 0) {
      await input.db.update(schema.artifactShares)
        .set({ revokedAt: input.now })
        .where(and(
          inArray(schema.artifactShares.artifactId, held),
          isNull(schema.artifactShares.revokedAt),
        ))
      result.heldIds.push(...held.map(encodeArtifactId))
    }

    if (deletable.length === 0) {
      continue
    }

    const versions = await input.db
      .select({ r2Key: schema.artifactVersions.r2Key })
      .from(schema.artifactVersions)
      .where(inArray(schema.artifactVersions.artifactId, deletable))
    const keys = versions.map((version) => {
      return version.r2Key
    })

    if (keys.length > 0) {
      await input.storage.delete(keys)
    }

    await input.db.batch([
      input.db.delete(schema.artifactVersions)
        .where(inArray(schema.artifactVersions.artifactId, deletable)),
      input.db.delete(schema.artifactShares)
        .where(inArray(schema.artifactShares.artifactId, deletable)),
      input.db.delete(schema.artifactStorage)
        .where(inArray(schema.artifactStorage.artifactId, deletable)),
      input.db.delete(schema.artifacts)
        .where(and(
          eq(schema.artifacts.userId, input.userId),
          inArray(schema.artifacts.id, deletable),
        )),
    ])

    result.objectsDeleted += keys.length
    result.deletedIds.push(...deletable.map(encodeArtifactId))
  }

  return result
}

/**
 * Keeps the artifacts of deleted chats in the user's library: their
 * `originChatId` becomes null, `originMessageId` stays. Must run before the
 * chat rows go and must not swallow errors.
 */
export async function detachArtifactsFromChats(input: {
  db: DbClient
  userId: number
  chatIds: string[]
}): Promise<number> {
  let detached = 0

  for (const chunk of chunkIds([...new Set(input.chatIds)])) {
    const rows = await input.db.update(schema.artifacts)
      .set({ originChatId: sql`NULL` })
      .where(and(
        eq(schema.artifacts.userId, input.userId),
        inArray(schema.artifacts.originChatId, chunk),
      ))
      .returning({ id: schema.artifacts.id })

    detached += rows.length
  }

  return detached
}

export interface PurgeUserArtifactsResult {
  artifactsDeleted: number
  artifactsHeld: number
  artifactObjectsDeleted: number
  artifactViewerStorageDeleted: number
}

/**
 * Account deletion: removes the user's own viewer storage on any artifact,
 * then every artifact the user owns (R2 objects first) except those under a
 * legal hold. Errors are rethrown so the account deletion aborts and stays
 * retryable.
 */
export async function purgeUserArtifacts(input: {
  db: DbClient
  storage: BlobStore
  userId: number
  now?: Date
  logger?: LoggerLike
}): Promise<PurgeUserArtifactsResult> {
  const now = input.now ?? new Date()
  const viewerStorage = await input.db.delete(schema.artifactStorage)
    .where(eq(schema.artifactStorage.viewerUserId, input.userId))
    .returning({ key: schema.artifactStorage.key })
  const owned = await input.db
    .select({ id: schema.artifacts.id })
    .from(schema.artifacts)
    .where(eq(schema.artifacts.userId, input.userId))
  const deletion = await deleteArtifactsByInternalIds({
    db: input.db,
    storage: input.storage,
    userId: input.userId,
    internalIds: owned.map((artifact) => {
      return artifact.id
    }),
    now,
    logger: input.logger,
  })

  return {
    artifactsDeleted: deletion.deletedIds.length,
    artifactsHeld: deletion.heldIds.length,
    artifactObjectsDeleted: deletion.objectsDeleted,
    artifactViewerStorageDeleted: viewerStorage.length,
  }
}
