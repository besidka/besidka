import type { ChatStatus, UIMessage } from 'ai'
import { defineComponent, h, ref, shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import type { Chat } from '#shared/types/chats.d'
import type {
  ResearchAnswer,
  ResearchClarificationResponse,
} from '#shared/types/research.d'
import { stashResearchAnswersForNewChat, useChat } from '../../../app/composables/chat'

// This is a sibling of chat.spec.ts rather than an extension of it: it
// instantiates the full useChat() composable (not just its exported pure
// helpers), which needs its own @ai-sdk/vue + Nuxt auto-import mocking
// harness. Keeping that harness in its own file avoids coupling chat.spec.ts's
// 40 pure-function tests to module-level mocks they don't need.
const mocks = vi.hoisted(() => ({
  useChatSdk: vi.fn(),
  defaultChatTransport: vi.fn(),
  sdkMessages: null as any,
  sdkStatus: null as any,
  sdkError: null as any,
  sdkRegenerate: null as any,
  sdkStop: null as any,
  sdkClearError: null as any,
  transportOptions: [] as any[],
  errorMessage: vi.fn(),
  warningMessage: vi.fn(),
  convertFilesToUIParts: vi.fn(),
}))

vi.mock('@ai-sdk/vue', () => ({
  useChat: mocks.useChatSdk,
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    DefaultChatTransport: mocks.defaultChatTransport,
  }
})

const userModelRef = shallowRef<string>('gpt-5')
const preferenceStore = new Map<string, string>()
const routeParams: { slug?: string } = {}

mockNuxtImport('useUserModel', () => {
  return () => ({ userModel: userModelRef })
})

mockNuxtImport('useRoute', () => {
  return () => ({ params: routeParams })
})

mockNuxtImport('usePreferenceStorage', () => {
  return () => ({
    getItem: (key: string) => preferenceStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      preferenceStore.set(key, value)
    },
    removeItem: (key: string) => {
      preferenceStore.delete(key)
    },
    flushPending: () => undefined,
  })
})

mockNuxtImport('useChatTest', () => {
  return () => ({
    api: shallowRef('/api/v1/chats/test-chat'),
    isTestChat: shallowRef(false),
    shouldAutoRegenerate: shallowRef(true),
  })
})

mockNuxtImport('useWakeLock', () => {
  return () => ({
    isActive: shallowRef(false),
    acquire: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  })
})

mockNuxtImport('useSetChatTitle', () => {
  return vi.fn(async () => undefined)
})

mockNuxtImport('useErrorMessage', () => {
  return (...args: unknown[]) => mocks.errorMessage(...args)
})

mockNuxtImport('useWarningMessage', () => {
  return (...args: unknown[]) => mocks.warningMessage(...args)
})

mockNuxtImport('convertFilesToUIParts', () => {
  return (...args: [any]) => mocks.convertFilesToUIParts(...args)
})

function createChatFixture(overrides: Record<string, unknown> = {}): Chat {
  return {
    id: 'chat-1',
    slug: 'chat-1',
    userId: 1,
    title: 'Test chat',
    messages: [],
    ...overrides,
  } as unknown as Chat
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return {
    promise,
    resolve,
  }
}

function getLatestTransportOptions() {
  const transportOptions = mocks.transportOptions.at(-1)

  return transportOptions.prepareSendMessagesRequest as (args: {
    messages: UIMessage[]
  }) => { body: Record<string, unknown> }
}

async function triggerClarification(
  chat: ReturnType<typeof useChat>,
  topic: string,
) {
  chat.researchDepth.value = 'standard'
  chat.input.value = topic

  await chat.submit()
}

function mountChatHost(chat: Chat) {
  let exposedChat!: ReturnType<typeof useChat>

  const Host = defineComponent({
    setup() {
      exposedChat = useChat(chat)

      return () => h('div')
    },
  })

  return mountSuspended(Host).then((wrapper) => {
    return { chat: exposedChat, wrapper }
  })
}

