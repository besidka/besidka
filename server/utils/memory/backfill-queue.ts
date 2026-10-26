import { and, eq, isNull, lte, sql } from 'drizzle-orm'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import * as schema from '~~/server/db/schema'

/**
 * The one definition of "a chat the backfill will visit": the user's own
 * account chat (never a project chat) created at or before the job's cutoff
 * that holds at least one user message. The start count, the queue cursor
 * and the estimate all use it, so processed chats can reach the total.
 */
export function backfillEligibleChats(userId: number, createdBefore: Date) {
  return and(
    eq(schema.chats.userId, userId),
    isNull(schema.chats.projectId),
    lte(schema.chats.createdAt, createdBefore),
    sql`exists (
      select 1 from ${schema.messages}
      where ${schema.messages.chatId} = ${schema.chats.id}
        and ${schema.messages.role} = 'user'
    )`,
  )
}

/**
 * The ids of the chats one backfill job can reach at most: the newest
 * `MEMORY_LIMITS.backfillMaxChats` eligible chats in the queue's own order
 * (activity, then id, both descending). The estimate aggregates over this
 * set only, so its cost is bounded however long the history is.
 */
export function backfillCappedChatIds(userId: number, createdBefore: Date) {
  return sql`(
    select ${schema.chats.id} as id
    from ${schema.chats}
    where ${backfillEligibleChats(userId, createdBefore)}
    order by ${schema.chats.activityAt} desc, ${schema.chats.id} desc
    limit ${MEMORY_LIMITS.backfillMaxChats}
  )`
}
