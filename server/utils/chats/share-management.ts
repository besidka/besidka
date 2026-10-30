import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

const MAX_BATCH_QUERY_PARAMS = 90

export interface RevokedChatShares {
  deletedCount: number
  revokedChatIds: string[]
}

/**
 * Matches the shares that are live: not revoked and not past their expiry.
 */
export function buildActiveShareFilter(now: Date = new Date()) {
  return and(
    eq(schema.chatShares.revoked, false),
    or(
      isNull(schema.chatShares.expiresAt),
      gt(schema.chatShares.expiresAt, now),
    ),
  )
}

/**
 * Deletes every share row of the given chats, expired ones included, and
 * clears the chats' `shared` flag. A chat id that is not the user's chat is
 * ignored: `chat_shares` has no user column, so ownership is checked by a
 * subquery on `chats`. `revokedChatIds` lists the chats that had at least
 * one share row, so a caller can tell a chat that was shared from one that
 * never was.
 */
export async function revokeChatShares(
  db: DbClient,
  userId: number,
  chatIds: string[],
): Promise<RevokedChatShares> {
  let deletedCount = 0
  const revokedChatIds = new Set<string>()

  for (
    let offset = 0;
    offset < chatIds.length;
    offset += MAX_BATCH_QUERY_PARAMS
  ) {
    const chunk = chatIds.slice(offset, offset + MAX_BATCH_QUERY_PARAMS)
    const deletedShares = await db.delete(schema.chatShares)
      .where(and(
        inArray(schema.chatShares.chatId, chunk),
        inArray(
          schema.chatShares.chatId,
          db.select({ id: schema.chats.id })
            .from(schema.chats)
            .where(and(
              eq(schema.chats.userId, userId),
              inArray(schema.chats.id, chunk),
            )),
        ),
      ))
      .returning({
        id: schema.chatShares.id,
        chatId: schema.chatShares.chatId,
      })

    await db.update(schema.chats)
      .set({ shared: false })
      .where(and(
        eq(schema.chats.userId, userId),
        inArray(schema.chats.id, chunk),
      ))

    deletedCount += deletedShares.length

    for (const share of deletedShares) {
      revokedChatIds.add(share.chatId)
    }
  }

  return { deletedCount, revokedChatIds: [...revokedChatIds] }
}
