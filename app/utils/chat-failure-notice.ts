import type { UIMessage } from 'ai'
import type { ChatErrorPayload } from '#shared/types/chat-errors.d'
import { parsePersistedChatFailureNotice } from '#shared/utils/chat-failure-text'

/**
 * Reshapes a persisted synthetic failure notice (image-generation,
 * empty-answer, or oversized-response) into a `ChatErrorPayload` so it can
 * render through the same `ChatErrorCard` component as a live turn error,
 * instead of the plain markdown text bubble it would otherwise get once
 * loaded back from persistence. Only assistant text parts are eligible —
 * a user message that happens to contain the same sentence must still
 * render as ordinary markdown.
 */
export function getPersistedFailureErrorPayload(
  message: Pick<UIMessage, 'role'>,
  part: UIMessage['parts'][number] | undefined,
): ChatErrorPayload | null {
  if (message.role !== 'assistant' || !part || part.type !== 'text') {
    return null
  }

  const notice = parsePersistedChatFailureNotice(part.text)

  if (!notice) {
    return null
  }

  return {
    code: 'unknown',
    message: notice.message,
    requestId: notice.requestId,
  }
}

/**
 * Deliberately returns a plain `boolean`, not a `part is TextUIPart` type
 * predicate — that predicate would exactly match the discriminated union's
 * "text" member, and a false branch in a template's `v-else-if` chain would
 * then narrow `part` to `never` for every following "text" check (unlike
 * `isChatErrorTextPart`, whose predicate type is a strict subtype of
 * `TextUIPart`, so the union member survives its negated branch).
 */
export function isPersistedFailureTextPart(
  message: Pick<UIMessage, 'role'>,
  part: UIMessage['parts'][number] | undefined,
): boolean {
  return getPersistedFailureErrorPayload(message, part) !== null
}
