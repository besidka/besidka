import {
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  not,
  notExists,
  or,
  sql,
} from 'drizzle-orm'
import type { ProjectMemoryStatus } from '#shared/types/projects.d'
import * as schema from '~~/server/db/schema'
import { chatIsMemoryIncluded } from '~~/server/utils/memory/chat-memory-filters'
import {
  MEMORY_EXTRACTION_LIMITS,
  MEMORY_EXTRACTION_NOTHING_DURABLE_REASON,
  MEMORY_EXTRACTION_WAITING_FOR_TEXT_FAILURES,
} from '~~/server/utils/memory/extract-limits'
import type { ExtractChatMemoryResult } from '~~/server/utils/memory/extract'
import { projectMemorySettledStatus } from '~~/server/utils/projects/memory-toggle'

type DbClient = ReturnType<typeof useDb>

const SETTLEABLE_STATUSES: ProjectMemoryStatus[] = [
  'stale',
  'failed',
  'unavailable',
]

const SETTLING_SKIP_REASONS: ReadonlySet<string> = new Set([
  'no-user-text',
  'too-short',
  MEMORY_EXTRACTION_NOTHING_DURABLE_REASON,
])

export function isSweepPassSettling(outcome: ExtractChatMemoryResult) {
  if (outcome.status === 'extracted') {
    return true
  }

  return outcome.status === 'skipped'
    && !!outcome.reason
    && SETTLING_SKIP_REASONS.has(outcome.reason)
}

function chatIsParkedUntilNewActivity() {
  const attemptedAt = schema.chats.memoryExtractionAttemptedAt
  const failures = schema.chats.memoryExtractionFailures

  return and(
    isNotNull(attemptedAt),
    isNotNull(failures),
    or(
      eq(failures, MEMORY_EXTRACTION_WAITING_FOR_TEXT_FAILURES),
      gte(failures, MEMORY_EXTRACTION_LIMITS.maxFailures),
    ),
    not(gt(schema.chats.activityAt, attemptedAt)),
  )
}

function projectChatsLeftForSweep(
  db: DbClient,
  projectId: string,
  userId: number,
) {
  const extractionEnabledAt = sql`(
    select ${schema.userSettings.memoryExtractionEnabledAt}
    from ${schema.userSettings}
    where ${schema.userSettings.userId} = ${userId}
  )`

  return db
    .select({ id: schema.chats.id })
    .from(schema.chats)
    .where(and(
      eq(schema.chats.projectId, projectId),
      eq(schema.chats.userId, userId),
      chatIsMemoryIncluded(),
      or(
        isNull(schema.chats.projectMemorySummaryUpdatedAt),
        lt(
          schema.chats.projectMemorySummaryUpdatedAt,
          schema.chats.activityAt,
        ),
      ),
      gt(schema.chats.activityAt, extractionEnabledAt),
      not(chatIsParkedUntilNewActivity()),
    ))
}

export interface SettleProjectMemoryAfterSweepPassInput {
  chatId: string
  userId: number
  passStartedAt: Date
  db?: DbClient
}

/**
 * Bookkeeping after the sweep finished a project chat: clears the project's
 * `stale` mark once the background sweep has nothing left to read in it. A
 * `failed` or `unavailable` card left by an earlier manual Refresh recovers
 * the same way and loses its error, since a successful pass proves the key
 * works. A
 * project chat counts as left when it is memory-included, newer than its
 * project watermark, newer than the extraction cut-over, and not parked
 * (waiting for more user text, or capped on failures, without new activity),
 * so history from before the opt-in never keeps a project stale; the manual
 * Refresh still reads it. The write is one guarded statement: it only touches
 * a `stale`, `failed` or `unavailable` row (never `disabled` or
 * `refreshing`), only when no dirty mark
 * at or after the pass start raced in, and only when no chat is left, so a
 * message or move that arrives mid-pass keeps the project stale. The settled
 * status is `ready`, or `idle` without entries, as in the manual Refresh. No
 * model is called and nothing is extracted.
 */
export async function settleProjectMemoryAfterSweepPass(
  input: SettleProjectMemoryAfterSweepPassInput,
) {
  const db = input.db ?? useDb()
  const { chatId, userId, passStartedAt } = input
  const chat = await db.query.chats.findFirst({
    where: { id: chatId, userId },
    columns: { projectId: true },
  })

  if (!chat?.projectId) {
    return
  }

  const { projectId } = chat
  const memoryStatus = await projectMemorySettledStatus(db, projectId, userId)

  await db.update(schema.projects)
    .set({ memoryStatus, memoryDirtyAt: null, memoryError: null })
    .where(and(
      eq(schema.projects.id, projectId),
      eq(schema.projects.userId, userId),
      inArray(schema.projects.memoryStatus, SETTLEABLE_STATUSES),
      or(
        isNull(schema.projects.memoryDirtyAt),
        lt(schema.projects.memoryDirtyAt, passStartedAt),
      ),
      notExists(projectChatsLeftForSweep(db, projectId, userId)),
    ))
}
