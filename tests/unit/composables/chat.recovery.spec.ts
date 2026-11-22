import type { UIMessage } from 'ai'
import { defineComponent, h, shallowRef } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  normalizeChatClientError,
  shouldSendChatClientErrorReport,
  shouldShowWaitingLoader,
  useChat,
} from '../../../app/composables/chat'
import {
  TOO_MANY_REQUESTS_MESSAGE,
  createClientErrorReportLimiter,
} from '~/utils/chat-request-errors'

interface SdkOptions {
  transport: {
    fetch: (input: string, init?: RequestInit) => Promise<Response>
  }
  onFinish: (context: {
    isAbort: boolean
    isDisconnect: boolean
    isError: boolean
    messages: UIMessage[]
  }) => void
  onError: (error: unknown) => void
  onData: (part: { type: string, data?: unknown }) => void
}

const sdk = vi.hoisted(() => ({
  options: null as SdkOptions | null,
  messages: null as { value: UIMessage[] } | null,
  status: null as { value: string } | null,
  regenerate: vi.fn(),
  stop: vi.fn(),
  errorMessage: vi.fn(),
  fetch: vi.fn(async (url: string) => {
    if (url.endsWith('/stop')) {
      return { stopped: true, runId: 'run-1' }
    }

    throw new Error('Not mocked')
  }),
}))

const CLOUDFLARE_1015_PAGE = '<!DOCTYPE html><html><head><title>Access'
  + ' denied</title></head><body><h1>Error 1015</h1>You are being rate'
  + ' limited</body></html>'

vi.mock('ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('ai')>()

  const DefaultChatTransport = vi.fn(function (
    this: Record<string, unknown>,
    options: Record<string, unknown>,
  ) {
    Object.assign(this, options)
  })

  return { ...original, DefaultChatTransport }
})

vi.mock('@ai-sdk/vue', () => {
  return {
    useChat: (options: SdkOptions & { messages: UIMessage[] }) => {
      const messages = shallowRef<UIMessage[]>(options.messages)
      const status = shallowRef<string>('ready')

      sdk.options = options
      sdk.messages = messages
      sdk.status = status

      return {
        messages,
        status,
        error: shallowRef(undefined),
        regenerate: sdk.regenerate,
        stop: sdk.stop,
        clearError: vi.fn(),
        sendMessage: vi.fn(),
        addToolApprovalResponse: vi.fn(),
      }
    },
  }
})

mockNuxtImport('useSetChatTitle', () => {
  return () => undefined
})

mockNuxtImport('useErrorMessage', () => {
  return sdk.errorMessage
})

mockNuxtImport('$fetch', () => sdk.fetch)

const userTurn = [{
  id: 'user-1',
  role: 'user',
  parts: [{ type: 'text', text: 'Hello' }],
}] as UIMessage[]
const answeredTurn = [
  ...userTurn,
  {
    id: 'assistant-1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Hi there.' }],
  },
] as UIMessage[]

async function mountChatWithWrapper() {
  let chat: ReturnType<typeof useChat> | null = null

  const host = defineComponent({
    setup() {
      chat = useChat({
        id: 'chat-1',
        slug: 'slug-1',
        messages: answeredTurn,
      } as never)

      return () => h('div')
    },
  })

  const wrapper = await mountSuspended(host)

  return { chat: chat!, wrapper }
}

async function mountChat() {
  let chat: ReturnType<typeof useChat> | null = null

  const host = defineComponent({
    setup() {
      chat = useChat({
        id: 'chat-1',
        slug: 'slug-1',
        messages: answeredTurn,
      } as never)

      return () => h('div')
    },
  })

  await mountSuspended(host)

  return chat!
}

function failWithLoadError() {
  sdk.options!.onError(new TypeError('Load failed'))
  sdk.status!.value = 'error'
  sdk.options!.onFinish({
    isAbort: false,
    isDisconnect: false,
    isError: true,
    messages: sdk.messages!.value,
  })
}

function answerStillGenerating() {
  sdk.options!.onData({ type: 'data-generation-pending' })
  sdk.status!.value = 'ready'
  sdk.options!.onFinish({
    isAbort: false,
    isDisconnect: false,
    isError: false,
    messages: sdk.messages!.value,
  })
}

