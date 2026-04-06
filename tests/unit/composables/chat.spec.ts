import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  applyChatErrorToMessages,
  buildChatErrorMessage,
  normalizeChatClientError,
} from '../../../app/composables/chat'

describe('chat error helpers', () => {
  it('parses structured stream errors from the AI SDK', () => {
    const result = normalizeChatClientError(new Error(JSON.stringify({
      code: 'provider-rate-limit',
      message: 'The provider is rate limiting requests right now.',
      why: 'The upstream model provider is temporarily throttling requests.',
      providerRequestId: 'req_123',
      status: 429,
    })))

    expect(result).toEqual({
      code: 'provider-rate-limit',
      message: 'The provider is rate limiting requests right now.',
      why: 'The upstream model provider is temporarily throttling requests.',
      providerRequestId: 'req_123',
      status: 429,
    })
  })

  it('replaces an empty assistant placeholder with an inline error message', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      } as UIMessage,
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [],
      } as UIMessage,
    ]

    const nextMessages = applyChatErrorToMessages(messages, {
      code: 'provider-unavailable',
      message: 'The provider failed to process this request.',
      why: 'The upstream model provider returned an internal error.',
      requestId: 'cf-ray-123',
    })

    expect(nextMessages).toHaveLength(2)
    expect(nextMessages[1]).toEqual(expect.objectContaining({
      id: 'assistant-1',
      parts: [{
        type: 'text',
        text: buildChatErrorMessage({
          code: 'provider-unavailable',
          message: 'The provider failed to process this request.',
          why: 'The upstream model provider returned an internal error.',
          requestId: 'cf-ray-123',
        }),
      }],
    }))
  })

  it('appends a separate assistant error when content already exists', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      } as UIMessage,
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Partial answer' }],
      } as UIMessage,
    ]

    const nextMessages = applyChatErrorToMessages(messages, {
      code: 'provider-rate-limit',
      message: 'The provider is rate limiting requests right now.',
      fix: 'Wait a moment and retry the message.',
    })

    expect(nextMessages).toHaveLength(3)
    expect(nextMessages[1]).toEqual(messages[1])
    expect(nextMessages[2]).toEqual(expect.objectContaining({
      role: 'assistant',
      parts: [{
        type: 'text',
        text: buildChatErrorMessage({
          code: 'provider-rate-limit',
          message: 'The provider is rate limiting requests right now.',
          fix: 'Wait a moment and retry the message.',
        }),
      }],
    }))
  })

  it('preserves streamed source parts when adding an error', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      } as UIMessage,
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{
          type: 'source-url',
          sourceId: 'source-1',
          url: 'https://example.com',
          title: 'Example',
        }],
      } as UIMessage,
    ]

    const nextMessages = applyChatErrorToMessages(messages, {
      code: 'provider-unavailable',
      message: 'The provider failed to process this request.',
    })

    expect(nextMessages).toHaveLength(3)
    expect(nextMessages[1]).toEqual(messages[1])
    expect(nextMessages[2]).toEqual(expect.objectContaining({
      role: 'assistant',
      parts: [{
        type: 'text',
        text: buildChatErrorMessage({
          code: 'provider-unavailable',
          message: 'The provider failed to process this request.',
        }),
      }],
    }))
  })
})
