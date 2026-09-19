import type { UIMessage } from 'ai'
import type { H3Event } from 'h3'
import type { Tools } from '#shared/types/chats.d'
import { createError } from 'evlog'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { insertMessageWithPublicId } from '~~/server/utils/chats/insert-message'
import { normalizeChatError } from '~~/server/utils/chats/errors'
import { markProjectsMemoryStale } from '~~/server/utils/projects/memory'
import { indexMessagesForSearch } from '~~/server/utils/search/index-writer'

export interface PersistUserMessageInput {
  db: ReturnType<typeof useDb>
  event: H3Event
  logger: { set: (fields: Record<string, unknown>) => void }
  userId: number
  chat: {
    id: string
    projectId: string | null
    messages: Array<{
      id: string
      publicId: string | null
      role: string
      parts: UIMessage['parts']
      tools: Tools
      reasoning: 'off' | 'low' | 'medium' | 'high'
    }>
  }
  previousMessages: Array<{
    id: string
    role: string
    parts: UIMessage['parts']
    tools: Tools
    reasoning: 'off' | 'low' | 'medium' | 'high'
  }>
  newMessage: {
    id: string
    parts: UIMessage['parts']
  }
  tools: Tools
  reasoning: 'off' | 'low' | 'medium' | 'high'
}

export function hasMeaningfulAssistantParts(
  parts: UIMessage['parts'],
): boolean {
  return parts.some((part) => {
    if (part.type === 'text' || part.type === 'reasoning') {
      return Boolean(part.text?.trim().length)
    }

    return part.type === 'file'
      || part.type === 'source-url'
      || (
        part.type === 'tool-generate_image'
        && (
          part.state === 'output-available'
          || part.state === 'output-error'
        )
      )
  })
}

// Mirrors the persist/reconcile logic that used to live inline in
// server/api/v1/chats/[slug]/index.post.ts (issue #263): a re-sent user
// message that matches the last persisted one by id, or by content when the
// client regenerated a new id for the same turn, updates the existing row's
// public_id instead of inserting a duplicate. Shared with the deep research
// start endpoint so both entry points reconcile identically.
export async function persistUserMessage(
  input: PersistUserMessageInput,
): Promise<void> {
  const {
    db, event, logger, userId, chat, previousMessages, newMessage, tools,
    reasoning,
  } = input
  const lastUserMessageIndex = previousMessages.findLastIndex((message) => {
    return message.role === 'user'
  })
  const lastPersistedUserMessage = previousMessages[lastUserMessageIndex]
  const trailingEmptyAssistantMessages = previousMessages
    .slice(lastUserMessageIndex + 1)
    .every((message) => {
      return message.role === 'assistant'
        && !hasMeaningfulAssistantParts(message.parts)
    })
  const isDuplicateUserMessage = (
    lastPersistedUserMessage?.role === 'user'
    && trailingEmptyAssistantMessages
    && (
      newMessage.id === lastPersistedUserMessage.id
      || (
        hasSameParts(lastPersistedUserMessage.parts, newMessage.parts)
        && hasSameTools(lastPersistedUserMessage.tools, tools)
        && lastPersistedUserMessage.reasoning === reasoning
      )
    )
  )

  if (isDuplicateUserMessage) {
    const persistedUserMessage = chat.messages.find((message) => {
      return message.publicId === lastPersistedUserMessage.id
        || message.id === lastPersistedUserMessage.id
    })

    if (persistedUserMessage) {
      await db.update(schema.messages)
        .set({ publicId: newMessage.id })
        .where(eq(schema.messages.id, persistedUserMessage.id))
    }

    return
  }

  const activityAt = new Date()

  try {
    const insertedMessage = await insertMessageWithPublicId({
      db,
      values: {
        chatId: chat.id,
        role: 'user',
        parts: newMessage.parts,
        tools,
        reasoning,
      },
      publicId: newMessage.id,
      ignoreConflict: true,
    })

    await db.update(schema.chats)
      .set({ activityAt })
      .where(eq(schema.chats.id, chat.id))

    if (insertedMessage) {
      await indexMessagesForSearch({
        db,
        userId,
        messages: [{
          id: insertedMessage.id,
          parts: newMessage.parts,
        }],
        logger,
        stage: 'persist-user-message',
      })
    }

    if (chat.projectId) {
      await db.update(schema.projects)
        .set({ activityAt })
        .where(eq(schema.projects.id, chat.projectId))

      await markProjectsMemoryStale([chat.projectId], userId, db)
    }
  } catch (exception) {
    logger.set({
      stage: 'persist-user-message',
      errorCode: 'message-persist-failed',
      errorMessage: exception instanceof Error
        ? exception.message
        : String(exception),
    })

    throw createError({
      ...normalizeChatError({
        error: exception,
        event,
        code: 'message-persist-failed',
        message: 'The message could not be saved.',
      }),
    })
  }
}

function hasSameParts(
  leftParts: UIMessage['parts'],
  rightParts: UIMessage['parts'],
): boolean {
  return JSON.stringify(leftParts || []) === JSON.stringify(rightParts || [])
}

function hasSameTools(
  leftTools: Tools,
  rightTools: Tools,
): boolean {
  return JSON.stringify(leftTools || []) === JSON.stringify(rightTools || [])
}
