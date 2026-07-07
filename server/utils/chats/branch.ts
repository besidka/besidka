import type { BatchItem } from 'drizzle-orm/batch'
import * as schema from '~~/server/db/schema'

const MESSAGE_BATCH_SIZE = 50

type BranchMessageValues = Omit<typeof schema.messages.$inferInsert, 'chatId'>

export function buildBranchTitle(sourceTitle: string | null): string {
  return sourceTitle
    ? `Branch: ${sourceTitle.replace(/Branch: /g, '')}`
    : 'Branch'
}

export async function insertBranchedMessages(
  db: ReturnType<typeof useDb>,
  chatId: string,
  messages: BranchMessageValues[],
): Promise<void> {
  for (let offset = 0; offset < messages.length; offset += MESSAGE_BATCH_SIZE) {
    const chunk = messages.slice(offset, offset + MESSAGE_BATCH_SIZE)
    const inserts = chunk.map((message) => {
      return db
        .insert(schema.messages)
        .values({
          chatId,
          ...message,
        })
    }) as unknown as [BatchItem<'sqlite'>]

    await db.batch(inserts)
  }
}
