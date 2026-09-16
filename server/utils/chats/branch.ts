import type { BatchItem } from 'drizzle-orm/batch'
import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  indexMessagesForSearch,
  type SearchIndexLogger,
} from '~~/server/utils/search/index-writer'

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
  userId: number,
  logger?: SearchIndexLogger,
): Promise<void> {
  for (let offset = 0; offset < messages.length; offset += MESSAGE_BATCH_SIZE) {
    const chunk = messages.slice(offset, offset + MESSAGE_BATCH_SIZE)
    const inserts = chunk.map((message) => {
      return db
        .insert(schema.messages)
        .values({
          chatId,
          ...message,
          parts: stripToolPartsFromBranchedMessage(message.parts),
        })
    }) as unknown as [BatchItem<'sqlite'>]

    await db.batch(inserts)
  }

  if (!messages.length) {
    return
  }

  const insertedMessages = await db.select({
    id: schema.messages.id,
    parts: schema.messages.parts,
  })
    .from(schema.messages)
    .where(eq(schema.messages.chatId, chatId))

  await indexMessagesForSearch({
    db,
    userId,
    messages: insertedMessages,
    logger,
    stage: 'branch-insert',
  })
}

export function stripToolPartsFromBranchedMessage(
  parts: unknown,
): UIMessage['parts'] {
  if (!Array.isArray(parts)) {
    return []
  }

  return parts.filter(isNonToolMessagePart)
}

function isNonToolMessagePart(
  part: unknown,
): part is UIMessage['parts'][number] {
  if (typeof part !== 'object' || part === null || !('type' in part)) {
    return false
  }

  const type = part.type

  return typeof type === 'string'
    && type !== 'dynamic-tool'
    && !type.startsWith('tool-')
}
