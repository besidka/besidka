import { and, desc, eq, gt } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { encodeArtifactId } from '~~/server/utils/artifacts/store'

type DbClient = ReturnType<typeof useDb>

export const CHAT_ARTIFACT_IDS_LIMIT = 200

/**
 * Public ids of the user's artifacts created in this chat, most recently
 * updated first. These are the only artifacts the chat tools may edit.
 */
export async function listChatArtifactIds(input: {
  db: DbClient
  userId: number
  chatId: string
}): Promise<string[]> {
  const rows = await input.db
    .select({ id: schema.artifacts.id })
    .from(schema.artifacts)
    .where(and(
      eq(schema.artifacts.userId, input.userId),
      eq(schema.artifacts.originChatId, input.chatId),
      gt(schema.artifacts.currentVersion, 0),
    ))
    .orderBy(desc(schema.artifacts.updatedAt), desc(schema.artifacts.id))
    .limit(CHAT_ARTIFACT_IDS_LIMIT)

  return rows.map((row) => {
    return encodeArtifactId(row.id)
  })
}
