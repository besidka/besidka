import { sql } from 'drizzle-orm'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  KNOWLEDGE_STORAGE_PREFIX,
  knowledgeProjectPrefix,
} from '~~/server/utils/knowledge/storage-keys'

const KNOWLEDGE_LIST_PREFIX = `${KNOWLEDGE_STORAGE_PREFIX}/`
const KNOWLEDGE_KEY_PATTERN = new RegExp(
  '^knowledge/u([1-9]\\d*)/p([1-9]\\d*)/'
  + '(?:items/([1-9]\\d*)\\.md|pack/v([1-9]\\d*)\\.(?:jsonl|index\\.json)\\.gz)$',
)
const MAX_R2_LIST_PAGE_SIZE = 1000
const MAX_R2_DELETE_KEYS = 1000
const MAX_IDS_PER_QUERY = 90
const NEWEST_PACK_VERSIONS_KEPT = 2
const DEFAULT_GRACE_MS = 60 * 60 * 1000
const SWEEP_CURSOR_KEY = 'knowledge-sweep-cursor'
const SWEEP_CURSOR_TTL_SECONDS = 6 * 60 * 60
const MAX_CONSECUTIVE_FAILED_PAGES = 3

export interface KnowledgeSweepObject {
  key: string
  uploaded?: Date
}

export interface KnowledgeSweepBucket {
  list: (options: {
    prefix: string
    cursor?: string
    limit: number
  }) => Promise<{
    objects: KnowledgeSweepObject[]
    truncated: boolean
    cursor?: string
  }>
  delete: (keys: string[]) => Promise<unknown>
}

export interface KnowledgeSweepLogger {
  set: (data: Record<string, unknown>) => void
}

export interface KnowledgeSweepInput {
  batchSize: number
  maxRuntimeMs: number
  graceMs?: number
  now?: Date
  logger?: KnowledgeSweepLogger
  db?: ReturnType<typeof useDb>
  storage?: KnowledgeSweepBucket
}

export interface KnowledgeSweepResult {
  pagesScanned: number
  scannedCount: number
  orphanItemObjectsDeleted: number
  orphanProjectObjectsDeleted: number
  stalePackObjectsDeleted: number
  youngSkippedCount: number
  unrecognizedCount: number
  failedDeleteCount: number
  hasMore: boolean
  runtimeMs: number
}

interface ParsedKnowledgeKey {
  key: string
  userId: number
  projectId: number
  itemId: number | null
}

interface ExistingProject {
  userId: number
  packVersion: number | null
}

interface ExistingItem {
  userId: number
  projectId: number
}

function chunkNumbers(values: number[], chunkSize: number): number[][] {
  const chunks: number[][] = []

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize))
  }

  return chunks
}

function toIdList(ids: number[]) {
  return sql.join(ids.map((id) => {
    return sql`${id}`
  }), sql`, `)
}

function isSafeId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

/**
 * Recognises only the key shapes `storage-keys.ts` produces. Anything else
 * under `knowledge/` is none of the sweeper's business and returns null.
 */
function parseKnowledgeKey(key: string): ParsedKnowledgeKey | null {
  const match = KNOWLEDGE_KEY_PATTERN.exec(key)

  if (!match) {
    return null
  }

  const userId = Number(match[1])
  const projectId = Number(match[2])
  const itemId = match[3] === undefined ? null : Number(match[3])

  if (!isSafeId(userId) || !isSafeId(projectId)) {
    return null
  }

  if (itemId !== null && !isSafeId(itemId)) {
    return null
  }

  return { key, userId, projectId, itemId }
}

function parsePackVersion(key: string): number | null {
  const match = /\/pack\/v([1-9]\d*)\.(?:jsonl|index\.json)\.gz$/.exec(key)

  if (!match) {
    return null
  }

  const version = Number(match[1])

  return isSafeId(version) ? version : null
}

function isOlderThanGrace(
  object: KnowledgeSweepObject,
  graceCutoffMs: number,
): boolean {
  if (!(object.uploaded instanceof Date)) {
    return false
  }

  const uploadedMs = object.uploaded.getTime()

  return Number.isFinite(uploadedMs) && uploadedMs <= graceCutoffMs
}

