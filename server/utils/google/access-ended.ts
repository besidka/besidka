import { and, eq, inArray, isNotNull, ne, notExists, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { R2Bucket } from '@cloudflare/workers-types'
import { GOOGLE_EXTERNAL_SOURCES } from '#shared/utils/google-data-policy'
import { withDerivedKeys } from '#shared/utils/office-files'
import * as schema from '~~/server/db/schema'
import { invalidateStorageCache } from '~~/server/api/v1/storage/index.get'
import { cleanupDocumentsForDeletedFiles } from '~~/server/utils/documents/cleanup'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { invalidateFileCache } from '~~/server/utils/files/convert-files-for-ai'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  findKnowledgeProjectIdsForFiles,
  findKnowledgeTextTargetsForFile,
} from '~~/server/utils/knowledge/linked-files'
import type { KnowledgeTextTarget } from '~~/server/utils/knowledge/linked-files'
import { deleteKnowledgeItemTexts } from '~~/server/utils/knowledge/text-store'
import { bumpKnowledgeVersion } from '~~/server/utils/knowledge/version'

type DbClient = ReturnType<typeof useDb>
type FileStorage = Pick<R2Bucket, 'delete'>

export const GOOGLE_FILE_CLEANUP_BATCH_SIZE = 50
export const GOOGLE_FILE_CLEANUP_MAX_BATCHES = 20
export const GOOGLE_SWEEP_USER_LIMIT = 25

const googleSources = [...GOOGLE_EXTERNAL_SOURCES]

export interface GoogleFileCleanupResult {
  deleted: number
  complete: boolean
}

export interface GoogleAccessEndedResult extends GoogleFileCleanupResult {
  skipped: boolean
}

export interface GoogleAccessEndedSweepResult {
  tokensCleared: number
  usersCleaned: number
  filesDeleted: number
  incompleteUsers: number
  revokedRowsDeleted: number
}

interface CleanupInput {
  db: DbClient
  userId: number
  logger: LoggerLike
  storage?: FileStorage
}

function logCleanup(logger: LoggerLike, values: Record<string, unknown>) {
  logger.set({ attributes: { googleAccessEnded: values } })
}

function isGoogleFileOf(userId: number) {
  return and(
    eq(schema.files.userId, userId),
    inArray(schema.files.externalSource, googleSources),
  )
}

async function collectKnowledgeTargets(
  userId: number,
  fileIds: string[],
  logger: LoggerLike,
): Promise<{ projectIds: number[], targets: KnowledgeTextTarget[] }> {
  try {
    const projectIds = await findKnowledgeProjectIdsForFiles(userId, fileIds)
    const targets: KnowledgeTextTarget[] = []

    if (projectIds.length === 0) {
      return { projectIds, targets }
    }

    for (const fileId of fileIds) {
      targets.push(...await findKnowledgeTextTargetsForFile(userId, fileId))
    }

    return { projectIds, targets }
  } catch (exception) {
    logCleanup(logger, {
      phase: 'knowledge-collect',
      userId,
      error: exceptionMessage(exception),
    })

    return { projectIds: [], targets: [] }
  }
}

async function deleteKnowledgeTargets(
  userId: number,
  projectIds: number[],
  targets: KnowledgeTextTarget[],
  logger: LoggerLike,
): Promise<void> {
  const itemIdsByProject = new Map<number, number[]>()

  for (const target of targets) {
    const itemIds = itemIdsByProject.get(target.projectId) ?? []

    itemIds.push(target.itemId)
    itemIdsByProject.set(target.projectId, itemIds)
  }

  try {
    for (const [projectId, itemIds] of itemIdsByProject) {
      await deleteKnowledgeItemTexts({ userId, projectId, itemIds })
    }

    await bumpKnowledgeVersion(projectIds)
  } catch (exception) {
    logCleanup(logger, {
      phase: 'knowledge-delete',
      userId,
      error: exceptionMessage(exception),
    })
  }
}

/**
 * Deletes every file of a user whose `external_source` is a Google source:
 * in batches of 50, one R2 batch delete per batch (with the derived Office
 * text keys), then the KV file cache one key at a time, the D1 rows, the
 * documents that pointed at them and the knowledge text objects the row
 * cascade would orphan. An R2 failure stops before D1 so the rows stay
 * and the hourly sweep retries; `complete` is false then, and also when
 * more than 20 batches remain. Logs ids and counts only, never names.
 */
export async function deleteGoogleDerivedFiles(
  input: CleanupInput,
): Promise<GoogleFileCleanupResult> {
  const { db, userId, logger } = input
  const storage = input.storage ?? useFileStorage()
  let deleted = 0
  let complete = false

  for (let batch = 0; batch < GOOGLE_FILE_CLEANUP_MAX_BATCHES; batch++) {
    const rows = await db
      .select({ id: schema.files.id, storageKey: schema.files.storageKey })
      .from(schema.files)
      .where(isGoogleFileOf(userId))
      .limit(GOOGLE_FILE_CLEANUP_BATCH_SIZE)

    if (rows.length === 0) {
      complete = true

      break
    }

    const fileIds = rows.map(row => row.id)
    const storageKeys = rows.map(row => row.storageKey)
    const knowledge = await collectKnowledgeTargets(userId, fileIds, logger)

    try {
      await storage.delete(withDerivedKeys(storageKeys))
    } catch (exception) {
      logCleanup(logger, {
        phase: 'storage-delete',
        userId,
        fileCount: rows.length,
        error: exceptionMessage(exception),
      })

      break
    }

    for (const storageKey of storageKeys) {
      await invalidateFileCache(storageKey, logger)
    }

    await db
      .delete(schema.files)
      .where(and(
        eq(schema.files.userId, userId),
        inArray(schema.files.id, fileIds),
      ))

    await cleanupDocumentsForDeletedFiles(db, { userId, fileIds, logger })
    await deleteKnowledgeTargets(
      userId,
      knowledge.projectIds,
      knowledge.targets,
      logger,
    )

    deleted += rows.length
  }

  if (deleted > 0) {
    await invalidateStorageCache(userId, logger)
  }

  return { deleted, complete }
}

