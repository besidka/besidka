import type { UIMessage } from 'ai'
import type { H3Event } from 'h3'
import type { Tools } from '#shared/types/chats.d'
import { createError } from 'evlog'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { insertMessageWithPublicId } from '~~/server/utils/chats/insert-message'
import { normalizeChatError } from '~~/server/utils/chats/errors'
import { markProjectsMemoryStale } from '~~/server/utils/projects/memory'

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
  const lastPersistedMessage = previousMessages[previousMessages.length - 1]
  const isDuplicateUserMessage = (
    lastPersistedMessage?.role === 'user'
    && (
      newMessage.id === lastPersistedMessage.id
      || (
        hasSameParts(lastPersistedMessage.parts, newMessage.parts)
        && hasSameTools(lastPersistedMessage.tools, tools)
        && lastPersistedMessage.reasoning === reasoning
      )
    )
  )

  if (isDuplicateUserMessage) {
    const lastMessage = chat.messages[chat.messages.length - 1]

    if (lastMessage) {
      await db.update(schema.messages)
        .set({ publicId: newMessage.id })
        .where(eq(schema.messages.id, lastMessage.id))
    }

    return
  }

  const activityAt = new Date()

  try {
    await insertMessageWithPublicId({
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
