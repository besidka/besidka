import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, ref } from 'vue'
import {
  NEW_CHAT_BESIDKA_TOOLS_KEY,
  useBesidkaToolsSelection,
  useComposerBesidkaTools,
} from '../../../app/composables/composer-besidka-tools'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  errorMessage: vi.fn(),
}))

const activeFlags = ref<Set<string>>(new Set())

mockNuxtImport('useFeature', () => {
  return (flag: string) => computed(() => ({
    enabled: activeFlags.value.has(flag),
    active: activeFlags.value.has(flag),
    variant: null,
  }))
})
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)

async function mountComposable(chatSlug: string | null = null) {
  const slug = ref<string | null>(chatSlug)
  let result: ReturnType<typeof useComposerBesidkaTools> | null = null

  await mountSuspended(defineComponent({
    setup() {
      result = useComposerBesidkaTools(() => slug.value)

      return () => null
    },
  }))
  await flushPromises()

  return { composable: result!, slug }
}

describe('useComposerBesidkaTools', () => {
  beforeEach(() => {
    activeFlags.value = new Set(['besidka-tools', 'tool-approvals'])
    mocks.fetch.mockReset()
    mocks.errorMessage.mockReset()
    useBesidkaToolsSelection().selection.value = {
      chatKey: NEW_CHAT_BESIDKA_TOOLS_KEY,
      enabled: true,
      isKnown: true,
    }
  })

  it('is available only with the Labs opt-in and tool approvals', async () => {
    const { composable } = await mountComposable()

    expect(composable.isAvailable.value).toBe(true)

    activeFlags.value = new Set(['besidka-tools'])

    expect(composable.isAvailable.value).toBe(false)
  })

  it('is on for a new chat and toggles locally until it has a slug',
    async () => {
      const { composable } = await mountComposable()

      expect(composable.isEnabled.value).toBe(true)

      await composable.toggle()

      expect(composable.isEnabled.value).toBe(false)
      expect(mocks.fetch).not.toHaveBeenCalled()

      useBesidkaToolsSelection().handOff('01HZXAAAAAAAAAAAAAAAAAAAAA')

      expect(useBesidkaToolsSelection().selection.value).toEqual({
        chatKey: '01HZXAAAAAAAAAAAAAAAAAAAAA',
        enabled: false,
        isKnown: true,
      })
    })

  it('reads the stored choice of a chat and saves a toggle', async () => {
    mocks.fetch.mockImplementation(async (_url: string, options?: {
      method?: string
      body?: { enabled: boolean }
    }) => {
      return { enabled: options?.body?.enabled ?? false }
    })

    const { composable } = await mountComposable('01HZXBBBBBBBBBBBBBBBBBBBBB')

    expect(mocks.fetch)
      .toHaveBeenCalledWith('/api/v1/chats/01HZXBBBBBBBBBBBBBBBBBBBBB/besidka-tools')
    expect(composable.isEnabled.value).toBe(false)

    await composable.toggle()

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/chats/01HZXBBBBBBBBBBBBBBBBBBBBB/besidka-tools',
      { method: 'PUT', body: { enabled: true } },
    )
    expect(composable.isEnabled.value).toBe(true)
  })

  it('rolls back and reports a failed save', async () => {
    mocks.fetch.mockResolvedValueOnce({ enabled: true })

    const { composable } = await mountComposable('01HZXBBBBBBBBBBBBBBBBBBBBB')

    mocks.fetch.mockRejectedValueOnce(new Error('Nope'))

    await composable.toggle()

    expect(composable.isEnabled.value).toBe(true)
    expect(mocks.errorMessage).toHaveBeenCalledTimes(1)
  })

  it('reads nothing while unavailable', async () => {
    activeFlags.value = new Set()

    await mountComposable('01HZXBBBBBBBBBBBBBBBBBBBBB')

    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
