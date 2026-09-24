import type { UIMessage } from 'ai'
import { computed, nextTick, shallowRef, triggerRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../../../shared/types/chats.d'
import {
  applyChatErrorToMessages,
  buildChatErrorLines,
  buildChatErrorMessage,
  createReasoningSegmentTracker,
  findLastUserMessageTools,
  foldReasoningSegment,
  getRenderableChatMessages,
  hasVisibleAssistantContent,
  hasRetryableAssistantFailure,
  isAutoRecoverableTransportInterruption,
  isChatErrorTextPart,
  isFailureOnlyAssistantMessage,
  isReasoningActiveForTurn,
  normalizeChatClientError,
  REASONING_SEGMENT_GRACE_WINDOW_MS,
  shouldBlockGenerationRecovery,
  shouldDisplayRegenerate,
  shouldForceGenericLoadingIndicator,
  shouldShowGenericLoadingIndicator,
  shouldNotifyGenerationReadyWhileHidden,
  shouldRecoverGeneration,
  shouldRecoverInterruptedGeneration,
  shouldSurfaceChatError,
  shouldSurfaceEmptyAssistantResponse,
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

  it('does not accept generic JSON errors as structured chat payloads', () => {
    const result = normalizeChatClientError(new Error(JSON.stringify({
      message: 'Worker exceeded memory limit.',
    })))

    expect(result).toEqual(expect.objectContaining({
      code: 'unknown',
      message: 'Worker exceeded memory limit.',
    }))
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

  it('detects empty assistant responses after a stream closes cleanly', () => {
    expect(shouldSurfaceEmptyAssistantResponse([
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      } as UIMessage,
    ])).toBe(true)

    expect(shouldSurfaceEmptyAssistantResponse([
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
    ])).toBe(true)
  })

  it('does not flag assistant responses with visible content as empty', () => {
    expect(shouldSurfaceEmptyAssistantResponse([
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
    ])).toBe(false)
  })

  it('marks a hydrated empty assistant response as retryable', () => {
    expect(hasRetryableAssistantFailure([
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
    ])).toBe(true)
  })

  it('does not mark a meaningful assistant response as retryable', () => {
    expect(hasRetryableAssistantFailure([
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
    ])).toBe(false)
  })

  it('does not mark a lone empty assistant as retryable', () => {
    expect(hasRetryableAssistantFailure([
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [],
      } as UIMessage,
    ])).toBe(false)
  })

  it('marks a persisted empty-answer notice as retryable after reload', () => {
    expect(hasRetryableAssistantFailure([
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      } as UIMessage,
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          { type: 'tool-web_search', state: 'output-available' },
          {
            type: 'source-url',
            sourceId: 'source-1',
            url: 'https://example.com',
          },
          {
            type: 'text',
            text: 'The model finished searching but didn\'t write an'
              + ' answer. Try again or pick another model.',
          },
        ],
      } as UIMessage,
    ])).toBe(true)
  })

  it('marks a persisted image-generation failure notice as retryable', () => {
    expect(hasRetryableAssistantFailure([
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Draw a cat' }],
      } as UIMessage,
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          {
            type: 'text',
            text: 'Image generation failed. Revise the prompt or try a'
              + ' different provider. (ref: abc123)',
          },
        ],
      } as UIMessage,
    ])).toBe(true)
  })

  it('marks a persisted gateway generated-image-save failure notice as '
    + 'retryable', () => {
    expect(hasRetryableAssistantFailure([
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Draw a cat' }],
      } as UIMessage,
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          {
            type: 'text',
            text: 'An image was generated but could not be saved.',
          },
        ],
      } as UIMessage,
    ])).toBe(true)
  })

  it('does not mark an image failure retryable when a real image succeeded', () => {
    expect(isFailureOnlyAssistantMessage({
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-generate_image',
          state: 'output-available',
          output: { status: 'ready' },
        },
        {
          type: 'text',
          text: 'Image generation failed. Revise the prompt or try a'
            + ' different provider.',
        },
      ],
    } as unknown as UIMessage)).toBe(false)
  })

  it('does not mark a normal reply with sources as retryable', () => {
    expect(hasRetryableAssistantFailure([
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      } as UIMessage,
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          {
            type: 'source-url',
            sourceId: 'source-1',
            url: 'https://example.com',
          },
          { type: 'text', text: 'Here is a real answer.' },
        ],
      } as UIMessage,
    ])).toBe(false)
  })

  it('recovers an interrupted generation left with no assistant reply', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      } as UIMessage,
    ]

    expect(shouldRecoverInterruptedGeneration('ready', messages)).toBe(true)
    expect(shouldRecoverInterruptedGeneration('error', messages)).toBe(true)
  })

  it('recovers an interrupted generation left with an empty assistant reply', () => {
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

    expect(shouldRecoverInterruptedGeneration('ready', messages)).toBe(true)
  })

  it('does not recover while a generation is actively in flight', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      } as UIMessage,
    ]

    expect(shouldRecoverInterruptedGeneration('submitted', messages)).toBe(false)
    expect(shouldRecoverInterruptedGeneration('streaming', messages)).toBe(false)
  })

  it('does not recover when the assistant already replied', () => {
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

    expect(shouldRecoverInterruptedGeneration('ready', messages)).toBe(false)
  })

  it('does not show regenerate while a fresh assistant message is streaming', () => {
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

    expect(
      shouldDisplayRegenerate('streaming', false, messages, false),
    ).toBe(false)
  })

  it('does not show regenerate for a lone empty assistant while streaming', () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [],
      } as UIMessage,
    ]

    expect(
      shouldDisplayRegenerate('streaming', false, messages, false),
    ).toBe(false)
  })

  it('shows regenerate for a genuinely errored empty assistant reply', () => {
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

    expect(
      shouldDisplayRegenerate('error', false, messages, false),
    ).toBe(true)
  })

  it('shows regenerate after the user stops an in-flight generation', () => {
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

    expect(
      shouldDisplayRegenerate('ready', true, messages, false),
    ).toBe(true)
  })

  it('does not show regenerate for a research model even when otherwise retryable', () => {
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

    expect(
      shouldDisplayRegenerate('error', false, messages, true),
    ).toBe(false)
  })

  it('auto-recovers from a Safari "Load failed" disconnect even when the SDK does not flag isDisconnect', () => {
    // Reproduces the real-world iOS PWA bug: the AI SDK only sets
    // isDisconnect for a TypeError whose message contains "fetch" or
    // "network" — Safari's actual wording ("Load failed") never matches, so
    // this must fall back to the broader transport-error recognizer instead
    // of trusting the SDK flag alone.
    const parsedError = normalizeChatClientError(new Error('Load failed'))

    expect(isAutoRecoverableTransportInterruption(parsedError, {
      isAbort: false,
      isDisconnect: false,
      isTestChat: false,
    })).toBe(true)
  })

  it('auto-recovers when the SDK does flag isDisconnect', () => {
    expect(isAutoRecoverableTransportInterruption(null, {
      isAbort: false,
      isDisconnect: true,
      isTestChat: false,
    })).toBe(true)
  })

  it('does not auto-recover a deliberate user-initiated stop', () => {
    const parsedError = normalizeChatClientError(new Error('Load failed'))

    expect(isAutoRecoverableTransportInterruption(parsedError, {
      isAbort: true,
      isDisconnect: false,
      isTestChat: false,
    })).toBe(false)
  })

  it('does not auto-recover on the dev test route', () => {
    const parsedError = normalizeChatClientError(new Error('Load failed'))

    expect(isAutoRecoverableTransportInterruption(parsedError, {
      isAbort: false,
      isDisconnect: true,
      isTestChat: true,
    })).toBe(false)
  })

  it('does not treat an unrelated error as auto-recoverable', () => {
    const parsedError = normalizeChatClientError(new Error('Something else'))

    expect(isAutoRecoverableTransportInterruption(parsedError, {
      isAbort: false,
      isDisconnect: false,
      isTestChat: false,
    })).toBe(false)
  })

  it('does not treat a clean "still generating" pending signal as an interruption', () => {
    expect(isAutoRecoverableTransportInterruption(null, {
      isAbort: false,
      isDisconnect: false,
      isTestChat: false,
    })).toBe(false)
  })

  it('notifies when a turn finishes while the tab is hidden, with no interruption', () => {
    expect(shouldNotifyGenerationReadyWhileHidden(false, 'hidden')).toBe(true)
  })

  it('notifies when a turn required recovery, even once the tab is visible again', () => {
    // The iOS case: recovery only ever resolves after the user has already
    // returned (the connection died while the page was frozen, undetected
    // until execution resumes), so by the time onFinish sees a clean
    // success, visibilityState already reads 'visible' — the interruption
    // flag is the only signal that a real disruption happened.
    expect(shouldNotifyGenerationReadyWhileHidden(true, 'visible')).toBe(true)
  })

  it('does not notify for a turn that finished normally while visible', () => {
    expect(shouldNotifyGenerationReadyWhileHidden(false, 'visible')).toBe(false)
  })

  it('forces the generic loading indicator during an idle recovery gap', () => {
    // No assistant message at all yet — the message list still ends on the
    // user's own turn.
    expect(shouldForceGenericLoadingIndicator(true, undefined)).toBe(true)

    const emptyAssistantMessage: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [],
    } as UIMessage

    expect(shouldForceGenericLoadingIndicator(
      true,
      emptyAssistantMessage,
    )).toBe(true)
  })

  it('does not duplicate the loader once the recovered stream has visible content', () => {
    // Reproduces the real-world bug: returning from an app switch mid-
    // generation showed the real, actively-streaming reasoning bubble AND a
    // separate, empty generic loader underneath it.
    const streamingAssistantMessage: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'reasoning', text: 'Searching for news sources' }],
    } as UIMessage

    expect(shouldForceGenericLoadingIndicator(
      true,
      streamingAssistantMessage,
    )).toBe(false)
  })

  it('treats image generation progress as visible assistant content', () => {
    const generatingAssistantMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-generate_image',
          state: 'output-available',
          output: { status: 'generating' },
        },
      ],
    } as unknown as UIMessage

    expect(hasVisibleAssistantContent(generatingAssistantMessage)).toBe(true)
    expect(shouldForceGenericLoadingIndicator(
      true,
      generatingAssistantMessage,
    )).toBe(false)
    expect(shouldShowGenericLoadingIndicator(
      'streaming',
      false,
      generatingAssistantMessage,
    )).toBe(false)
    expect(shouldShowGenericLoadingIndicator(
      'submitted',
      false,
      generatingAssistantMessage,
    )).toBe(false)
  })

  it('refreshes an in-place streamed image tool update for Vue rendering', () => {
    const imageToolPart = {
      type: 'tool-generate_image',
      toolCallId: 'image-1',
      state: 'input-available',
      input: { prompt: 'A quiet forest' },
    }
    const messages = [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [imageToolPart],
    }] as unknown as UIMessage[]
    const sdkMessages = shallowRef<UIMessage[]>(messages)
    const renderableMessages = computed<UIMessage[]>(() => {
      return getRenderableChatMessages(sdkMessages.value)
    })
    const preparingSnapshot = renderableMessages.value

    Object.assign(imageToolPart, {
      state: 'output-available',
      output: {
        status: 'ready',
        provider: 'openai',
        model: 'gpt-image-2',
        file: {
          id: 'file-1',
          storageKey: 'generated.webp',
          name: 'generated.webp',
          size: 1024,
          type: 'image/webp',
          source: 'assistant',
          url: '/files/generated.webp',
          downloadUrl: '/files/generated.webp?download=1',
        },
      },
    })
    triggerRef(sdkMessages)

    const readySnapshot = renderableMessages.value
    const preparingPart = preparingSnapshot[0]?.parts[0]
    const readyPart = readySnapshot[0]?.parts[0] as {
      output?: { status?: string }
    }

    expect(readyPart).not.toBe(preparingPart)
    expect(readyPart.output?.status).toBe('ready')
  })

  it('returns a fresh array without cloning messages for text replies', () => {
    const messages = [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hello' }],
    }] as UIMessage[]

    const result = getRenderableChatMessages(messages)

    expect(result).not.toBe(messages)
    expect(result[0]).toBe(messages[0])
  })

  it('propagates an in-place streamed text update to a computed consumer', () => {
    const textPart = { type: 'text', text: '' }
    const messages = [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [textPart],
    }] as unknown as UIMessage[]
    const sdkMessages = shallowRef<UIMessage[]>(messages)
    const renderableMessages = computed<UIMessage[]>(() => {
      return getRenderableChatMessages(sdkMessages.value)
    })
    const isAssistantVisible = computed<boolean>(() => {
      const message = renderableMessages.value.find((candidate) => {
        return candidate.id === 'assistant-1'
      })

      return hasVisibleAssistantContent(message)
    })

    expect(isAssistantVisible.value).toBe(false)

    textPart.text = 'This is a streamed reply.'
    triggerRef(sdkMessages)

    expect(isAssistantVisible.value).toBe(true)
  })

  it('treats a tool-only assistant message with no text or reasoning as visible content', () => {
    const toolOnlyMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'tool-web_search_preview', state: 'input-available' },
      ],
    } as unknown as UIMessage

    expect(hasVisibleAssistantContent(toolOnlyMessage)).toBe(true)
  })

  it('leaves a generate_image-only message governed by the existing image path', () => {
    const generateImageOnlyMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-generate_image',
          state: 'input-available',
          input: { prompt: 'A quiet forest' },
        },
      ],
    } as unknown as UIMessage

    // Already true via isVisibleGenerateImageToolPart (input-available is a
    // visible in-progress state for image generation) — unaffected by the
    // new isThinkingToolPart clause, since generate_image is excluded there.
    expect(hasVisibleAssistantContent(generateImageOnlyMessage)).toBe(true)
  })

  it('treats a persisted file-only reply as visible assistant content', () => {
    const fileAssistantMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'file',
          mediaType: 'image/webp',
          filename: 'generated.webp',
          url: '/files/generated.webp',
        },
      ],
    } as unknown as UIMessage

    expect(hasVisibleAssistantContent(fileAssistantMessage)).toBe(true)
  })

  it('never forces the loader once a generation is not being awaited', () => {
    const emptyAssistantMessage: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [],
    } as UIMessage

    expect(shouldForceGenericLoadingIndicator(
      false,
      emptyAssistantMessage,
    )).toBe(false)
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

  it('redacts an unknown-code message that looks like a leaked header value',
    async () => {
      const { normalizeChatError } = await import(
        '../../../server/utils/chats/errors'
      )

      const result = normalizeChatError({
        error: new TypeError(
          'Headers.append: "Bearer sk-real-secret-token\n'
          + '" is an invalid header value.',
        ),
        status: 500,
      })

      expect(result.code).toBe('unknown')
      expect(result.message).not.toContain('sk-real-secret-token')
      expect(result.why).toBeUndefined()
    })

  it('redacts an unknown-code message containing a raw control character',
    async () => {
      const { normalizeChatError } = await import(
        '../../../server/utils/chats/errors'
      )

      const result = normalizeChatError({
        error: new Error('x-account-id: bad-account-id\nsome-secret'),
        status: 500,
      })

      expect(result.code).toBe('unknown')
      expect(result.message).not.toContain('some-secret')
      expect(result.why).toBeUndefined()
    })

  it('rewrites an upstream "image input" rejection embedded mid-sentence '
    + 'into a friendly message', async () => {
    const { normalizeChatError } = await import(
      '../../../server/utils/chats/errors'
    )

    const result = normalizeChatError({
      error: new Error(
        'No endpoints found that support image input.',
      ),
      status: 400,
    })

    expect(result.message).toBe(
      'This model does not support image input. Remove the attached'
      + ' image or switch to a vision-capable model.',
    )
    expect(result.why).toBe('No endpoints found that support image input.')
  })

  it('rewrites a "does not support image" rejection into a friendly '
    + 'message', async () => {
    const { normalizeChatError } = await import(
      '../../../server/utils/chats/errors'
    )

    const result = normalizeChatError({
      error: new Error(
        'Bad Request: this model does not support image inputs.',
      ),
      status: 400,
    })

    expect(result.message).toBe(
      'This model does not support image input. Remove the attached'
      + ' image or switch to a vision-capable model.',
    )
  })

  it('leaves an unrelated 400 error message untouched', async () => {
    const { normalizeChatError } = await import(
      '../../../server/utils/chats/errors'
    )

    const result = normalizeChatError({
      error: new Error('Invalid request: missing required field "model".'),
      status: 400,
    })

    expect(result.message).toBe(
      'Invalid request: missing required field "model".',
    )
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

  it('blocks recovery when a deep-research model is selected and no job exists', () => {
    expect(shouldBlockGenerationRecovery(true, false)).toBe(true)
  })

  it('blocks recovery when a research job exists, regardless of status, even on a normal model', () => {
    // Model-independent: a running, failed, or cancelled job kept in memory
    // this session all collapse to the same "a research job exists" signal
    // at this predicate's boundary.
    expect(shouldBlockGenerationRecovery(false, true)).toBe(true)
  })

  it('does not block a normal chat with no research job — regression guard', () => {
    expect(shouldBlockGenerationRecovery(false, false)).toBe(false)
  })

  it('blocks recovery when both a deep-research model and a job are present', () => {
    expect(shouldBlockGenerationRecovery(true, true)).toBe(true)
  })

  it('does not recover a chat reduced to a single assistant message — the bug case', () => {
    // Only reachable via single-message delete: the user deletes the first
    // user message, leaving the AI's reply as the sole message. Regressing
    // this would resolve messageIndex to 0 in ai@7's regenerate(), slicing
    // the message array to [] and sending an invalid request body.
    const messages: UIMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Completed answer' }],
      } as UIMessage,
    ]

    expect(shouldRecoverGeneration(messages)).toBe(false)
  })

  it('does not auto-recover a hydrated empty assistant response', () => {
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

    expect(shouldRecoverGeneration(messages)).toBe(false)
  })

  it('recovers a fresh single-message chat with only an unanswered user prompt', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      } as UIMessage,
    ]

    expect(shouldRecoverGeneration(messages)).toBe(true)
  })

  it('recovers when the last message in a longer history is a user turn', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      } as UIMessage,
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hi there' }],
      } as UIMessage,
      {
        id: 'user-2',
        role: 'user',
        parts: [{ type: 'text', text: 'Follow-up' }],
      } as UIMessage,
    ]

    expect(shouldRecoverGeneration(messages)).toBe(true)
  })

  it('does not recover an empty message list', () => {
    expect(shouldRecoverGeneration([])).toBe(false)
  })
})

