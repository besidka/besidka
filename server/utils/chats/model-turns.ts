import type { UIMessage } from 'ai'
import { ulid } from 'ulid'

export const DELETED_USER_MESSAGE_PLACEHOLDER_TEXT
  = '(earlier message deleted)'

export const MISSING_ASSISTANT_REPLY_PLACEHOLDER_TEXT = '(no reply)'

/**
 * Shapes the model-facing turn order without touching persisted history.
 *
 * Google's Generative Language API rejects a `contents` array whose first
 * turn is not `user` — a chat's persisted history can legitimately start
 * with an assistant message after the single-message-delete feature removes
 * the original leading user turn, so a synthetic user turn is prepended for
 * the Google provider only.
 *
 * Consecutive user turns arise because reasoning-only, source-only,
 * tool-only and failure-text-only assistant replies are persisted but then
 * sanitized away for the model, which drops the whole assistant message
 * (a turn whose reply was never persisted does the same). Consecutive
 * assistant turns arise from single-message delete removing the user turn
 * between two replies. Only the Anthropic converter merges adjacent
 * same-role turns; the other providers send them separately. A synthetic
 * assistant turn between adjacent user turns, and a synthetic user turn
 * between adjacent assistant turns, keeps the model-facing array strictly
 * alternating for every provider instead of depending on each backend to
 * tolerate same-role runs.
 *
 * The result is scoped to the array actually sent to the model. It must
 * never replace `messagesForAI`, since that array also backs
 * `originalMessages` for AI SDK stream bookkeeping and must stay the true,
 * unmodified message history. The input is never mutated, and the same
 * reference is returned when nothing needs inserting.
 */
export function buildMessagesForModel(
  messages: UIMessage[],
  modelProviderId: string | undefined,
): UIMessage[] {
  const needsLeadingPlaceholder = modelProviderId === 'google'
    && messages[0]?.role === 'assistant'
  const hasAdjacentSameRoleTurns = messages.some((message, index) => {
    return isConversationRole(message.role)
      && messages[index - 1]?.role === message.role
  })

  if (!needsLeadingPlaceholder && !hasAdjacentSameRoleTurns) {
    return messages
  }

  const alternatingMessages: UIMessage[] = []

  if (needsLeadingPlaceholder) {
    alternatingMessages.push(buildDeletedUserMessagePlaceholder())
  }

  for (const message of messages) {
    const previousMessage = alternatingMessages.at(-1)

    if (message.role === 'user' && previousMessage?.role === 'user') {
      alternatingMessages.push(buildMissingAssistantReplyPlaceholder())
    }

    if (message.role === 'assistant' && previousMessage?.role === 'assistant') {
      alternatingMessages.push(buildDeletedUserMessagePlaceholder())
    }

    alternatingMessages.push(message)
  }

  return alternatingMessages
}

function isConversationRole(role: UIMessage['role']): boolean {
  return role === 'user' || role === 'assistant'
}

function buildDeletedUserMessagePlaceholder(): UIMessage {
  return {
    id: `deleted-user-placeholder-${ulid()}`,
    role: 'user',
    parts: [{
      type: 'text',
      text: DELETED_USER_MESSAGE_PLACEHOLDER_TEXT,
    }],
  }
}

function buildMissingAssistantReplyPlaceholder(): UIMessage {
  return {
    id: `missing-reply-placeholder-${ulid()}`,
    role: 'assistant',
    parts: [{
      type: 'text',
      text: MISSING_ASSISTANT_REPLY_PLACEHOLDER_TEXT,
    }],
  }
}
