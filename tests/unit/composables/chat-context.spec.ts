import { defineComponent, h, reactive } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContextData } from '../../../app/composables/chat-context'
import { useChatContext } from '../../../app/composables/chat-context'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

const route = reactive<{ path: string, params: Record<string, string> }>({
  path: '',
  params: {},
})

mockNuxtImport('useRoute', () => () => route)
mockNuxtImport('$fetch', () => mocks.fetch)

const OWNED_RESPONSE = {
  chat: {
    slug: 'chat-1',
    title: 'Roadmap',
    project: null,
    memoryExcluded: false,
    share: { active: false },
    cost: null,
    models: [],
  },
  outputs: [],
  inputs: [],
  used: [],
  counts: { outputs: 3, inputs: 1, used: 2 },
}

const SHARED_RESPONSE = {
  chat: {
    slug: 'share-1',
    title: 'Shared',
    cost: null,
    models: [],
    allowBranch: true,
  },
  outputs: [],
  inputs: [],
  used: [],
  counts: { outputs: 5, inputs: 0, used: 0 },
}

function setRoute(path: string, slug?: string) {
  route.path = path
  route.params = slug ? { slug } : {}
}

async function mountComposable() {
  let captured: ReturnType<typeof useChatContext> | null = null

  const wrapper = await mountSuspended(defineComponent({
    setup() {
      captured = useChatContext()

      return () => h('div')
    },
  }))

  await flushPromises()

  return { wrapper, context: captured as unknown as ReturnType<
    typeof useChatContext
  > }
}

describe('useChatContext', () => {
  beforeEach(() => {
    clearNuxtData()
    mocks.fetch.mockReset()
    mocks.fetch.mockImplementation(async (url: string) => {
      return url.startsWith('/api/v1/shared/')
        ? SHARED_RESPONSE
        : OWNED_RESPONSE
    })
    setRoute('/', undefined)
  })

  it('keys the owned context by the chat slug', async () => {
    setRoute('/chats/chat-1', 'chat-1')

    await mountComposable()

    await vi.waitFor(() => {
      expect(mocks.fetch)
        .toHaveBeenCalledWith('/api/v1/chats/chat-1/context')
    })
    expect(Object.keys(useNuxtApp()._asyncData))
      .toContain('chat-context:owned:chat-1')
  })

  it('keys the shared context apart from an owned chat with the same slug',
    async () => {
      setRoute('/shared/only-shared', 'only-shared')

      await mountComposable()

      await vi.waitFor(() => {
        expect(mocks.fetch)
          .toHaveBeenCalledWith('/api/v1/shared/only-shared/context')
      })
      expect(Object.keys(useNuxtApp()._asyncData))
        .toContain('chat-context:shared:only-shared')
      expect(Object.keys(useNuxtApp()._asyncData))
        .not.toContain('chat-context:owned:only-shared')
    })

  it('tags the loaded data with its kind', async () => {
    setRoute('/chats/chat-1', 'chat-1')

    const { context } = await mountComposable()
    const data = context.data.value as ChatContextData

    expect(data.kind).toBe('owned')
    expect(data.chat.slug).toBe('chat-1')

    clearNuxtData()
    setRoute('/shared/share-1', 'share-1')

    const shared = await mountComposable()
    const sharedData = shared.context.data.value as ChatContextData

    expect(sharedData.kind).toBe('shared')
    expect(sharedData.chat.slug).toBe('share-1')
  })

  it('is empty and fetches nothing off chat pages', async () => {
    for (const [path, slug] of [
      ['/profile/keys', undefined],
      ['/chats/new', undefined],
      ['/chats/test', 'test'],
    ] as const) {
      clearNuxtData()
      setRoute(path, slug)

      const { context } = await mountComposable()

      expect(context.data.value).toBeNull()
      expect(context.outputsCount.value).toBe(0)
    }

    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('uses a shared key for the placeholder off chat pages', async () => {
    setRoute('/profile/keys', undefined)

    await mountComposable()

    expect(Object.keys(useNuxtApp()._asyncData))
      .toContain('chat-context:none')
  })

  it('exposes the number of outputs', async () => {
    setRoute('/chats/chat-1', 'chat-1')

    const { context } = await mountComposable()

    expect(context.outputsCount.value).toBe(3)
  })

  it('exposes the number of outputs of a shared chat', async () => {
    setRoute('/shared/share-1', 'share-1')

    const { context } = await mountComposable()

    expect(context.outputsCount.value).toBe(5)
  })

  it('reports zero outputs while nothing is loaded', async () => {
    mocks.fetch.mockImplementation(() => {
      return new Promise(() => {})
    })
    setRoute('/chats/chat-1', 'chat-1')

    const { context } = await mountComposable()

    expect(context.data.value).toBeNull()
    expect(context.outputsCount.value).toBe(0)
  })

  it('shares one in-flight request between two consumers', async () => {
    let resolveFetch: (value: typeof OWNED_RESPONSE) => void = () => {}

    mocks.fetch.mockImplementation(() => {
      return new Promise((resolve) => {
        resolveFetch = resolve
      })
    })
    setRoute('/chats/chat-1', 'chat-1')

    const first = await mountComposable()
    const second = await mountComposable()

    await vi.waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalled()
    })
    resolveFetch(OWNED_RESPONSE)
    await vi.waitFor(() => {
      expect(first.context.outputsCount.value).toBe(3)
    })

    expect(second.context.data.value).toEqual(first.context.data.value)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('refreshes with the latest outputs count', async () => {
    setRoute('/chats/chat-1', 'chat-1')

    const { context } = await mountComposable()

    expect(context.outputsCount.value).toBe(3)

    mocks.fetch.mockImplementation(async () => {
      return { ...OWNED_RESPONSE, counts: { outputs: 4, inputs: 1, used: 2 } }
    })

    await context.refresh()

    expect(context.outputsCount.value).toBe(4)
  })

  it('surfaces a failed load as an error', async () => {
    mocks.fetch.mockRejectedValue(new Error('boom'))
    setRoute('/chats/chat-1', 'chat-1')

    const { context } = await mountComposable()

    expect(context.error.value).toBeTruthy()
    expect(context.outputsCount.value).toBe(0)
  })
})