describe('useChat recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sdk.regenerate.mockReset()
    sdk.stop.mockReset()
    sdk.fetch.mockClear()
    sdk.errorMessage.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries a dropped connection at once only the first time', async () => {
    await mountChat()

    failWithLoadError()

    expect(sdk.regenerate).toHaveBeenCalledTimes(1)

    failWithLoadError()

    expect(sdk.regenerate).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(7_999)

    expect(sdk.regenerate).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)

    expect(sdk.regenerate).toHaveBeenCalledTimes(2)

    failWithLoadError()
    await vi.advanceTimersByTimeAsync(14_999)

    expect(sdk.regenerate).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1)

    expect(sdk.regenerate).toHaveBeenCalledTimes(3)
  })

  it('backs off while the previous reply is still generating', async () => {
    const chat = await mountChat()

    answerStillGenerating()

    expect(chat.displayStop.value).toBe(true)
    expect(chat.displayRegenerate.value).toBe(false)

    await vi.advanceTimersByTimeAsync(4_000)

    expect(sdk.regenerate).toHaveBeenCalledTimes(1)

    answerStillGenerating()
    await vi.advanceTimersByTimeAsync(4_000)

    expect(sdk.regenerate).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(4_000)

    expect(sdk.regenerate).toHaveBeenCalledTimes(2)
  })

  it('never shows Stop and Retry together while waiting', async () => {
    const chat = await mountChat()

    sdk.messages!.value = [
      ...answeredTurn,
      {
        id: 'user-2',
        role: 'user',
        parts: [{ type: 'text', text: 'And then?' }],
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        parts: [{ type: 'text', text: '' }],
      },
    ] as UIMessage[]
    answerStillGenerating()

    expect(chat.displayStop.value).toBe(true)
    expect(chat.displayRegenerate.value).toBe(false)
  })

  it('turns an HTML error page into a readable JSON error', async () => {
    await mountChat()

    const realFetch = globalThis.fetch

    globalThis.fetch = vi.fn(async () => {
      return new Response(CLOUDFLARE_1015_PAGE, {
        status: 429,
        headers: { 'content-type': 'text/html', 'cf-ray': 'ray-1' },
      })
    }) as typeof fetch

    try {
      const response = await sdk.options!.transport.fetch('/api/v1/chats/x')
      const error = normalizeChatClientError(new Error(await response.text()))

      expect(error.message).toBe(TOO_MANY_REQUESTS_MESSAGE)
      expect(error.requestId).toBe('ray-1')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

describe('leaving the chat', () => {
  beforeEach(() => {
    sdk.stop.mockReset()
    sdk.fetch.mockClear()
  })

  it('stops a streaming reply on the server and locally', async () => {
    const { wrapper } = await mountChatWithWrapper()

    sdk.messages!.value = [
      ...answeredTurn,
      {
        id: 'user-2',
        role: 'user',
        parts: [{ type: 'text', text: 'And then?' }],
      },
    ] as UIMessage[]
    sdk.status!.value = 'streaming'
    wrapper.unmount()

    expect(sdk.fetch).toHaveBeenCalledWith('/api/v1/chats/slug-1/stop', {
      method: 'POST',
      body: { messageId: 'user-2' },
      keepalive: true,
    })
    expect(sdk.stop).toHaveBeenCalledTimes(1)
  })

  it('leaves the server alone when nothing streams', async () => {
    const { wrapper } = await mountChatWithWrapper()

    wrapper.unmount()

    expect(sdk.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/stop'),
      expect.anything(),
    )
    expect(sdk.stop).not.toHaveBeenCalled()
  })

  it('only ends the local wait for another run', async () => {
    const { wrapper } = await mountChatWithWrapper()

    sdk.options!.onData({ type: 'data-generation-pending' })
    sdk.status!.value = 'ready'
    sdk.options!.onFinish({
      isAbort: false,
      isDisconnect: false,
      isError: false,
      messages: sdk.messages!.value,
    })
    wrapper.unmount()

    expect(sdk.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/stop'),
      expect.anything(),
    )
    expect(sdk.stop).toHaveBeenCalledTimes(1)
  })
})

describe('shouldShowWaitingLoader', () => {
  it('hides the waiting loader under an assistant bubble with content', () => {
    const reasoningReply = {
      id: 'assistant-2',
      role: 'assistant',
      parts: [{ type: 'reasoning', text: 'Listing the tools', state: 'done' }],
    } as UIMessage

    expect(shouldShowWaitingLoader(1_000, reasoningReply)).toBe(false)
    expect(shouldShowWaitingLoader(1_000, userTurn[0])).toBe(true)
    expect(shouldShowWaitingLoader(0, userTurn[0])).toBe(false)
  })

  it('always shows it while a continuation waits', () => {
    const approvalReply = {
      id: 'assistant-2',
      role: 'assistant',
      parts: [{ type: 'reasoning', text: 'Calling a tool', state: 'done' }],
    } as UIMessage

    expect(shouldShowWaitingLoader(1_000, approvalReply, true)).toBe(true)
  })
})

describe('chat client error helpers', () => {
  it('never shows markup as the error text', () => {
    const error = normalizeChatClientError(new Error(CLOUDFLARE_1015_PAGE))

    expect(error.message).toBe(TOO_MANY_REQUESTS_MESSAGE)
    expect(JSON.stringify(error)).not.toContain('<html')
  })

  it('sends a burst of the same report once and never one about itself',
    () => {
      const limiter = createClientErrorReportLimiter({
        maxPerWindow: 3,
        windowMs: 60_000,
        maxPerSession: 10,
      })
      const report = {
        code: 'unknown' as const,
        message: 'Load failed',
        reason: 'The connection was interrupted.',
      }
      const sent = Array.from({ length: 151 }, () => {
        return shouldSendChatClientErrorReport(report, limiter)
      })

      expect(sent.filter(Boolean)).toHaveLength(1)
      expect(shouldSendChatClientErrorReport({
        code: 'unknown',
        message: 'POST /api/v1/chats/client-errors failed',
      }, limiter)).toBe(false)
    })
})
