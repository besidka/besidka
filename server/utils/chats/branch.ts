import type { BatchItem } from 'drizzle-orm/batch'
import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'
import { createError } from 'evlog'
import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import * as schema from '~~/server/db/schema'
import { refreshProjectActivityAt } from '~~/server/utils/projects/activity'
import { markProjectsMemoryStale } from '~~/server/utils/projects/memory'
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

/**
 * Copies an owned chat, or its first messages up to and including
 * `messageId` (a message public id or internal id), into a new chat in the
 * same project with the same memory exclusion. The legal consent gate is the
 * caller's job.
 */
export async function branchChat(
  db: ReturnType<typeof useDb>,
  userId: number,
  chatSlug: string,
  messageId: string | undefined,
  logger?: SearchIndexLogger,
): Promise<{ id: string, slug: string, title: string }> {
  const chat = await db.query.chats.findFirst({
    where: {
      slug: chatSlug,
      userId,
    },
    columns: {
      id: true,
      title: true,
      projectId: true,
      memoryExcluded: true,
    },
    with: {
      messages: {
        columns: {
          id: true,
          publicId: true,
          role: true,
          parts: true,
          tools: true,
          reasoning: true,
          usage: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found.',
      status: 404,
    })
  }

  const persistedMessages = chat.messages.filter((message) => {
    return isPersistedMessageRole(message.role)
  })

  let messagesToCopy = persistedMessages

  if (messageId) {
    const branchIndex = persistedMessages.findIndex((message) => {
      return message.publicId === messageId
        || message.id === messageId
    })

    if (branchIndex === -1) {
      throw createError({
        message: 'Message not found in this chat.',
        status: 400,
      })
    }

    messagesToCopy = persistedMessages.slice(0, branchIndex + 1)
  }

  const title = buildBranchTitle(chat.title)

  const newChat = await db
    .insert(schema.chats)
    .values({
      userId,
      title,
      ...(chat.projectId ? { projectId: chat.projectId } : {}),
      ...(chat.memoryExcluded ? { memoryExcluded: true } : {}),
    })
    .returning({
      id: schema.chats.id,
      slug: schema.chats.slug,
    })
    .get()

  await insertBranchedMessages(
    db,
    newChat.id,
    messagesToCopy.map((message) => {
      return {
        role: message.role,
        parts: message.parts,
        tools: message.tools,
        reasoning: message.reasoning,
        usage: message.usage,
        createdAt: message.createdAt,
      }
    }),
    userId,
    logger,
  )

  await refreshProjectActivityAt([chat.projectId], userId, db)
  await markProjectsMemoryStale([chat.projectId], userId, db)

  return { id: newChat.id, slug: newChat.slug, title }
}
