import { and, desc, eq, gt, inArray, or, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  decodeArtifactId,
  encodeArtifactId,
} from '~~/server/utils/artifacts/store'

type DbClient = ReturnType<typeof useDb>

export const CHAT_ARTIFACT_IDS_LIMIT = 200
export const CHAT_ATTACHED_IDS_LIMIT = 80

/**
 * Public ids of the user's artifacts the chat tools may edit, most recently
 * updated first: those created in this chat, plus those the user attached to
 * a message of it (`attachedArtifactIds`, read from this chat's own user
 * messages). An id that is not the user's own live artifact matches nothing,
 * so a copied or branched message cannot widen the set.
 */
export async function listChatArtifactIds(input: {
  db: DbClient
  userId: number
  chatId: string
  attachedArtifactIds?: readonly string[]
}): Promise<string[]> {
  const attachedInternalIds = (input.attachedArtifactIds ?? [])
    .slice(0, CHAT_ATTACHED_IDS_LIMIT)
    .map(decodeArtifactId)
    .filter((id): id is number => id !== null)
  const rows = await input.db
    .select({ id: schema.artifacts.id })
    .from(schema.artifacts)
    .where(and(
      eq(schema.artifacts.userId, input.userId),
      attachedInternalIds.length > 0
        ? or(
          eq(schema.artifacts.originChatId, input.chatId),
          inArray(schema.artifacts.id, attachedInternalIds),
        )
        : eq(schema.artifacts.originChatId, input.chatId),
      gt(schema.artifacts.currentVersion, 0),
    ))
    .orderBy(desc(schema.artifacts.updatedAt), desc(schema.artifacts.id))
    .limit(CHAT_ARTIFACT_IDS_LIMIT)

  return rows.map((row) => {
    return encodeArtifactId(row.id)
  })
}

/**
 * Correlated count of the owner's live artifacts created in the selected
 * chat row, so list queries get it in the same statement (no N+1).
 */
export function buildChatArtifactCountColumn(userId: number) {
  return sql<number>`
    (
      select count(*) from ${schema.artifacts}
      where ${schema.artifacts.originChatId} = ${schema.chats.id}
        and ${schema.artifacts.userId} = ${userId}
        and ${schema.artifacts.currentVersion} > 0
        and ${schema.artifacts.takedownAt} is null
    )
  `.mapWith(Number)
}
