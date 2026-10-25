import { and, eq, isNull, lte, sql } from 'drizzle-orm'
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
