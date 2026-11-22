import { isToolUIPart } from 'ai'
import type { UIMessage } from 'ai'
import { and, asc, eq, gt, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createReplyStoppedPart,
  hasReplyStoppedPart,
} from '#shared/utils/chat-reply-stopped'
import { deleteChatMessage } from '~~/server/utils/chats/lifecycle'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'

type Db = ReturnType<typeof useDb>

const UNFINISHED_TOOL_STATES = new Set(['input-streaming', 'input-available'])

/**
 * The parts a stopped reply is stored with: what streamed before the stop,
 * text and reasoning marked done instead of still streaming, without tool
 * calls that never got a result (they would show as running forever), and
 * the stopped marker last.
 */
export function finalizeStoppedReplyParts(
  parts: UIMessage['parts'],
): UIMessage['parts'] {
  const finishedParts = parts
    .filter((part) => {
      return !isToolUIPart(part) || !UNFINISHED_TOOL_STATES.has(part.state)
    })
    .map((part) => {
      if (part.type !== 'text' && part.type !== 'reasoning') {
        return part
      }

      return part.state === 'streaming' ? { ...part, state: 'done' } : part
    })

  return [
    ...finishedParts,
    createReplyStoppedPart() as unknown as UIMessage['parts'][number],
  ] as UIMessage['parts']
}

/**
 * The ids of the stopped replies stored right after the user message at
 * `userMessageIndex`, up to the next user message. A retry of that message
 * leaves them out of the model's history and replaces them.
 */
export function findStoppedRepliesAfter(
  messages: ReadonlyArray<{ id: string, role: string, parts: unknown }>,
  userMessageIndex: number,
): string[] {
  if (userMessageIndex < 0) {
    return []
  }

  const stoppedIds: string[] = []

  for (const message of messages.slice(userMessageIndex + 1)) {
    if (message.role === 'user') {
      break
    }

    if (message.role === 'assistant' && hasReplyStoppedPart(message.parts)) {
      stoppedIds.push(message.id)
    }
  }

  return stoppedIds
}

function userMessageRowId(
  db: Db,
  chatId: string,
  userMessagePublicId: string,
) {
  return db.select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(
      eq(schema.messages.chatId, chatId),
      eq(schema.messages.publicId, userMessagePublicId),
    ))
}

export interface MessageAfterUserMessage {
  id: string
  publicId: string | null
  role: string
  parts: unknown
}

/**
 * Every message stored after the user message, oldest first. Read from D1,
 * which is consistent, right before a run stores its reply: KV can still
 * show a stopped run as current for one cache lifetime, so this is what
 * keeps one reply per message.
 */
export async function loadMessagesAfterUserMessage(input: {
  db: Db
  chatId: string
  userMessagePublicId: string
}): Promise<MessageAfterUserMessage[]> {
  return await input.db.select({
    id: schema.messages.id,
    publicId: schema.messages.publicId,
    role: schema.messages.role,
    parts: schema.messages.parts,
  })
    .from(schema.messages)
    .where(and(
      eq(schema.messages.chatId, input.chatId),
      gt(
        schema.messages.id,
        sql`(${userMessageRowId(
          input.db,
          input.chatId,
          input.userMessagePublicId,
        )})`,
      ),
    ))
    .orderBy(asc(schema.messages.id))
}

/**
 * The messages of the same turn: those before the next user message.
 */
export function takeTurnReplies(
  messages: readonly MessageAfterUserMessage[],
): MessageAfterUserMessage[] {
  const nextUserIndex = messages.findIndex(message => message.role === 'user')

  return nextUserIndex < 0 ? [...messages] : messages.slice(0, nextUserIndex)
}

/**
 * Deletes the given stopped replies, right before a retry of their user
 * message stores its own reply, so the chat keeps one answer per message.
 * Uses the regular message delete, which also removes files the stopped
 * reply produced. A failure is logged and the new reply is still stored.
 * Returns how many replies it deleted.
 */
export async function deleteStoppedReplies(input: {
  db: Db
  userId: number
  chatId: string
  replies: readonly MessageAfterUserMessage[]
  logger: LoggerLike
}): Promise<number> {
  let deletedCount = 0

  for (const reply of input.replies) {
    if (reply.role !== 'assistant' || !hasReplyStoppedPart(reply.parts)) {
      continue
    }

    try {
      await deleteChatMessage(
        input.db,
        input.userId,
        input.chatId,
        reply.publicId ?? reply.id,
        input.logger,
      )
      deletedCount += 1
    } catch (exception) {
      input.logger.set({
        attributes: {
          stoppedReplies: { deleteError: exceptionMessage(exception) },
        },
      })
    }
  }

  return deletedCount
}
