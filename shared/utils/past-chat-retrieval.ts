export const PAST_CHAT_PRE_RETRIEVAL_CALL_PREFIX = 'past-chat-pre-retrieval-'

export function isPastChatPreRetrievalCallId(value: unknown): boolean {
  return typeof value === 'string'
    && value.startsWith(PAST_CHAT_PRE_RETRIEVAL_CALL_PREFIX)
}

export function isPastChatPreRetrievalPart(part: unknown): boolean {
  const candidate = part as { type?: unknown, toolCallId?: unknown } | null

  return candidate?.type === 'tool-search_chats'
    && isPastChatPreRetrievalCallId(candidate.toolCallId)
}

export function formatPastChatPreRetrievalTitle(count: number): string {
  if (count === 0) {
    return 'No earlier chats used'
  }

  return count === 1 ? 'Used 1 earlier chat' : `Used ${count} earlier chats`
}
