import type { ComplianceBlockedCounts } from '#shared/types/memory.d'
import {
  and,
  asc,
  eq,
  gt,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { recordBlockedCounts } from '~~/server/utils/memory/compliance'
import { memoryExtractionErrorSummary } from '~~/server/utils/memory/extract-error'
import { extractChatMemory } from '~~/server/utils/memory/extract'
import {
  MEMORY_EXTRACTION_LIMITS,
  MEMORY_EXTRACTION_WAITING_FOR_TEXT_FAILURES,
} from '~~/server/utils/memory/extract-limits'
import type { ResolvedMemoryModel } from '~~/server/utils/memory/resolve-model'

type DbClient = ReturnType<typeof useDb>

export interface SweepMemoryExtractionInput {
  batchSize: number
  maxRuntimeMs: number
  logger?: { set: (fields: Record<string, unknown>) => void }
  db?: DbClient
  now?: Date
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
}

interface SelectedChat {
  id: string
  userId: number
}

async function selectDueChats(
  db: DbClient,
  batchSize: number,
  now: Date,
): Promise<SelectedChat[]> {
  const limits = MEMORY_EXTRACTION_LIMITS
  const idleCutoff = new Date(now.getTime() - limits.idleMs)
  const backoffCutoff = new Date(now.getTime() - limits.attemptBackoffMs)
  const poolSize = batchSize * limits.poolMultiplier
  const attemptedAt = schema.chats.memoryExtractionAttemptedAt
  const failures = schema.chats.memoryExtractionFailures
  const hasActivitySinceAttempt = gt(schema.chats.activityAt, attemptedAt)

  const attemptedAtOrZero = sql`coalesce(${schema.chats.memoryExtractionAttemptedAt}, 0)`
  const ranked = db
    .select({
      id: schema.chats.id,
      userId: schema.chats.userId,
      attemptedAt: schema.chats.memoryExtractionAttemptedAt,
      activityAt: schema.chats.activityAt,
      userRank: sql<number>`row_number() over (partition by ${schema.chats.userId} order by ${attemptedAtOrZero}, ${schema.chats.activityAt})`.as('user_rank'),
    })
    .from(schema.chats)
    .innerJoin(
      schema.userSettings,
      eq(schema.chats.userId, schema.userSettings.userId),
    )
    .where(and(
      eq(schema.userSettings.memoryExtractionEnabled, true),
      or(
        isNull(schema.userSettings.memoryEnabled),
        eq(schema.userSettings.memoryEnabled, true),
      ),
      lte(schema.chats.activityAt, idleCutoff),
      or(
        isNull(schema.chats.memoryExtractedAt),
        lt(schema.chats.memoryExtractedAt, schema.chats.activityAt),
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

  const rows = await db
    .select({ id: ranked.id, userId: ranked.userId })
    .from(ranked)
    .where(lte(ranked.userRank, limits.perUserCapPerTick))
    .orderBy(
      sql`coalesce(${ranked.attemptedAt}, 0)`,
      asc(ranked.activityAt),
    )
    .limit(poolSize)

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

function addCounts(
  target: Record<string, number>,
  source: Record<string, number | undefined>,
) {
  for (const [key, count] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + (count ?? 0)
  }
}

/**
 * Picks due chats (idle, dirty, never attempted, or crashed and outside
 * the attempt backoff, or waiting for more user text with new activity, or
 * failed outside the backoff and under the failure cap unless new activity
 * lifted it; at most `perUserCapPerTick` per user) and extracts them one
 * after the other until the batch or the runtime budget is spent. A chat that
 * throws never stops the loop. Reports counts only.
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
        memoryExtractionSweep: {
          phase: 'extract',
          chatId: chat.id,
        },
        attributes: {
          memoryExtractionSweep: memoryExtractionErrorSummary(exception),
        },
      })
      await memoryExtractionMarkAttemptFailed(db, chat, now)
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
  }

  return result
}
