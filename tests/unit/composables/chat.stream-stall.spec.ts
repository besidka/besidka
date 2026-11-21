import type { UIMessage } from 'ai'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChat } from '../../../app/composables/chat'

interface SdkOptions {
  throttle?: number
  onData: (part: { type: string, data?: unknown }) => void
  onFinish: (context: {
    isAbort: boolean
    isDisconnect: boolean
    isError: boolean
    messages: UIMessage[]
  }) => void
}

const sdk = vi.hoisted(() => ({
  options: null as SdkOptions | null,
  messages: null as { value: UIMessage[] } | null,
  status: null as { value: string } | null,
  stop: vi.fn(),
  regenerate: vi.fn(),
  warningMessage: vi.fn(),
}))

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

mockNuxtImport('useWarningMessage', () => {
  return sdk.warningMessage
})

const HEARTBEAT = { type: 'data-heartbeat', data: { at: 1 } }

const chatMessages = [
  {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', text: 'Look it up' }],
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Done before.' }],
  },
] as UIMessage[]

async function mountChat() {
  const host = defineComponent({
    setup() {
      useChat({
        id: 'chat-1',
        slug: 'slug-1',
        messages: chatMessages,
      } as never)

      return () => h('div')
    },
  })

  return await mountSuspended(host)
}

async function startStreaming() {
  sdk.status!.value = 'streaming'
  await nextTick()
}

async function setVisibility(state: DocumentVisibilityState) {
  visibility.mockReturnValue(state)
  document.dispatchEvent(new Event('visibilitychange'))
  await nextTick()
}

function finishAborted() {
  sdk.status!.value = 'ready'
  sdk.options!.onFinish({
    isAbort: true,
    isDisconnect: false,
    isError: false,
    messages: sdk.messages!.value,
  })
}

let visibility: ReturnType<typeof vi.spyOn>

/**
 * Advances fake time in check-sized steps, so every interval tick runs on
 * time, as it does on a page whose timers are not frozen.
 */
function advance(milliseconds: number) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 5_000) {
    vi.advanceTimersByTime(Math.min(5_000, milliseconds - elapsed))
  }
}

describe('useChat stream stall watchdog', () => {
  beforeEach(() => {
    sdk.stop.mockReset()
    sdk.regenerate.mockReset()
    sdk.warningMessage.mockReset()
    visibility = vi.spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('visible')
  })

  afterEach(() => {
    visibility.mockRestore()
    vi.useRealTimers()
  })

  it('throttles how often a streamed reply is published', async () => {
    await mountChat()

    expect(sdk.options?.throttle).toBe(50)
  })

  it('reconnects a stream that went silent after a heartbeat', async () => {
    await mountChat()
    vi.useFakeTimers()
    await startStreaming()
    sdk.options!.onData(HEARTBEAT)

    advance(40_000)

    expect(sdk.stop).not.toHaveBeenCalled()

    advance(10_000)

    expect(sdk.stop).toHaveBeenCalledOnce()
    expect(sdk.warningMessage).toHaveBeenCalledWith(
      'The reply stopped arriving',
      'Reconnecting to it. This can take a couple of minutes.',
    )

    finishAborted()

    expect(sdk.regenerate).toHaveBeenCalledOnce()
  })

  it('never resumes a reply the user stopped', async () => {
    await mountChat()
    await startStreaming()

    finishAborted()

    expect(sdk.regenerate).not.toHaveBeenCalled()
  })

  it('keeps a stream alive while heartbeats or chunks arrive', async () => {
    await mountChat()
    vi.useFakeTimers()
    await startStreaming()

    for (let index = 0; index < 6; index += 1) {
      sdk.options!.onData(HEARTBEAT)
      advance(15_000)
    }

    sdk.messages!.value = [...sdk.messages!.value]
    await nextTick()
    advance(40_000)

    expect(sdk.stop).not.toHaveBeenCalled()
  })

  it('never stops a stream from a server that sends no heartbeat',
    async () => {
      await mountChat()
      vi.useFakeTimers()
      await startStreaming()

      advance(300_000)

      expect(sdk.stop).not.toHaveBeenCalled()
    })

  it('waits while the page is hidden and gives a fresh 45 seconds after',
    async () => {
      await mountChat()
      vi.useFakeTimers()
      await startStreaming()
      sdk.options!.onData(HEARTBEAT)
      await setVisibility('hidden')

      advance(120_000)

      expect(sdk.stop).not.toHaveBeenCalled()

      await setVisibility('visible')
      advance(40_000)

      expect(sdk.stop).not.toHaveBeenCalled()

      advance(10_000)

      expect(sdk.stop).toHaveBeenCalledOnce()
    })

  it('gives a fresh 45 seconds after a tick that came late', async () => {
    await mountChat()
    vi.useFakeTimers()
    await startStreaming()
    sdk.options!.onData(HEARTBEAT)

    vi.setSystemTime(Date.now() + 120_000)
    advance(5_000)

    expect(sdk.stop).not.toHaveBeenCalled()

    advance(40_000)

    expect(sdk.stop).not.toHaveBeenCalled()

    advance(10_000)

    expect(sdk.stop).toHaveBeenCalledOnce()
  })

  it('forgets the heartbeat of the previous request', async () => {
    await mountChat()
    vi.useFakeTimers()
    await startStreaming()
    sdk.options!.onData(HEARTBEAT)
    sdk.status!.value = 'submitted'
    await nextTick()

    advance(120_000)

    expect(sdk.stop).not.toHaveBeenCalled()
  })

  it('stops checking once the reply has finished', async () => {
    await mountChat()
    vi.useFakeTimers()
    await startStreaming()
    sdk.options!.onData(HEARTBEAT)
    sdk.status!.value = 'ready'
    await nextTick()

    advance(120_000)

    expect(sdk.stop).not.toHaveBeenCalled()
  })
})
