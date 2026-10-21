import type { UIMessage } from 'ai'
import { ulid } from 'ulid'

export const GOOGLE_LEADING_ASSISTANT_PLACEHOLDER_TEXT
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
 * (a turn whose reply was never persisted does the same). Only the
 * Anthropic converter merges adjacent user turns; the other providers send
 * them as separate entries and some (DeepSeek's reasoner) reject them, so a
 * synthetic assistant turn is inserted between them for every provider.
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
  const hasAdjacentUserTurns = messages.some((message, index) => {
    return message.role === 'user' && messages[index - 1]?.role === 'user'
  })

  if (!needsLeadingPlaceholder && !hasAdjacentUserTurns) {
    return messages
  }

  const alternatingMessages: UIMessage[] = []

  if (needsLeadingPlaceholder) {
    alternatingMessages.push(buildGoogleLeadingAssistantPlaceholder())
  }

  for (const message of messages) {
    if (message.role === 'user' && alternatingMessages.at(-1)?.role === 'user') {
      alternatingMessages.push(buildMissingAssistantReplyPlaceholder())
    }

    alternatingMessages.push(message)
  }

  return alternatingMessages
}

function buildGoogleLeadingAssistantPlaceholder(): UIMessage {
  return {
    id: `google-leading-placeholder-${ulid()}`,
    role: 'user',
    parts: [{
      type: 'text',
      text: GOOGLE_LEADING_ASSISTANT_PLACEHOLDER_TEXT,
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