describe('isReasoningActiveForTurn', () => {
  function reasoningMessage(
    state: 'streaming' | 'done',
    text = 'Thinking…',
  ): UIMessage {
    return {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'reasoning', text, state }],
    } as UIMessage
  }

  it('is false when the chat status is not streaming', () => {
    expect(
      isReasoningActiveForTurn('ready', reasoningMessage('streaming')),
    ).toBe(false)
  })

  it('is false when the last message is not the assistant', () => {
    const message = {
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
    } as UIMessage

    expect(isReasoningActiveForTurn('streaming', message)).toBe(false)
  })

  it('is true while the last message has a streaming reasoning part', () => {
    expect(
      isReasoningActiveForTurn('streaming', reasoningMessage('streaming')),
    ).toBe(true)
  })

  it('is false once every reasoning part has settled to done and text has appeared', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'Thinking…', state: 'done' },
        { type: 'text', text: 'Here is the answer.', state: 'streaming' },
      ],
    } as UIMessage

    expect(isReasoningActiveForTurn('streaming', message)).toBe(false)
  })

  it('ignores a reasoning part left streaming with no text, once text has appeared elsewhere', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: '', state: 'streaming' },
        { type: 'text', text: 'Here is the answer.', state: 'streaming' },
      ],
    } as UIMessage

    expect(isReasoningActiveForTurn('streaming', message)).toBe(false)
  })

  it('is true for a bodyless reasoning part before any text has appeared (dead zone)', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'reasoning', text: '', state: 'streaming' }],
    } as UIMessage

    expect(isReasoningActiveForTurn('streaming', message)).toBe(true)
  })

  it('is true again for a second reasoning part after a tool call', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'First pass', state: 'done' },
        { type: 'tool-web_search', state: 'input-available' },
        { type: 'reasoning', text: 'Second pass', state: 'streaming' },
      ],
    } as UIMessage

    expect(isReasoningActiveForTurn('streaming', message)).toBe(true)
  })

  it('is true while reasoning is done but a web-search tool call is pending', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'Thinking…', state: 'done' },
        { type: 'tool-web_search_preview', state: 'input-available' },
      ],
    } as UIMessage

    expect(isReasoningActiveForTurn('streaming', message)).toBe(true)
  })

  it('is true once reasoning and the tool call have both settled but no text has appeared yet (dead zone)', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'Thinking…', state: 'done' },
        { type: 'tool-web_search_preview', state: 'output-available' },
      ],
    } as UIMessage

    expect(isReasoningActiveForTurn('streaming', message)).toBe(true)
  })

  it('turns off the dead zone once text appears after reasoning and the tool call have settled', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'Thinking…', state: 'done' },
        { type: 'tool-web_search_preview', state: 'output-available' },
        { type: 'text', text: 'Here is the answer.', state: 'streaming' },
      ],
    } as UIMessage

    expect(isReasoningActiveForTurn('streaming', message)).toBe(false)
  })

  it('is true for a pending tool call with no reasoning at all', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'tool-web_search_preview', state: 'input-streaming' },
      ],
    } as UIMessage

    expect(isReasoningActiveForTurn('streaming', message)).toBe(true)
  })

  it('is false for a pending generate_image tool call once text has appeared', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'tool-generate_image', state: 'input-available' },
        { type: 'text', text: 'Here is the answer.', state: 'streaming' },
      ],
    } as UIMessage

    expect(isReasoningActiveForTurn('streaming', message)).toBe(false)
  })

  it('is true for a pending generate_image tool call before any text has appeared (dead zone; image generation is not itself excluded from this clause)', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'tool-generate_image', state: 'input-available' },
      ],
    } as UIMessage

    expect(isReasoningActiveForTurn('streaming', message)).toBe(true)
  })

  it('is false for a pending tool call when the status is not streaming', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'tool-web_search_preview', state: 'input-available' },
      ],
    } as UIMessage

    expect(isReasoningActiveForTurn('ready', message)).toBe(false)
  })

  it('is false for a pending tool call on a user-role last message', () => {
    const message = {
      id: 'user-1',
      role: 'user',
      parts: [
        { type: 'tool-web_search_preview', state: 'input-available' },
      ],
    } as UIMessage

    expect(isReasoningActiveForTurn('streaming', message)).toBe(false)
  })
})

