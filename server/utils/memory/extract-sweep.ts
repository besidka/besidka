import type { ComplianceBlockedCounts } from '#shared/types/memory.d'
import {
  and,
  asc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { sweepBackfillJobs } from '~~/server/utils/memory/backfill'
import type { SweepBackfillJobsResult } from '~~/server/utils/memory/backfill'
import {
  chatHasUnextractedActivity,
  chatIsMemoryIncluded,
} from '~~/server/utils/memory/chat-memory-filters'
import { recordBlockedCounts } from '~~/server/utils/memory/compliance'
import { memoryExtractionErrorSummary } from '~~/server/utils/memory/extract-error'
import { extractChatMemory } from '~~/server/utils/memory/extract'
import { currentLegalConsentCondition } from '~~/server/utils/legal/consent'
import {
  MEMORY_EXTRACTION_LIMITS,
  MEMORY_EXTRACTION_WAITING_FOR_TEXT_FAILURES,
} from '~~/server/utils/memory/extract-limits'
import type { ResolvedMemoryModel } from '~~/server/utils/memory/resolve-model'
import {
  isSweepPassSettling,
  settleProjectMemoryAfterSweepPass,
} from '~~/server/utils/projects/memory-sweep-settle'

type DbClient = ReturnType<typeof useDb>

export interface SweepMemoryExtractionInput {
  batchSize: number
  maxRuntimeMs: number
  logger?: { set: (fields: Record<string, unknown>) => void }
  db?: DbClient
  now?: Date
  isBackfillEnabled?: boolean
}

export interface SweepMemoryExtractionModelCount {
  source: string | null
  providerId: string | null
  gatewayId: string | null
  modelId: string | null
  chats: number
}

export interface SweepMemoryExtractionResult {
  selectedCount: number
  extractedCount: number
  skippedCount: number
  failedCount: number
  erroredCount: number
  leasedCount: number
  runtimeMs: number
  opsApplied: { created: number, updated: number, deleted: number }
  opsDropped: Record<string, number>
  models: SweepMemoryExtractionModelCount[]
  backfill: SweepBackfillJobsResult
}

interface SelectedChat {
  id: string
  userId: number
}

export function buildDueChatsQuery(
  db: DbClient,
  batchSize: number,
  now: Date,
) {
  const limits = MEMORY_EXTRACTION_LIMITS
  const idleCutoff = new Date(now.getTime() - limits.idleMs)
  const backoffCutoff = new Date(now.getTime() - limits.attemptBackoffMs)
  const poolSize = batchSize * limits.poolMultiplier
  const attemptedAt = schema.chats.memoryExtractionAttemptedAt
  const failures = schema.chats.memoryExtractionFailures
  const hasActivitySinceAttempt = gt(schema.chats.activityAt, attemptedAt)
  const isExtractionOptedIn
    = sql`${schema.userSettings.memoryExtractionEnabled} = 1`

  const attemptedAtOrZero = sql`coalesce(${schema.chats.memoryExtractionAttemptedAt}, 0)`
  const enabledAtOrZero = sql`coalesce(${schema.userSettings.memoryExtractionEnabledAt}, 0)`
  const ranked = db
    .select({
      id: schema.chats.id,
      userId: schema.chats.userId,
      attemptedAt: schema.chats.memoryExtractionAttemptedAt,
      activityAt: schema.chats.activityAt,
      userRank: sql<number>`row_number() over (partition by ${schema.chats.userId} order by ${attemptedAtOrZero}, ${schema.chats.activityAt})`.as('user_rank'),
    })
    .from(schema.userSettings)
    .crossJoin(schema.chats)
    .leftJoin(
      schema.projects,
      and(
        eq(schema.chats.projectId, schema.projects.id),
        eq(schema.chats.userId, schema.projects.userId),
      ),
    )
    .where(and(
      eq(schema.chats.userId, schema.userSettings.userId),
      isExtractionOptedIn,
      currentLegalConsentCondition(),
      or(
        isNull(schema.userSettings.memoryEnabled),
        eq(schema.userSettings.memoryEnabled, true),
      ),
      lte(schema.chats.activityAt, idleCutoff),
      gt(schema.chats.activityAt, enabledAtOrZero),
      chatIsMemoryIncluded(),
      chatHasUnextractedActivity(),
      or(
        and(
          isNull(schema.chats.projectId),
          or(
            isNull(schema.chats.memoryExtractedAt),
            lt(schema.chats.memoryExtractedAt, schema.chats.activityAt),
          ),
        ),
        and(
          isNotNull(schema.chats.projectId),
          isNotNull(schema.projects.id),
          ne(schema.projects.memoryStatus, 'disabled'),
          isNotNull(schema.userSettings.memoryExtractionEnabledAt),
          gt(
            schema.chats.activityAt,
            schema.userSettings.memoryExtractionEnabledAt,
          ),
          or(
            isNull(schema.chats.projectMemorySummaryUpdatedAt),
            lt(
              schema.chats.projectMemorySummaryUpdatedAt,
              schema.chats.activityAt,
            ),
          ),
        ),
      ),
      or(
        isNull(attemptedAt),
        and(isNull(failures), lt(attemptedAt, backoffCutoff)),
        and(
          eq(failures, MEMORY_EXTRACTION_WAITING_FOR_TEXT_FAILURES),
          hasActivitySinceAttempt,
        ),
        and(
          gt(failures, MEMORY_EXTRACTION_WAITING_FOR_TEXT_FAILURES),
          lt(attemptedAt, backoffCutoff),
          or(lt(failures, limits.maxFailures), hasActivitySinceAttempt),
        ),
      ),
    ))
    .as('ranked_due_chats')

  return db
    .select({ id: ranked.id, userId: ranked.userId })
    .from(ranked)
    .where(lte(ranked.userRank, limits.perUserCapPerTick))
    .orderBy(
      sql`coalesce(${ranked.attemptedAt}, 0)`,
      asc(ranked.activityAt),
    )
    .limit(poolSize)
}

async function selectDueChats(
  db: DbClient,
  batchSize: number,
  now: Date,
): Promise<SelectedChat[]> {
  const limits = MEMORY_EXTRACTION_LIMITS
  const rows = await buildDueChatsQuery(db, batchSize, now)

  const perUserCounts = new Map<number, number>()
  const selected: SelectedChat[] = []

  for (const row of rows) {
    if (selected.length >= batchSize) {
      break
    }

    const userCount = perUserCounts.get(row.userId) ?? 0

    if (userCount >= limits.perUserCapPerTick) {
      continue
    }

    perUserCounts.set(row.userId, userCount + 1)
    selected.push({ id: row.id, userId: row.userId })
  }

  return selected
}

async function memoryExtractionMarkAttemptFailed(
  db: DbClient,
  chat: SelectedChat,
  now: Date,
) {
  try {
    await db.update(schema.chats)
      .set({
        memoryExtractionAttemptedAt: now,
        memoryExtractionFailures:
          sql`coalesce(${schema.chats.memoryExtractionFailures}, 0) + 1`,
      })
      .where(and(
        eq(schema.chats.id, chat.id),
        eq(schema.chats.userId, chat.userId),
      ))
  } catch {
    return
  }
}

async function settleProjectMemory(
  db: DbClient,
  chat: SelectedChat,
  passStartedAt: Date,
  logger: SweepMemoryExtractionInput['logger'],
) {
  try {
    await settleProjectMemoryAfterSweepPass({
      chatId: chat.id,
      userId: chat.userId,
      passStartedAt,
      db,
    })
  } catch (exception) {
    logger?.set({
      attributes: {
        memoryExtractionSweep: {
          phase: 'settle',
          chatId: chat.id,
          ...memoryExtractionErrorSummary(exception),
        },
      },
    })
  }
}

function addCounts(
  target: Record<string, number>,
  source: Record<string, number | undefined>,
) {
  for (const [key, count] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + (count ?? 0)
  }
}

/**
 * Picks due chats and extracts them one after the other until the batch or
 * the runtime budget is spent. Selection starts from the users who opted in
 * (`memory_extraction_enabled` on, `memory_enabled` null or true) through a
 * partial index and reaches their chats through the partial index
 * `idx_chats_memory_due` (dirty chats not excluded from memory), so nothing is
 * read while nobody has opted in. The join is a `CROSS JOIN` on purpose: it
 * pins `user_settings` as the outer loop, which SQLite otherwise flips into a
 * scan of every user's due chats. Both kinds of chat need the
 * opt-in: account chats are due when idle and dirty on `memory_extracted_at`;
 * project chats additionally need their own project (same owner, not
 * disabled), `memory_extraction_enabled_at` set and activity after it, and are
 * dirty on the project watermark. A chat is due when it was never attempted,
 * or crashed outside the attempt backoff, or waits for more user text and has
 * new activity, or failed outside the backoff and under the failure cap unless
 * new activity lifted it. At most `perUserCapPerTick` chats per user. A chat
 * that throws never stops the loop. Afterwards it services running backfill
 * jobs inside whatever runtime budget is left (see `sweepBackfillJobs`),
 * unless `isBackfillEnabled` is false (the backfill kill switch). Reports
 * counts only.
 */
export async function sweepMemoryExtraction(
  input: SweepMemoryExtractionInput,
): Promise<SweepMemoryExtractionResult> {
  const logger = input.logger
  const db = input.db ?? useDb()
  const startedAt = Date.now()
  const now = input.now ?? new Date()
  const chats = await selectDueChats(db, Math.max(input.batchSize, 1), now)
  const resolveCache = new Map<string, ResolvedMemoryModel>()
  const result: SweepMemoryExtractionResult = {
    selectedCount: chats.length,
    extractedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    erroredCount: 0,
    leasedCount: 0,
    runtimeMs: 0,
    opsApplied: { created: 0, updated: 0, deleted: 0 },
    opsDropped: {},
    models: [],
    backfill: { jobs: 0, chats: 0, completed: 0, failed: 0 },
  }
  const blocked: ComplianceBlockedCounts = {}
  const modelCounts = new Map<string, SweepMemoryExtractionModelCount>()
  let processedCount = 0
  let messages = 0
  let userChars = 0
  let proposed = 0
  let inputTokens = 0
  let outputTokens = 0

  for (const chat of chats) {
    if (Date.now() - startedAt >= input.maxRuntimeMs) {
      break
    }

    const passStartedAt = input.now ?? new Date()

    try {
      const outcome = await extractChatMemory({
        chat,
        userId: chat.userId,
        db,
        logger,
        resolveCache,
        now: input.now,
      })

      if (outcome.status === 'leased') {
        result.leasedCount += 1

        continue
      }

      processedCount += 1
      messages += outcome.messages
      userChars += outcome.userChars
      proposed += outcome.proposed
      inputTokens += outcome.usage.inputTokens
      outputTokens += outcome.usage.outputTokens
      addCounts(blocked, outcome.blocked)
      addCounts(result.opsDropped, outcome.dropped)
      result.opsApplied.created += outcome.applied.created
      result.opsApplied.updated += outcome.applied.updated
      result.opsApplied.deleted += outcome.applied.deleted

      if (outcome.status === 'extracted') {
        result.extractedCount += 1
      } else if (outcome.status === 'skipped') {
        result.skippedCount += 1
      } else {
        result.failedCount += 1
      }

      if (isSweepPassSettling(outcome)) {
        await settleProjectMemory(db, chat, passStartedAt, logger)
      }

      if (outcome.model?.modelId) {
        const key = [
          outcome.model.source,
          outcome.model.providerId,
          outcome.model.gatewayId,
          outcome.model.modelId,
        ].join('|')
        const entry = modelCounts.get(key) ?? {
          source: outcome.model.source,
          providerId: outcome.model.providerId,
          gatewayId: outcome.model.gatewayId,
          modelId: outcome.model.modelId,
          chats: 0,
        }

        entry.chats += 1
        modelCounts.set(key, entry)
      }
    } catch (exception) {
      result.erroredCount += 1
      logger?.set({
        attributes: {
          memoryExtractionSweep: {
            phase: 'extract',
            chatId: chat.id,
            ...memoryExtractionErrorSummary(exception),
          },
        },
      })
      await memoryExtractionMarkAttemptFailed(db, chat, now)
    }
  }

  if (input.isBackfillEnabled ?? true) {
    try {
      result.backfill = await sweepBackfillJobs({
        maxRuntimeMs: input.maxRuntimeMs - (Date.now() - startedAt),
        db,
        logger,
      })
    } catch (exception) {
      logger?.set({
        attributes: {
          memoryExtractionSweep: {
            phase: 'backfill',
            ...memoryExtractionErrorSummary(exception),
          },
        },
      })
    }
  }

  result.models = [...modelCounts.values()]
  result.runtimeMs = Date.now() - startedAt

  if (logger) {
    recordBlockedCounts(blocked, logger, 'extraction')
    logger.set({
      attributes: {
        memoryExtraction: {
          chatsProcessed: processedCount,
          messages,
          userChars,
          ops: {
            proposed,
            applied: result.opsApplied,
            dropped: result.opsDropped,
          },
          models: result.models,
          usage: { inputTokens, outputTokens },
        },
      },
    })

    if (result.backfill.jobs > 0) {
      logger.set({ attributes: { memoryBackfillSweep: result.backfill } })
    }
  }

  return result
}