async function loadExistingProjects(
  db: ReturnType<typeof useDb>,
  projectIds: number[],
): Promise<Map<number, ExistingProject>> {
  const projects = new Map<number, ExistingProject>()

  for (const chunk of chunkNumbers(projectIds, MAX_IDS_PER_QUERY)) {
    const rows = await db.all<{
      id: number
      userId: number
      packVersion: number | null
    }>(sql`
      select
        id,
        user_id as "userId",
        knowledge_pack_version as "packVersion"
      from projects
      where id in (${toIdList(chunk)})
    `)

    for (const row of rows) {
      projects.set(row.id, {
        userId: row.userId,
        packVersion: row.packVersion,
      })
    }
  }

  return projects
}

async function loadExistingItems(
  db: ReturnType<typeof useDb>,
  itemIds: number[],
): Promise<Map<number, ExistingItem>> {
  const items = new Map<number, ExistingItem>()

  for (const chunk of chunkNumbers(itemIds, MAX_IDS_PER_QUERY)) {
    const rows = await db.all<{
      id: number
      userId: number
      projectId: number
    }>(sql`
      select
        id,
        user_id as "userId",
        project_id as "projectId"
      from project_knowledge_items
      where id in (${toIdList(chunk)})
    `)

    for (const row of rows) {
      items.set(row.id, {
        userId: row.userId,
        projectId: row.projectId,
      })
    }
  }

  return items
}

/**
 * Pack versions to delete for one existing project: everything older than
 * the two newest existing versions, except any version at or above
 * `projects.knowledgePackVersion` and the newest version below it (the
 * "previous" pack an in-flight send may still read). A project with no
 * recorded pack version keeps every pack, since a build may be in flight.
 */
