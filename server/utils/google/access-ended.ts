import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  lte,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types'
import { GOOGLE_EXTERNAL_SOURCES } from '#shared/utils/google-data-policy'
import type { GoogleClientMode } from '#shared/utils/google-scopes'
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
export const GOOGLE_FILE_CLEANUP_MAX_FILES = 1000
export const GOOGLE_SWEEP_USER_LIMIT = 25
export const GOOGLE_SWEEP_FILE_BUDGET = 2000
export const GOOGLE_SWEEP_TIME_BUDGET_MS = 20_000
export const GOOGLE_SWEEP_CURSOR_KEY = 'google:sweep-cursor'
export const GOOGLE_SWEEP_CURSOR_TTL_SECONDS = 7 * 24 * 60 * 60

const googleSources = [...GOOGLE_EXTERNAL_SOURCES]

export interface GoogleFileCleanupBudget {
  remainingFiles: number
  deadline: number
  now: () => number
}

export interface GoogleFileCleanupResult {
  deleted: number
  complete: boolean
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
  createdBefore: Date
  logger: LoggerLike
  storage?: FileStorage
  budget?: GoogleFileCleanupBudget
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

function defaultBudget(): GoogleFileCleanupBudget {
  return {
    remainingFiles: GOOGLE_FILE_CLEANUP_MAX_FILES,
    deadline: Number.POSITIVE_INFINITY,
    now: Date.now,
  }
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
 * The client modes whose connection Google file copies belong to. Files
 * carry no client mode, so this is the rule instead: only Besidka's client
 * makes copies (the Picker needs the project of Besidka's client, and the
 * bring-your-own tools keep references only). A copy therefore lives
 * exactly as long as a connection of these modes is active, whatever the
 * bring-your-own connection does. A later tool that saves copies under the
 * bring-your-own client must first mark them (its own `external_source`
 * value) and add a rule for that value here.
 */
export const GOOGLE_COPY_CLIENT_MODES: readonly GoogleClientMode[] = [
  'besidka',
]

export async function hasActiveCopyConnection(
  db: DbClient,
  userId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.googleConnections.id })
    .from(schema.googleConnections)
    .where(and(
      eq(schema.googleConnections.userId, userId),
      eq(schema.googleConnections.status, 'active'),
      inArray(schema.googleConnections.clientMode, GOOGLE_COPY_CLIENT_MODES),
    ))
    .limit(1)

  return !!row
}

/**
 * Deletes the files of a user whose `external_source` is a Google source
 * and that were created no later than `createdBefore` (the moment access
 * ended), so a file picked after a reconnect is never touched. Before
 * every batch it re-checks that the user has no active connection of a
 * copy-making mode (`GOOGLE_COPY_CLIENT_MODES`): a reconnect stops the
 * cleanup and reports `skipped`, while an active bring-your-own connection
 * does not keep Besidka's copies alive. Each batch is one R2 batch delete (with
 * the derived Office text keys), the KV file cache one key at a time, the
 * D1 rows, the documents and knowledge texts that pointed at them; an R2
 * failure stops before D1 so the sweep retries. `complete` is false when
 * R2 failed or the file or time budget ran out. Logs ids and counts only.
 */
/**
 * Forgets the Drive copies the user's files were saved as (`drive_copy_id`)
 * once no connection of a copy-making mode is active, so "already saved"
 * never answers with a link into a Google account that is no longer
 * connected (a disconnect, an `invalid_grant`, or a different Google
 * account replacing the connection). A failure is logged and the sweep
 * tries again, because the cleanup runs again for the user.
 */
export async function clearSavedDriveCopyIds(
  db: DbClient,
  userId: number,
  logger: LoggerLike,
): Promise<void> {
  try {
    await db
      .update(schema.files)
      .set({ driveCopyId: null })
      .where(and(
        eq(schema.files.userId, userId),
        isNotNull(schema.files.driveCopyId),
      ))
  } catch (exception) {
    logCleanup(logger, {
      phase: 'drive-copy-ids',
      userId,
      error: exceptionMessage(exception),
    })
  }
}

export async function deleteGoogleDerivedFiles(
  input: CleanupInput,
): Promise<GoogleFileCleanupResult> {
  const { db, userId, logger } = input
  const storage = input.storage ?? useFileStorage()
  const budget = input.budget ?? defaultBudget()
  let deleted = 0
  let complete = false
  let skipped = false

  if (!await hasActiveCopyConnection(db, userId)) {
    await clearSavedDriveCopyIds(db, userId, logger)
  }

  while (true) {
    if (budget.remainingFiles <= 0 || budget.now() >= budget.deadline) {
      break
    }

    if (await hasActiveCopyConnection(db, userId)) {
      skipped = true
      complete = true

      break
    }

    const rows = await db
      .select({ id: schema.files.id, storageKey: schema.files.storageKey })
      .from(schema.files)
      .where(and(
        isGoogleFileOf(userId),
        lte(schema.files.createdAt, input.createdBefore),
      ))
      .limit(Math.min(GOOGLE_FILE_CLEANUP_BATCH_SIZE, budget.remainingFiles))

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
    budget.remainingFiles -= rows.length
  }

  if (deleted > 0) {
    await invalidateStorageCache(userId, logger)
  }

  logCleanup(logger, { phase: 'files', userId, deleted, complete, skipped })

  return { deleted, complete, skipped }
}