describe('foldReasoningSegment', () => {
  it('adds the elapsed segment duration into the accumulated total', () => {
    const now = Date.now()
    const segmentStartedAt = now - 1_700

    expect(foldReasoningSegment(true, 0, segmentStartedAt, now)).toBe(1_700)
  })

  it('adds on top of an already-accumulated total from prior segments', () => {
    const now = Date.now()
    const segmentStartedAt = now - 2_000

    expect(foldReasoningSegment(true, 5_000, segmentStartedAt, now))
      .toBe(7_000)
  })

  it('leaves the total unchanged when there was no active segment', () => {
    expect(foldReasoningSegment(false, 5_000, 0, Date.now())).toBe(5_000)
  })

  it('leaves the total unchanged when no segment start was ever recorded', () => {
    expect(foldReasoningSegment(true, 5_000, 0, Date.now())).toBe(5_000)
  })
})

describe('createReasoningSegmentTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createTracker() {
    const isActive = shallowRef<boolean>(false)
    const isStreaming = shallowRef<boolean>(true)
    const tracker = createReasoningSegmentTracker(
      isActive,
      () => isStreaming.value,
    )

    return { isActive, isStreaming, tracker }
  }

  it('keeps the same segment across a transient gap recovered within the grace window', async () => {
    const { isActive, tracker } = createTracker()

    isActive.value = true
    await nextTick()

    const segmentStartedAt = tracker.segmentStartedAt.value

    vi.advanceTimersByTime(1000)

    isActive.value = false
    await nextTick()

    expect(tracker.isTurnThinkingHeld.value).toBe(true)

    vi.advanceTimersByTime(REASONING_SEGMENT_GRACE_WINDOW_MS - 100)

    isActive.value = true
    await nextTick()

    expect(tracker.isTurnThinkingHeld.value).toBe(true)
    expect(tracker.accumulatedMs.value).toBe(0)
    expect(tracker.segmentStartedAt.value).toBe(segmentStartedAt)

    vi.advanceTimersByTime(REASONING_SEGMENT_GRACE_WINDOW_MS)

    expect(tracker.isTurnThinkingHeld.value).toBe(true)
    expect(tracker.accumulatedMs.value).toBe(0)
  })

  it('folds immediately with no grace window once status itself leaves streaming', async () => {
    const { isActive, isStreaming, tracker } = createTracker()

    isActive.value = true
    await nextTick()

    vi.advanceTimersByTime(1500)

    isStreaming.value = false
    isActive.value = false
    await nextTick()

    expect(tracker.isTurnThinkingHeld.value).toBe(false)
    expect(tracker.accumulatedMs.value).toBeGreaterThanOrEqual(1500)

    const accumulatedAfterFold = tracker.accumulatedMs.value

    vi.advanceTimersByTime(REASONING_SEGMENT_GRACE_WINDOW_MS)

    expect(tracker.accumulatedMs.value).toBe(accumulatedAfterFold)
  })

  it('folds the segment once the grace window elapses with no recovery', async () => {
    const { isActive, tracker } = createTracker()

    isActive.value = true
    await nextTick()

    vi.advanceTimersByTime(1000)

    isActive.value = false
    await nextTick()

    expect(tracker.isTurnThinkingHeld.value).toBe(true)

    vi.advanceTimersByTime(REASONING_SEGMENT_GRACE_WINDOW_MS)

    expect(tracker.isTurnThinkingHeld.value).toBe(false)
    expect(tracker.accumulatedMs.value).toBeGreaterThanOrEqual(1000)
  })

  it('clears a pending grace-window fold on reset, so it cannot corrupt the next turn', async () => {
    const { isActive, tracker } = createTracker()

    isActive.value = true
    await nextTick()

    vi.advanceTimersByTime(1000)

    isActive.value = false
    await nextTick()

    tracker.reset()

    vi.advanceTimersByTime(REASONING_SEGMENT_GRACE_WINDOW_MS)

    expect(tracker.accumulatedMs.value).toBe(0)
    expect(tracker.segmentStartedAt.value).toBe(0)
    expect(tracker.isTurnThinkingHeld.value).toBe(false)
  })
})