async function findStalePackKeys(input: {
  storage: KnowledgeSweepBucket
  userId: number
  projectId: number
  currentPackVersion: number | null
  graceCutoffMs: number
}): Promise<{ keys: string[], youngSkippedCount: number }> {
  const staleKeys: string[] = []
  const currentPackVersion = input.currentPackVersion
  let youngSkippedCount = 0

  if (currentPackVersion === null) {
    return { keys: staleKeys, youngSkippedCount }
  }

  const prefix = `${knowledgeProjectPrefix(input.userId, input.projectId)}pack/`
  const keysByVersion = new Map<number, KnowledgeSweepObject[]>()
  let cursor: string | undefined

  do {
    const page = await input.storage.list({
      prefix,
      cursor,
      limit: MAX_R2_LIST_PAGE_SIZE,
    })

    for (const object of page.objects) {
      const parsedKey = parseKnowledgeKey(object.key)
      const version = parsePackVersion(object.key)

      if (!parsedKey || version === null || parsedKey.itemId !== null) {
        continue
      }

      keysByVersion.set(version, [
        ...(keysByVersion.get(version) || []),
        object,
      ])
    }

    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  const versionsNewestFirst = [...keysByVersion.keys()]
    .sort((first, second) => {
      return second - first
    })
  const keptVersions = new Set<number>(
    versionsNewestFirst.slice(0, NEWEST_PACK_VERSIONS_KEPT),
  )
  const previousVersion = versionsNewestFirst.find((version) => {
    return version < currentPackVersion
  })

  if (previousVersion !== undefined) {
    keptVersions.add(previousVersion)
  }

  for (const [version, objects] of keysByVersion) {
    if (keptVersions.has(version) || version >= currentPackVersion) {
      continue
    }

    for (const object of objects) {
      if (isOlderThanGrace(object, input.graceCutoffMs)) {
        staleKeys.push(object.key)
        continue
      }

      youngSkippedCount++
    }
  }

  return { keys: staleKeys, youngSkippedCount }
}

async function readSweepCursor(
  logger: KnowledgeSweepLogger | undefined,
): Promise<string | undefined> {
  try {
    const stored = await useKV().get(SWEEP_CURSOR_KEY)

    return stored || undefined
  } catch (exception) {
    logSweepCursorError(logger, 'read', exception)

    return undefined
  }
}

async function saveSweepCursor(
  cursor: string | undefined,
  logger: KnowledgeSweepLogger | undefined,
): Promise<void> {
  try {
    const kv = useKV()

    if (cursor) {
      await kv.put(SWEEP_CURSOR_KEY, cursor, {
        expirationTtl: SWEEP_CURSOR_TTL_SECONDS,
      })

      return
    }

    await kv.delete(SWEEP_CURSOR_KEY)
  } catch (exception) {
    logSweepCursorError(logger, 'write', exception)
  }
}

function logSweepCursorError(
  logger: KnowledgeSweepLogger | undefined,
  operation: string,
  exception: unknown,
): void {
  logger?.set({
    attributes: {
      knowledgeSweepCursor: { operation, error: exceptionMessage(exception) },
    },
  })
}

/**
 * Hourly garbage collection of `knowledge/` R2 objects. The `files` and
 * `projects` FK cascades remove item rows with no knowledge code running,
 * and a failed or interrupted request can leave an object without a row, so
 * this reconciles R2 against D1: item text objects whose row is gone, every
 * object of a project (or a user mismatch) that no longer exists, and pack
 * versions beyond the two newest.
 *
 * Safety rails: only keys matching the exact shapes `storage-keys.ts` builds
 * are touched (anything else is counted and left alone), objects uploaded
 * within the grace window are never touched (a writer may not have inserted
 * its row yet), R2 calls are sequential, and deletes go through one batch
 * `delete(keys)` call per page. When a run ends on its runtime bound the
 * listing cursor is kept in KV (`knowledge-sweep-cursor`, 6 h) and the next
 * run resumes there, so a bucket larger than one run's budget is eventually
 * covered; a finished listing or any KV error means the next run starts from
 * the beginning.
 *
 * The cursor always moves forward past a page the run could not finish: a
 * failed delete or an unexpected error marks the page failed (counted, logged)
 * and the listing continues, three failed pages in a row end the run, and a
 * page cut short by the runtime bound is not rescanned (its pack retention is
 * also enforced at build time). One bad key or row therefore cannot pin the
 * sweep to the same page; the next full pass retries it.
 */
export async function sweepProjectKnowledge(
  input: KnowledgeSweepInput,
): Promise<KnowledgeSweepResult> {
  const startedAt = Date.now()
  const db = input.db || useDb()
  const storage = input.storage || useFileStorage()
  const logger = input.logger
  const pageSize = Math.min(Math.max(input.batchSize, 1), MAX_R2_LIST_PAGE_SIZE)
  const maxRuntimeMs = Math.max(input.maxRuntimeMs, 1000)
  const graceMs = Math.max(input.graceMs ?? DEFAULT_GRACE_MS, 0)
  const graceCutoffMs = (input.now || new Date()).getTime() - graceMs
  const packProjectsChecked = new Set<number>()
  const result: KnowledgeSweepResult = {
    pagesScanned: 0,
    scannedCount: 0,
    orphanItemObjectsDeleted: 0,
    orphanProjectObjectsDeleted: 0,
    stalePackObjectsDeleted: 0,
    youngSkippedCount: 0,
    unrecognizedCount: 0,
    failedDeleteCount: 0,
    hasMore: false,
    runtimeMs: 0,
  }

  function isOutOfTime(): boolean {
    return Date.now() - startedAt >= maxRuntimeMs
  }

  async function deleteKeys(keys: string[]): Promise<boolean> {
    for (
      let index = 0;
      index < keys.length;
      index += MAX_R2_DELETE_KEYS
    ) {
      const batch = keys.slice(index, index + MAX_R2_DELETE_KEYS)

      try {
        await storage.delete(batch)
      } catch (exception) {
        result.failedDeleteCount += batch.length
        logger?.set({
          attributes: {
            knowledgeSweepDeleteFailure: {
              keyCount: batch.length,
              error: exceptionMessage(exception),
            },
          },
        })

        return false
      }
    }

    return true
  }

  let cursor = await readSweepCursor(logger)
  let consecutiveFailedPages = 0
  let isListingFinished = false

  if (cursor) {
    logger?.set({
      attributes: { knowledgeSweepResumed: { resumed: true } },
    })
  }

  async function scanPage(page: {
    objects: KnowledgeSweepObject[]
  }): Promise<{ isFailed: boolean, isIncomplete: boolean }> {
    const candidates: ParsedKnowledgeKey[] = []

    for (const object of page.objects) {
      const parsedKey = parseKnowledgeKey(object.key)

      if (!parsedKey) {
        result.unrecognizedCount++
        continue
      }

      if (!isOlderThanGrace(object, graceCutoffMs)) {
        result.youngSkippedCount++
        continue
      }

      candidates.push(parsedKey)
    }

    const projects = await loadExistingProjects(db, [
      ...new Set(candidates.map((candidate) => {
        return candidate.projectId
      })),
    ])
    const orphanProjectKeys: string[] = []
    const liveItemCandidates: ParsedKnowledgeKey[] = []
    const packProjectsToCheck = new Map<number, ParsedKnowledgeKey>()

    for (const candidate of candidates) {
      const project = projects.get(candidate.projectId)

      if (!project || project.userId !== candidate.userId) {
        orphanProjectKeys.push(candidate.key)
        continue
      }

      if (candidate.itemId === null) {
        packProjectsToCheck.set(candidate.projectId, candidate)
        continue
      }

      liveItemCandidates.push(candidate)
    }

    const items = await loadExistingItems(db, [
      ...new Set(liveItemCandidates.map((candidate) => {
        return candidate.itemId!
      })),
    ])
    const orphanItemKeys = liveItemCandidates
      .filter((candidate) => {
        const item = items.get(candidate.itemId!)

        return !item
          || item.userId !== candidate.userId
          || item.projectId !== candidate.projectId
      })
      .map((candidate) => {
        return candidate.key
      })

    if (orphanProjectKeys.length > 0) {
      if (!await deleteKeys(orphanProjectKeys)) {
        return { isFailed: true, isIncomplete: false }
      }

      result.orphanProjectObjectsDeleted += orphanProjectKeys.length
    }

    if (orphanItemKeys.length > 0) {
      if (!await deleteKeys(orphanItemKeys)) {
        return { isFailed: true, isIncomplete: false }
      }

      result.orphanItemObjectsDeleted += orphanItemKeys.length
    }

    for (const [projectId, candidate] of packProjectsToCheck) {
      if (packProjectsChecked.has(projectId)) {
        continue
      }

      if (isOutOfTime()) {
        result.hasMore = true

        return { isFailed: false, isIncomplete: true }
      }

      packProjectsChecked.add(projectId)

      const stalePacks = await findStalePackKeys({
        storage,
        userId: candidate.userId,
        projectId,
        currentPackVersion: projects.get(projectId)!.packVersion,
        graceCutoffMs,
      })

      result.youngSkippedCount += stalePacks.youngSkippedCount

      if (stalePacks.keys.length === 0) {
        continue
      }

      if (!await deleteKeys(stalePacks.keys)) {
        return { isFailed: true, isIncomplete: false }
      }

      result.stalePackObjectsDeleted += stalePacks.keys.length
    }

    return { isFailed: false, isIncomplete: false }
  }

  async function scanPageSafely(page: {
    objects: KnowledgeSweepObject[]
  }): Promise<{ isFailed: boolean, isIncomplete: boolean }> {
    try {
      return await scanPage(page)
    } catch (exception) {
      logger?.set({
        attributes: {
          knowledgeSweepPageFailure: {
            error: exceptionMessage(exception),
          },
        },
      })

      return { isFailed: true, isIncomplete: false }
    }
  }

  do {
    if (isOutOfTime()) {
      result.hasMore = true
      break
    }

    let page: Awaited<ReturnType<KnowledgeSweepBucket['list']>>

    try {
      page = await storage.list({
        prefix: KNOWLEDGE_LIST_PREFIX,
        cursor,
        limit: pageSize,
      })
    } catch (exception) {
      if (cursor) {
        await saveSweepCursor(undefined, logger)
      }

      throw exception
    }

    result.pagesScanned++
    result.scannedCount += page.objects.length

    const outcome = await scanPageSafely(page)

    if (outcome.isFailed) {
      result.hasMore = true
      consecutiveFailedPages++
    } else {
      consecutiveFailedPages = 0
    }

    if (page.truncated && !page.cursor) {
      result.hasMore = true
      cursor = undefined
      break
    }

    cursor = page.truncated ? page.cursor : undefined
    isListingFinished = cursor === undefined

    if (consecutiveFailedPages >= MAX_CONSECUTIVE_FAILED_PAGES) {
      break
    }

    if (outcome.isIncomplete) {
      break
    }
  } while (cursor)

  const cursorToKeep = !isListingFinished && result.hasMore
    ? cursor
    : undefined

  await saveSweepCursor(cursorToKeep, logger)

  result.runtimeMs = Date.now() - startedAt

  return result
}