async function readSweepCursor(kv: KVNamespace | undefined): Promise<number> {
  if (!kv) {
    return 0
  }

  try {
    const value = Number(await kv.get(GOOGLE_SWEEP_CURSOR_KEY))

    return Number.isInteger(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

async function writeSweepCursor(
  kv: KVNamespace | undefined,
  cursor: number,
): Promise<void> {
  if (!kv) {
    return
  }

  try {
    await kv.put(GOOGLE_SWEEP_CURSOR_KEY, String(cursor), {
      expirationTtl: GOOGLE_SWEEP_CURSOR_TTL_SECONDS,
    })
  } catch {
    return
  }
}

async function selectSweepUsers(
  db: DbClient,
  afterUserId: number,
  limit: number,
): Promise<number[]> {
  const activeConnection = alias(schema.googleConnections, 'active_connection')
  const rows = await db
    .selectDistinct({ userId: schema.files.userId })
    .from(schema.files)
    .where(and(
      inArray(schema.files.externalSource, googleSources),
      gt(schema.files.userId, afterUserId),
      notExists(
        db.select({ value: sql`1` })
          .from(activeConnection)
          .where(and(
            eq(activeConnection.userId, schema.files.userId),
            eq(activeConnection.status, 'active'),
            inArray(activeConnection.clientMode, GOOGLE_COPY_CLIENT_MODES),
          )),
      ),
    ))
    .orderBy(asc(schema.files.userId))
    .limit(limit)

  return rows.map(row => row.userId)
}

/**
 * The hourly backup for access that ended without a finished cleanup:
 * clears any token left on a row that is not active, deletes the Google
 * copies of users who have Google files and no active connection of a
 * copy-making mode (`GOOGLE_COPY_CLIENT_MODES`), and
 * deletes `revoked` rows once nothing of theirs is left to clean. A run
 * handles at most 25 users, 2,000 files and 20 seconds; it walks users in
 * id order from a KV cursor (`google:sweep-cursor`), so a user whose
 * cleanup keeps failing never starves the rest. Every batch re-checks that
 * the user still has no active connection and only touches files created
 * before the run started.
 */
export async function sweepGoogleAccessEnded(input: {
  db: DbClient
  logger: LoggerLike
  kv?: KVNamespace
  storage?: FileStorage
  now?: () => number
  userLimit?: number
  fileBudget?: number
  timeBudgetMs?: number
}): Promise<GoogleAccessEndedSweepResult> {
  const { db, logger } = input
  const now = input.now ?? Date.now
  const startedAt = now()
  const userLimit = input.userLimit ?? GOOGLE_SWEEP_USER_LIMIT
  const connections = schema.googleConnections
  const budget: GoogleFileCleanupBudget = {
    remainingFiles: input.fileBudget ?? GOOGLE_SWEEP_FILE_BUDGET,
    deadline: startedAt + (input.timeBudgetMs ?? GOOGLE_SWEEP_TIME_BUDGET_MS),
    now,
  }
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

  const cursor = await readSweepCursor(input.kv)
  let users = await selectSweepUsers(db, cursor, userLimit)

  if (users.length === 0 && cursor > 0) {
    users = await selectSweepUsers(db, 0, userLimit)
  }

  let lastUserId = 0
  let stoppedEarly = false

  for (const userId of users) {
    if (budget.remainingFiles <= 0 || now() >= budget.deadline) {
      stoppedEarly = true

      break
    }

    const cleanup = await deleteGoogleDerivedFiles({
      db,
      userId,
      createdBefore: new Date(startedAt),
      logger,
      storage: input.storage,
      budget,
    })

    lastUserId = userId
    result.usersCleaned += 1
    result.filesDeleted += cleanup.deleted
    result.incompleteUsers += cleanup.complete ? 0 : 1
  }

  await writeSweepCursor(
    input.kv,
    stoppedEarly || users.length === userLimit ? lastUserId : 0,
  )

  const revokedRows = await db
    .select({ id: connections.id, userId: connections.userId })
    .from(connections)
    .where(eq(connections.status, 'revoked'))
    .orderBy(asc(connections.updatedAt))
    .limit(userLimit)

  for (const row of revokedRows) {
    const [remainingFile] = await db
      .select({ id: schema.files.id })
      .from(schema.files)
      .where(isGoogleFileOf(row.userId))
      .limit(1)
    const copiesKept = await hasActiveCopyConnection(db, row.userId)

    if (remainingFile && !copiesKept) {
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
