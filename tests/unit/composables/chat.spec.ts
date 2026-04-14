import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  applyChatErrorToMessages,
  buildChatErrorLines,
  buildChatErrorMessage,
  isChatErrorTextPart,
  normalizeChatClientError,
  shouldSurfaceChatError,
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

  it('normalizes load errors into a user-friendly transport failure', () => {
    const result = normalizeChatClientError(
      new Error('Load Error'),
      { requestId: 'transport-123' },
    )

    expect(result).toEqual({
      code: 'unknown',
      message: 'The chat response failed to load.',
      why: 'The connection was interrupted before the response finished streaming.',
      fix: 'Retry the message. If it keeps failing, contact support with the request ID.',
      status: 500,
      requestId: 'transport-123',
    })
  })

  it('assigns a local correlation id for load errors without a server request id', () => {
    const result = normalizeChatClientError(new Error('Failed to fetch'))

    expect(result).toEqual(expect.objectContaining({
      code: 'unknown',
      message: 'The chat response failed to load.',
      requestId: expect.any(String),
    }))
    expect(result.requestId).toHaveLength(26)
  })

  it('does not treat raw provider error objects as normalized chat payloads', async () => {
    const { normalizeChatError } = await import(
      '../../../server/utils/chats/errors'
    )

    const result = normalizeChatError({
      error: {
        type: 'error',
        error: {
          type: 'tokens',
          code: 'rate_limit_exceeded',
          message: 'Rate limit reached for gpt-5.4 on tokens per min (TPM). Please try again in 3.984s.',
        },
      },
      providerId: 'openai',
    })

    expect(result).toEqual(expect.objectContaining({
      code: 'provider-rate-limit',
      providerId: 'openai',
      why: 'The upstream model provider is temporarily throttling requests.',
    }))
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
        error: {
          code: 'provider-unavailable',
          message: 'The provider failed to process this request.',
          why: 'The upstream model provider returned an internal error.',
          requestId: 'cf-ray-123',
        },
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
          error: {
            code: 'provider-rate-limit',
            message: 'The provider is rate limiting requests right now.',
            fix: 'Wait a moment and retry the message.',
          },
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
          error: {
            code: 'provider-unavailable',
            message: 'The provider failed to process this request.',
          },
        },
      ],
    }))
  })

  it('builds chat error lines in the rendered order', () => {
    expect(buildChatErrorLines({
      code: 'message-persist-failed',
      message: 'The response could not be saved.',
      why: 'The response could not be stored in the database.',
      fix: 'Retry the message. If it keeps failing, contact support with the request ID.',
      requestId: 'cf-ray-123',
    })).toEqual([
      'The response could not be saved.',
      'The response could not be stored in the database.',
      'Retry the message. If it keeps failing, contact support with the request ID.',
      'Request ID: cf-ray-123',
    ])
  })

  it('identifies text parts that carry chat error metadata', () => {
    expect(isChatErrorTextPart({
      type: 'text',
      text: 'The response could not be saved.',
      error: {
        code: 'message-persist-failed',
        message: 'The response could not be saved.',
      },
    } as UIMessage['parts'][number])).toBe(true)

    expect(isChatErrorTextPart({
      type: 'text',
      text: 'Plain text',
    } as UIMessage['parts'][number])).toBe(false)
  })

  it('does not surface rate-limit errors when assistant text is already visible', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      } as UIMessage,
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Completed answer' }],
      } as UIMessage,
    ]

    expect(shouldSurfaceChatError(messages, {
      code: 'provider-rate-limit',
      message: 'The provider is rate limiting requests right now.',
    })).toBe(false)
  })

  it('still surfaces rate-limit errors when no assistant text was produced', () => {
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

    expect(shouldSurfaceChatError(messages, {
      code: 'provider-rate-limit',
      message: 'The provider is rate limiting requests right now.',
    })).toBe(true)
  })

  it('does not surface raw rate-limit errors when assistant text is already visible', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      } as UIMessage,
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Completed answer' }],
      } as UIMessage,
    ]

    expect(shouldSurfaceChatError(messages, {
      code: 'unknown',
      message: 'Rate limit reached for gpt-5.4-mini on tokens per min (TPM). Please try again in 3.5s.',
    })).toBe(false)
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