export async function hasOtherActiveGoogleConnection(
  db: DbClient,
  userId: number,
  excludeConnectionId: string | null,
): Promise<boolean> {
  const conditions = [
    eq(schema.googleConnections.userId, userId),
    eq(schema.googleConnections.status, 'active'),
  ]

  if (excludeConnectionId) {
    conditions.push(ne(schema.googleConnections.id, excludeConnectionId))
  }

  const [row] = await db
    .select({ id: schema.googleConnections.id })
    .from(schema.googleConnections)
    .where(and(...conditions))
    .limit(1)

  return !!row
}

/**
 * Runs when Google access ends for one connection: the user disconnected,
 * a refresh returned `invalid_grant`, or a different Google account
 * replaced it. Files carry no client mode, so the copies are deleted only
 * when no other connection of the user is still active; otherwise they
 * stay with that connection and the call reports `skipped`.
 */
export async function cleanupAfterGoogleAccessEnded(
  input: CleanupInput & { connectionId: string | null },
): Promise<GoogleAccessEndedResult> {
  const otherActive = await hasOtherActiveGoogleConnection(
    input.db,
    input.userId,
    input.connectionId,
  )

  if (otherActive) {
    logCleanup(input.logger, {
      phase: 'skipped-other-active',
      userId: input.userId,
    })

    return { skipped: true, deleted: 0, complete: true }
  }

  const result = await deleteGoogleDerivedFiles(input)

  logCleanup(input.logger, {
    phase: 'files-deleted',
    userId: input.userId,
    deleted: result.deleted,
    complete: result.complete,
  })

  return { skipped: false, ...result }
}

/**
 * The hourly backup for access that ended without a finished cleanup:
 * clears any token left on a row that is not active, deletes the Google
 * copies of every user (25 per run) who has Google files and no active
 * connection, and deletes `revoked` rows once nothing of theirs is left
 * to clean. A user with an active connection is never touched, so a
 * lingering row of one mode cannot delete the copies of another.
 */
export async function sweepGoogleAccessEnded(input: {
  db: DbClient
  logger: LoggerLike
  storage?: FileStorage
  userLimit?: number
}): Promise<GoogleAccessEndedSweepResult> {
  const { db, logger } = input
  const connections = schema.googleConnections
  const activeConnection = alias(schema.googleConnections, 'active_connection')
  const result: GoogleAccessEndedSweepResult = {
    tokensCleared: 0,
    usersCleaned: 0,
    filesDeleted: 0,
    incompleteUsers: 0,
    revokedRowsDeleted: 0,
  }

  const cleared = await db
    .update(connections)
    .set({ accessToken: null, refreshToken: null, accessTokenExpiresAt: null })
    .where(and(
      ne(connections.status, 'active'),
      or(
        isNotNull(connections.accessToken),
        isNotNull(connections.refreshToken),
      ),
    ))
    .returning({ id: connections.id })

  result.tokensCleared = cleared.length

  const users = await db
    .selectDistinct({ userId: schema.files.userId })
    .from(schema.files)
    .where(and(
      inArray(schema.files.externalSource, googleSources),
      notExists(
        db.select({ value: sql`1` })
          .from(activeConnection)
          .where(and(
            eq(activeConnection.userId, schema.files.userId),
            eq(activeConnection.status, 'active'),
          )),
      ),
    ))
    .limit(input.userLimit ?? GOOGLE_SWEEP_USER_LIMIT)

  for (const { userId } of users) {
    const cleanup = await deleteGoogleDerivedFiles({
      db,
      userId,
      logger,
      storage: input.storage,
    })

    result.usersCleaned += 1
    result.filesDeleted += cleanup.deleted
    result.incompleteUsers += cleanup.complete ? 0 : 1
  }

  const revokedRows = await db
    .select({
      id: connections.id,
      userId: connections.userId,
    })
    .from(connections)
    .where(eq(connections.status, 'revoked'))
    .limit(input.userLimit ?? GOOGLE_SWEEP_USER_LIMIT)

  for (const row of revokedRows) {
    const [remainingFile] = await db
      .select({ id: schema.files.id })
      .from(schema.files)
      .where(isGoogleFileOf(row.userId))
      .limit(1)
    const otherActive = await hasOtherActiveGoogleConnection(
      db,
      row.userId,
      row.id,
    )

    if (remainingFile && !otherActive) {
      continue
    }

    await db.delete(connections).where(and(
      eq(connections.id, row.id),
      eq(connections.status, 'revoked'),
    ))
    result.revokedRowsDeleted += 1
  }

  return result
}
