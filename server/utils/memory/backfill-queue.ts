import { and, desc, eq, isNull, lt, lte, ne, or, sql } from 'drizzle-orm'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import * as schema from '~~/server/db/schema'
import { chatIsMemoryIncluded } from '~~/server/utils/memory/chat-memory-filters'

type DbClient = ReturnType<typeof useDb>

export interface BackfillCursor {
  activityAt: Date
  chatId: string
}

export interface BackfillWindow {
  createdBefore: Date
  cursor: BackfillCursor | null
  isContinuation: boolean
}

/**
 * The one definition of "a chat the backfill will visit": the user's own
 * account chat (never a project chat, never one excluded from memory)
 * created at or before the job's cutoff that holds at least one user
 * message. The start count, the queue cursor
 * and the estimate all use it, so processed chats can reach the total.
 */
export function backfillEligibleChats(userId: number, createdBefore: Date) {
  return and(
    eq(schema.chats.userId, userId),
    isNull(schema.chats.projectId),
    lte(schema.chats.createdAt, createdBefore),
    chatIsMemoryIncluded(),
    sql`exists (
      select 1 from ${schema.messages}
      where ${schema.messages.chatId} = ${schema.chats.id}
        and ${schema.messages.role} = 'user'
    )`,
  )
}

/**
 * The chats strictly after `cursor` in the queue order (activity, then id,
 * both descending), or no condition for a window that starts at the top.
 */
export function backfillAfterCursor(cursor: BackfillCursor | null) {
  if (!cursor) {
    return undefined
  }

  return or(
    lt(schema.chats.activityAt, cursor.activityAt),
    and(
      eq(schema.chats.activityAt, cursor.activityAt),
      lt(schema.chats.id, cursor.chatId),
    ),
  )
}

export function backfillWindowChats(
  userId: number,
  window: Pick<BackfillWindow, 'createdBefore' | 'cursor'>,
) {
  return and(
    backfillEligibleChats(userId, window.createdBefore),
    backfillAfterCursor(window.cursor),
  )
}

/**
 * The ids of the chats one backfill job can reach at most: the next
 * `MEMORY_LIMITS.backfillMaxChats` chats of the window in the queue's own
 * order. The start count and the estimate aggregate over this set only, so
 * their cost is bounded however long the history is and they always describe
 * exactly the chats the job will read.
 */
export function backfillCappedChatIds(
  userId: number,
  window: Pick<BackfillWindow, 'createdBefore' | 'cursor'>,
) {
  return sql`(
    select ${schema.chats.id} as id
    from ${schema.chats}
    where ${backfillWindowChats(userId, window)}
    order by ${schema.chats.activityAt} desc, ${schema.chats.id} desc
    limit ${MEMORY_LIMITS.backfillMaxChats}
  )`
}

/**
 * Where the next backfill job starts, so no chat is paid for twice. With no
 * finished job it is a fresh window: every eligible chat created up to `now`,
 * from the newest. When the user's latest finished job stopped before its
 * queue ran out (it reached `backfillMaxChats`, was cancelled or failed), the
 * new job continues that job's queue: same `createdBefore`, starting after its
 * cursor. When the latest job completed because its queue ran out, every
 * past chat has been read and `null` is returned; chats created since are
 * handled by the forward sweep.
 */
export async function resolveBackfillWindow(
  db: DbClient,
  userId: number,
  now: Date,
): Promise<BackfillWindow | null> {
  const jobs = schema.memoryBackfillJobs
  const [latest] = await db
    .select({
      status: jobs.status,
      processedChats: jobs.processedChats,
      createdBefore: jobs.createdBefore,
      cursorActivityAt: jobs.cursorActivityAt,
      cursorChatId: jobs.cursorChatId,
    })
    .from(jobs)
    .where(and(eq(jobs.userId, userId), ne(jobs.status, 'running')))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(1)

  if (!latest) {
    return { createdBefore: now, cursor: null, isContinuation: false }
  }

  const isQueueExhausted = latest.status === 'completed'
    && latest.processedChats < MEMORY_LIMITS.backfillMaxChats

  if (isQueueExhausted) {
    return null
  }

  const cursor = latest.cursorActivityAt && latest.cursorChatId
    ? { activityAt: latest.cursorActivityAt, chatId: latest.cursorChatId }
    : null

  return {
    createdBefore: latest.createdBefore,
    cursor,
    isContinuation: true,
  }
}
