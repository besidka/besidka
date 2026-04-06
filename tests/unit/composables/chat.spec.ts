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

  it('merges the error into the last assistant message when content exists', () => {
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

    expect(nextMessages).toHaveLength(2)
    expect(nextMessages[1]).toEqual(expect.objectContaining({
      id: 'assistant-1',
      parts: [
        { type: 'text', text: 'Partial answer' },
        {
          type: 'text',
          text: buildChatErrorMessage({
            code: 'provider-rate-limit',
            message: 'The provider is rate limiting requests right now.',
            fix: 'Wait a moment and retry the message.',
          }),
        },
      ],
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

    expect(nextMessages).toHaveLength(2)
    expect(nextMessages[1]).toEqual(expect.objectContaining({
      id: 'assistant-1',
      parts: [
        {
          type: 'source-url',
          sourceId: 'source-1',
          url: 'https://example.com',
          title: 'Example',
        },
        {
          type: 'text',
          text: buildChatErrorMessage({
            code: 'provider-unavailable',
            message: 'The provider failed to process this request.',
          }),
        },
      ],
    }))
  })

  it('preserves explicit setup errors instead of replacing them with generic text', async () => {
    const { normalizeChatError } = await import(
      '../../../server/utils/chats/errors'
    )

    const result = normalizeChatError({
      error: new Error('Please select a model to continue.'),
      status: 400,
    })

    expect(result).toEqual(expect.objectContaining({
      code: 'unknown',
      message: 'Please select a model to continue.',
      status: 400,
    }))
  })

  it('reads cf-ray from the H3 event when available', async () => {
    const { normalizeChatError } = await import(
      '../../../server/utils/chats/errors'
    )

    const result = normalizeChatError({
      error: new Error('Persistence failed'),
      event: {
        node: {
          req: {
            headers: {
              'cf-ray': 'cf-ray-123',
            },
          },
        },
      } as any,
    })

    expect(result).toEqual(expect.objectContaining({
      requestId: 'cf-ray-123',
    }))
  })

  it('preserves structured chat payloads without downgrading their fields', async () => {
    const { normalizeChatError } = await import(
      '../../../server/utils/chats/errors'
    )

    const result = normalizeChatError({
      error: {
        code: 'message-persist-failed',
        message: 'The response could not be saved.',
        why: 'The response could not be stored in the database.',
        fix: 'Retry the message. If it keeps failing, contact support.',
        status: 500,
        requestId: 'cf-ray-123',
        providerId: 'openai',
        providerRequestId: 'req_123',
      },
    })

    expect(result).toEqual({
      code: 'message-persist-failed',
      message: 'The response could not be saved.',
      why: 'The response could not be stored in the database.',
      fix: 'Retry the message. If it keeps failing, contact support.',
      status: 500,
      requestId: 'cf-ray-123',
      providerId: 'openai',
      providerRequestId: 'req_123',
    })
  })
})