describe('useChat research clarification flow', () => {
  beforeEach(() => {
    preferenceStore.clear()
    userModelRef.value = 'gpt-5'
    delete routeParams.slug
    mocks.transportOptions = []
    mocks.sdkMessages = ref<UIMessage[]>([])
    mocks.sdkStatus = ref<ChatStatus>('ready')
    mocks.sdkError = ref<Error | undefined>(undefined)
    mocks.sdkRegenerate = vi.fn()
    mocks.sdkStop = vi.fn()
    mocks.sdkClearError = vi.fn()

    mocks.useChatSdk.mockImplementation(() => ({
      messages: mocks.sdkMessages,
      status: mocks.sdkStatus,
      error: mocks.sdkError,
      regenerate: mocks.sdkRegenerate,
      stop: mocks.sdkStop,
      clearError: mocks.sdkClearError,
    }))

    mocks.defaultChatTransport.mockImplementation(function (options: any) {
      mocks.transportOptions.push(options)

      return { options }
    })
  })

  it('defers to the clarify endpoint instead of starting the stream', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/chats/research/clarify') {
        return {
          questions: [
            { id: 'audience', question: 'Who is this for?', kind: 'text' },
          ],
          note: 'Quick scoping questions.',
        }
      }

      throw new Error(`Unhandled $fetch call: ${url}`)
    })

    vi.stubGlobal('$fetch', fetchMock)

    const chat = useChat(createChatFixture())

    await triggerClarification(chat, 'the future of remote work')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/chats/research/clarify',
      {
        method: 'POST',
        body: {
          model: 'gpt-5',
          topic: 'the future of remote work',
        },
      },
    )
    expect(chat.pendingClarification.value).toEqual({
      questions: [
        { id: 'audience', question: 'Who is this for?', kind: 'text' },
      ],
      note: 'Quick scoping questions.',
    })
    expect(chat.isClarifying.value).toBe(false)
    expect(mocks.sdkRegenerate).not.toHaveBeenCalled()
    expect(chat.chatSdk.messages).toEqual([])
  })

  it('clears the pending clarification and sends the deferred message with the given answers', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({
      questions: [],
      note: undefined,
    })))

    const chat = useChat(createChatFixture())

    await triggerClarification(chat, 'the future of remote work')

    const answers: ResearchAnswer[] = [
      { id: 'audience', question: 'Who is this for?', answer: 'Engineers' },
    ]

    chat.submitResearchClarification(answers)

    expect(chat.pendingClarification.value).toBeNull()
    expect(mocks.sdkRegenerate).toHaveBeenCalledTimes(1)

    const lastMessage = chat.chatSdk.messages.at(-1)

    expect(lastMessage?.role).toBe('user')
    expect(lastMessage?.parts).toEqual([
      { type: 'text', text: 'the future of remote work' },
    ])

    const { body } = getLatestTransportOptions()({
      messages: chat.chatSdk.messages,
    })

    expect(body).toEqual({
      model: 'gpt-5',
      tools: [],
      messages: [lastMessage],
      reasoning: 'off',
      researchDepth: 'standard',
      researchAnswers: answers,
    })
  })

  it('sends the deferred message with an empty answers array when questions are skipped', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({
      questions: [],
      note: undefined,
    })))

    const chat = useChat(createChatFixture())

    await triggerClarification(chat, 'the future of remote work')

    chat.submitResearchClarification([])

    expect(chat.pendingClarification.value).toBeNull()
    expect(mocks.sdkRegenerate).toHaveBeenCalledTimes(1)

    const { body } = getLatestTransportOptions()({
      messages: chat.chatSdk.messages,
    })

    expect(body).toEqual(expect.objectContaining({
      researchDepth: 'standard',
      researchAnswers: [],
    }))
  })

  it('still sends the original message when the clarify request fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })

    vi.stubGlobal('$fetch', fetchMock)

    const chat = useChat(createChatFixture())

    await triggerClarification(chat, 'the future of remote work')

    expect(mocks.errorMessage).toHaveBeenCalled()
    expect(chat.pendingClarification.value).toBeNull()
    expect(mocks.sdkRegenerate).toHaveBeenCalledTimes(1)

    const lastMessage = chat.chatSdk.messages.at(-1)

    expect(lastMessage?.role).toBe('user')
    expect(lastMessage?.parts).toEqual([
      { type: 'text', text: 'the future of remote work' },
    ])

    const { body } = getLatestTransportOptions()({
      messages: chat.chatSdk.messages,
    })

    expect(body).toEqual(expect.objectContaining({
      researchAnswers: [],
    }))
  })

  it('restores the typed input when preparing the message parts fails', async () => {
    mocks.convertFilesToUIParts.mockRejectedValueOnce(new Error('boom'))

    const fetchMock = vi.fn()

    vi.stubGlobal('$fetch', fetchMock)

    const chat = useChat(createChatFixture())

    chat.researchDepth.value = 'standard'
    chat.input.value = 'the future of remote work'
    chat.files.value = [{ id: 'file-1', name: 'notes.png' } as any]

    await chat.submit()

    expect(chat.input.value).toBe('the future of remote work')
    expect(mocks.errorMessage).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.sdkRegenerate).not.toHaveBeenCalled()
    expect(chat.pendingClarification.value).toBeNull()
  })

  it('sends immediately, without deferring, when research depth is off', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('$fetch', fetchMock)

    const chat = useChat(createChatFixture())

    chat.input.value = 'plain question'

    await chat.submit()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.sdkRegenerate).toHaveBeenCalledTimes(1)
    expect(chat.chatSdk.messages).toHaveLength(1)

    const { body } = getLatestTransportOptions()({
      messages: chat.chatSdk.messages,
    })

    expect(body).toEqual(expect.objectContaining({
      researchDepth: 'off',
    }))
    expect(body).not.toHaveProperty('researchAnswers')
  })

  it('ignores a duplicate submit while a clarification request is in flight', async () => {
    const clarifyDeferred = createDeferred<ResearchClarificationResponse>()
    const fetchMock = vi.fn(() => clarifyDeferred.promise)

    vi.stubGlobal('$fetch', fetchMock)

    const chat = useChat(createChatFixture())

    chat.researchDepth.value = 'standard'
    chat.input.value = 'first topic'

    const firstSubmit = chat.submit()

    await vi.waitFor(() => {
      expect(chat.isClarifying.value).toBe(true)
    })

    chat.input.value = 'second topic'
    await chat.submit()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(chat.pendingClarification.value).toBeNull()

    clarifyDeferred.resolve({ questions: [], note: undefined })
    await firstSubmit

    expect(chat.isClarifying.value).toBe(false)

    chat.submitResearchClarification([])

    const lastMessage = chat.chatSdk.messages.at(-1)

    expect(lastMessage?.parts).toEqual([
      { type: 'text', text: 'first topic' },
    ])
  })

  it('surfaces an error and never sends when there are no deferred parts to recover', () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('$fetch', fetchMock)

    const chat = useChat(createChatFixture())

    chat.submitResearchClarification([
      { id: 'audience', question: 'Who is this for?', answer: 'Engineers' },
    ])

    expect(mocks.errorMessage).toHaveBeenCalledWith(
      'Failed to start research',
      'Your message could not be recovered. Please try again.',
    )
    expect(mocks.sdkRegenerate).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(chat.chatSdk.messages).toEqual([])
    expect(chat.pendingClarification.value).toBeNull()
  })

  it('seeds deferredResearchAnswers from the sessionStorage handoff and sends them on the first new-chat generation', async () => {
    const answers: ResearchAnswer[] = [
      { id: 'audience', question: 'Who is this for?', answer: 'Engineers' },
    ]

    stashResearchAnswersForNewChat('chat-1', answers)
    routeParams.slug = 'chat-1'

    const chatFixture = createChatFixture({
      id: 'chat-1',
      slug: 'chat-1',
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          parts: [{ type: 'text', text: 'the future of remote work' }],
        },
      ],
    })

    const { wrapper } = await mountChatHost(chatFixture)

    expect(mocks.sdkRegenerate).toHaveBeenCalledTimes(1)
    expect(
      sessionStorage.getItem('research-answers:chat-1'),
    ).toBeNull()

    const { body } = getLatestTransportOptions()({
      messages: chatFixture.messages as UIMessage[],
    })

    expect(body).toEqual(expect.objectContaining({
      researchAnswers: answers,
    }))

    wrapper.unmount()
  })

  it('does not seed deferredResearchAnswers when nothing was stashed for this chat', async () => {
    routeParams.slug = 'chat-2'

    const chatFixture = createChatFixture({
      id: 'chat-2',
      slug: 'chat-2',
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          parts: [{ type: 'text', text: 'another topic' }],
        },
      ],
    })

    const { wrapper } = await mountChatHost(chatFixture)

    expect(mocks.sdkRegenerate).toHaveBeenCalledTimes(1)

    const { body } = getLatestTransportOptions()({
      messages: chatFixture.messages as UIMessage[],
    })

    expect(body).not.toHaveProperty('researchAnswers')

    wrapper.unmount()
  })
})