describe('findLastUserMessageTools', () => {
  function userMessage(tools: Message['tools']): Message {
    return { role: 'user', tools } as unknown as Message
  }

  function assistantMessage(tools: Message['tools']): Message {
    return { role: 'assistant', tools } as unknown as Message
  }

  it('returns an empty array for a chat with no messages', () => {
    expect(findLastUserMessageTools([])).toEqual([])
  })

  it('reads the tools from the last user message, ignoring a trailing '
    + 'assistant reply', () => {
    const messages = [
      userMessage(['web_search_brave']),
      assistantMessage([]),
    ]

    expect(findLastUserMessageTools(messages)).toEqual(['web_search_brave'])
  })

  it('does not fall back to an assistant message\'s image_generation '
    + 'tools when the last user message selected none', () => {
    const messages = [
      userMessage([]),
      assistantMessage(['image_generation']),
    ]

    expect(findLastUserMessageTools(messages)).toEqual([])
  })

  it('picks the most recent user message, not the first one', () => {
    const messages = [
      userMessage(['web_search_exa']),
      assistantMessage([]),
      userMessage(['web_search_brave']),
      assistantMessage(['image_generation']),
    ]

    expect(findLastUserMessageTools(messages)).toEqual(['web_search_brave'])
  })

  it('returns an empty array when no user message exists', () => {
    const messages = [assistantMessage(['image_generation'])]

    expect(findLastUserMessageTools(messages)).toEqual([])
  })

  it('falls back to an empty array when the user message has no '
    + 'persisted tools', () => {
    const messages = [userMessage(null as unknown as Message['tools'])]

    expect(findLastUserMessageTools(messages)).toEqual([])
  })
})
