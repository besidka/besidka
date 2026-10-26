import { sql } from 'drizzle-orm'
import { JEV_INJECTION_SCREENING } from '#shared/utils/jev-policy'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { screenTextsForInjection } from '~~/server/utils/jev/injection-screening'
import type { JevLogger } from '~~/server/utils/jev/logging'
import { resolveJevRoleModel } from '~~/server/utils/jev/roles'
import { getKnowledgeItemText } from '~~/server/utils/knowledge/text-store'
import { bumpKnowledgeVersion } from '~~/server/utils/knowledge/version'
import { hasUserLegalConsent } from '~~/server/utils/legal/consent'

type DbClient = ReturnType<typeof useDb>

export interface UnscreenedQueueStore {
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<unknown>
  delete: (key: string) => Promise<unknown>
  list: (options: { prefix: string, limit?: number }) => Promise<{
    keys: Array<{ name: string }>
  }>
}

export interface UnscreenedQueueLogger {
  set: (data: Record<string, unknown>) => void
}

export interface KnowledgeRescreenResult {
  listed: number
  clean: number
  flagged: number
  dropped: number
  deferred: number
}

interface QueuedItem {
  key: string
  userId: number
  projectId: number
  itemId: number
}

interface ItemSnapshot {
  userId: number
  projectId: number
  extractStatus: string
  updatedAt: number
}

const UNSCREENED_KEY_PREFIX = 'knowledge-unscreened:'
const UNSCREENED_KEY_PATTERN
  = /^knowledge-unscreened:u([1-9]\d*):p([1-9]\d*):i([1-9]\d*)$/
const QUEUED_MARKER = '1'

function isSafeId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

export function knowledgeUnscreenedKey(
  userId: number,
  projectId: number,
  itemId: number,
): string {
  return `${UNSCREENED_KEY_PREFIX}u${userId}:p${projectId}:i${itemId}`
}

function parseQueuedKey(key: string): QueuedItem | null {
  const match = UNSCREENED_KEY_PATTERN.exec(key)

  if (!match) {
    return null
  }

  const [userId, projectId, itemId] = [match[1], match[2], match[3]]
    .map(Number)

  if (!isSafeId(userId!) || !isSafeId(projectId!) || !isSafeId(itemId!)) {
    return null
  }

  return { key, userId: userId!, projectId: projectId!, itemId: itemId! }
}

/**
 * Queues items that ingest screening could not decide (a Jev failure or the
 * per-request call budget) for the knowledge sweep: one KV key per item,
 * `knowledge-unscreened:u<user>:p<project>:i<item>`, kept for
 * `JEV_INJECTION_SCREENING.rescreenQueueTtlSeconds`. Writes are sequential
 * (Workers connection limit). A failed write is counted, never thrown: the
 * item then stays as it was stored, `ready` and unscreened.
 */
export async function queueUnscreenedKnowledgeItems(input: {
  userId: number
  projectId: number
  itemIds: number[]
  kv?: UnscreenedQueueStore
}): Promise<{ queued: number, failed: number }> {
  const kv = input.kv ?? useKV()
  const result = { queued: 0, failed: 0 }

  for (const itemId of input.itemIds) {
    try {
      await kv.put(
        knowledgeUnscreenedKey(input.userId, input.projectId, itemId),
        QUEUED_MARKER,
        { expirationTtl: JEV_INJECTION_SCREENING.rescreenQueueTtlSeconds },
      )
      result.queued++
    } catch {
      result.failed++
    }
  }

  return result
}

async function readItemSnapshot(
  db: DbClient,
  itemId: number,
): Promise<ItemSnapshot | null> {
  const [row] = await db.all<ItemSnapshot>(sql`
    select
      user_id as "userId",
      project_id as "projectId",
      extract_status as "extractStatus",
      updated_at as "updatedAt"
    from project_knowledge_items
    where id = ${itemId}
  `)

  return row ?? null
}

async function markItemFlagged(
  db: DbClient,
  item: QueuedItem,
  snapshot: ItemSnapshot,
): Promise<boolean> {
  const updated = await db.all<{ id: number }>(sql`
    update project_knowledge_items set extract_status = 'flagged'
    where id = ${item.itemId}
      and user_id = ${item.userId}
      and project_id = ${item.projectId}
      and extract_status = 'ready'
      and updated_at = ${snapshot.updatedAt}
    returning id
  `)

  if (updated.length === 0) {
    return false
  }

  await bumpKnowledgeVersion([item.projectId])

  return true
}

function groupByUser(items: QueuedItem[]): Map<number, QueuedItem[]> {
  const groups = new Map<number, QueuedItem[]>()

  for (const item of items) {
    groups.set(item.userId, [...(groups.get(item.userId) ?? []), item])
  }

  return groups
}

