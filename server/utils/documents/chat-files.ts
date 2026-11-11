import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export async function listChatDocumentFileIds(
  chatId: string,
  ownerUserId: number,
): Promise<Array<{ fileId: string, storageKey: string }>> {
  const rows = await useDb()
    .select({
      fileId: schema.files.id,
      storageKey: schema.files.storageKey,
    })
    .from(schema.documents)
    .innerJoin(schema.files, and(
      eq(schema.files.id, schema.documents.fileId),
      eq(schema.files.userId, schema.documents.userId),
    ))
    .where(and(
      eq(schema.documents.originChatId, chatId),
      eq(schema.documents.userId, ownerUserId),
      eq(schema.documents.status, 'ready'),
    ))

  return rows
}
