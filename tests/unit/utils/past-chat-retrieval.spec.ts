import { describe, expect, it } from 'vitest'
import {
  PAST_CHAT_PRE_RETRIEVAL_CALL_PREFIX,
  formatPastChatPreRetrievalTitle,
  isPastChatPreRetrievalCallId,
  isPastChatPreRetrievalPart,
} from '#shared/utils/past-chat-retrieval'

describe('past-chat pre-retrieval ids', () => {
  it('recognises only the pre-retrieval call id prefix', () => {
    expect(isPastChatPreRetrievalCallId(
      `${PAST_CHAT_PRE_RETRIEVAL_CALL_PREFIX}user-1`,
    )).toBe(true)
    expect(isPastChatPreRetrievalCallId('call-1')).toBe(false)
    expect(isPastChatPreRetrievalCallId(undefined)).toBe(false)
  })

  it('matches a search_chats part carrying that id', () => {
    expect(isPastChatPreRetrievalPart({
      type: 'tool-search_chats',
      toolCallId: `${PAST_CHAT_PRE_RETRIEVAL_CALL_PREFIX}user-1`,
    })).toBe(true)
    expect(isPastChatPreRetrievalPart({
      type: 'tool-search_chats',
      toolCallId: 'call-1',
    })).toBe(false)
    expect(isPastChatPreRetrievalPart({
      type: 'tool-read_chat',
      toolCallId: `${PAST_CHAT_PRE_RETRIEVAL_CALL_PREFIX}user-1`,
    })).toBe(false)
    expect(isPastChatPreRetrievalPart(null)).toBe(false)
  })

  it('words the chip title by count', () => {
    expect(formatPastChatPreRetrievalTitle(0)).toBe('No earlier chats used')
    expect(formatPastChatPreRetrievalTitle(1)).toBe('Used 1 earlier chat')
    expect(formatPastChatPreRetrievalTitle(3)).toBe('Used 3 earlier chats')
  })
})