/**
 * Re-screens items queued by `queueUnscreenedKnowledgeItems`, from the
 * hourly knowledge sweep. One KV list page of at most `maxItems` keys is
 * read, then users are handled one at a time, items one at a time, until
 * `deadlineMs`:
 *
 * - Without a current legal consent the user's items are deferred (no Jev
 *   call), and they expire with the queue TTL if consent never comes back.
 * - Without a TypeSafe AI key, or with the role switched off, the user's
 *   keys are dropped: that is the behaviour without a key.
 * - An item that is gone, moved, or no longer `ready` (flagged, allowed,
 *   re-extracted) is dropped.
 * - The current text is screened with the background timeout. `clean`
 *   drops the key; `flagged` sets the status, guarded on `updated_at` so a
 *   note edited meanwhile is never flagged for its old text, and bumps
 *   `knowledge_version` so the pack drops it; `unscreened` keeps the key and
 *   stops that user's batch until the next run.
 *
 * Logs counts only, under `attributes.injectionScreeningJev` (per Jev call)
 * and the sweep result.
 */
export async function rescreenUnscreenedKnowledgeItems(input: {
  maxItems: number
  deadlineMs: number
  db?: DbClient
  kv?: UnscreenedQueueStore
  logger?: UnscreenedQueueLogger
}): Promise<KnowledgeRescreenResult> {
  const db = input.db ?? useDb()
  const kv = input.kv ?? useKV()
  const result: KnowledgeRescreenResult = {
    listed: 0,
    clean: 0,
    flagged: 0,
    dropped: 0,
    deferred: 0,
  }

  function remainingMs(): number {
    return input.deadlineMs - Date.now()
  }

  const page = await kv.list({
    prefix: UNSCREENED_KEY_PREFIX,
    limit: Math.max(input.maxItems, 1),
  })
  const queued: QueuedItem[] = []

  result.listed = page.keys.length

  for (const { name } of page.keys) {
    const item = parseQueuedKey(name)

    if (item) {
      queued.push(item)
      continue
    }

    await kv.delete(name)
    result.dropped++
  }

  for (const [userId, items] of groupByUser(queued)) {
    if (remainingMs() <= 0) {
      result.deferred += items.length
      continue
    }

    if (!await hasUserLegalConsent(userId, db)) {
      result.deferred += items.length
      continue
    }

    const model = await resolveJevRoleModel({
      db,
      userId,
      role: 'injectionScreening',
      logger: input.logger as JevLogger | undefined,
    })

    if (!model) {
      for (const item of items) {
        await kv.delete(item.key)
      }

      result.dropped += items.length
      continue
    }

    for (const [index, item] of items.entries()) {
      if (remainingMs() <= 0) {
        result.deferred += items.length - index
        break
      }

      const snapshot = await readItemSnapshot(db, item.itemId)

      if (
        !snapshot
        || snapshot.userId !== item.userId
        || snapshot.projectId !== item.projectId
        || snapshot.extractStatus !== 'ready'
      ) {
        await kv.delete(item.key)
        result.dropped++
        continue
      }

      const text = await getKnowledgeItemText(item)

      if (text === null) {
        await kv.delete(item.key)
        result.dropped++
        continue
      }

      const [verdict] = await screenTextsForInjection({
        model,
        texts: [text],
        source: 'knowledge',
        timeoutMs: JEV_INJECTION_SCREENING.timeoutMs,
        abortSignal: AbortSignal.timeout(Math.max(remainingMs(), 1)),
        logger: input.logger as JevLogger | undefined,
      })

      if (verdict === 'unscreened') {
        result.deferred += items.length - index
        break
      }

      if (verdict !== 'flagged') {
        result.clean++
      } else if (await markItemFlagged(db, item, snapshot)) {
        result.flagged++
      } else {
        result.dropped++
      }

      await kv.delete(item.key)
    }
  }

  return result
}

/**
 * `rescreenUnscreenedKnowledgeItems` for the sweep: a failure is logged and
 * never stops the R2 garbage collection that runs after it.
 */
export async function rescreenUnscreenedKnowledgeItemsSafely(input: {
  maxItems: number
  deadlineMs: number
  db?: DbClient
  kv?: UnscreenedQueueStore
  logger?: UnscreenedQueueLogger
}): Promise<KnowledgeRescreenResult | null> {
  try {
    return await rescreenUnscreenedKnowledgeItems(input)
  } catch (exception) {
    input.logger?.set({
      attributes: {
        knowledgeRescreenFailure: { error: exceptionMessage(exception) },
      },
    })

    return null
  }
}
