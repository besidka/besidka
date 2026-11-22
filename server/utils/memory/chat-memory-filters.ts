import { sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

/**
 * A chat the user has not excluded from memory: `memory_excluded` null or
 * false. The inline `is not 1` keeps NULL included and matches the predicate
 * of the partial index `idx_chats_memory_due`.
 */
export function chatIsMemoryIncluded() {
  return sql`${schema.chats.memoryExcluded} is not 1`
}

/**
 * A chat that holds no Google data: `google_data_at` is null. A flagged chat
 * never feeds memory (extraction, backfill, project memory, chat search
 * tools), as the Google pre-check requires. Kept apart from
 * `chatIsMemoryIncluded`, whose text mirrors the partial index predicate.
 */
export function chatHoldsNoGoogleData() {
  return sql`${schema.chats.googleDataAt} is null`
}

/**
 * A chat with activity past its extraction watermark (account or project).
 * It repeats the predicate of `idx_chats_memory_due` term for term, which is
 * what lets SQLite pick that partial index for the sweep.
 */
export function chatHasUnextractedActivity() {
  const chats = schema.chats

  return sql`(
    (${chats.projectId} is null and (
      ${chats.memoryExtractedAt} is null
      or ${chats.memoryExtractedAt} < ${chats.activityAt}
    ))
    or (${chats.projectId} is not null and (
      ${chats.projectMemorySummaryUpdatedAt} is null
      or ${chats.projectMemorySummaryUpdatedAt} < ${chats.activityAt}
    ))
  )`
}
