import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useChatPin } from '../../../app/composables/chat-pin'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  errorMessage: vi.fn(),
  setHistoryChatPinnedBySlug: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)
mockNuxtImport(
  'setHistoryChatPinnedBySlug',
  () => mocks.setHistoryChatPinnedBySlug,
)

const CONTEXT_KEY = 'chat-context:owned:chat-1'

function seedContext(pinnedAt: string | null) {
  const nuxtApp = useNuxtApp()

  nuxtApp._asyncData[CONTEXT_KEY] = {
    data: ref({
      kind: 'owned',
      chat: { id: 'id-1', slug: 'chat-1', pinnedAt },
    }),
  } as never
}

function readPinnedAt(): string | null {
  const nuxtApp = useNuxtApp()
  const data = nuxtApp._asyncData[CONTEXT_KEY]!.data as never as {
    value: { chat: { pinnedAt: string | null } }
  }

  return data.value.chat.pinnedAt
}

describe('useChatPin', () => {
  beforeEach(() => {
    useState('chat-pin:saving-slug').value = null
    mocks.fetch.mockReset()
    mocks.errorMessage.mockReset()
    mocks.setHistoryChatPinnedBySlug.mockReset()
  })

  it('pins an unpinned chat and syncs the panel and History', async () => {
    seedContext(null)
    mocks.fetch.mockResolvedValue({ pinnedAt: '2026-11-10T10:00:00.000Z' })

    const { toggleChatPin, savingSlug } = useChatPin()

    await expect(toggleChatPin({
      id: 'id-1',
      slug: 'chat-1',
      pinnedAt: null,
    })).resolves.toBe(true)

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/chats/history/pin', {
      method: 'POST',
      body: { chatId: 'id-1' },
    })
    expect(readPinnedAt()).toBe('2026-11-10T10:00:00.000Z')
    expect(mocks.setHistoryChatPinnedBySlug).toHaveBeenCalledWith(
      'chat-1',
      '2026-11-10T10:00:00.000Z',
    )
    expect(savingSlug.value).toBeNull()
  })

  it('unpins a pinned chat', async () => {
    seedContext('2026-11-10T10:00:00.000Z')
    mocks.fetch.mockResolvedValue({ pinnedAt: null })

    const { toggleChatPin } = useChatPin()

    await toggleChatPin({
      id: 'id-1',
      slug: 'chat-1',
      pinnedAt: '2026-11-10T10:00:00.000Z',
    })

    expect(readPinnedAt()).toBeNull()
    expect(mocks.setHistoryChatPinnedBySlug)
      .toHaveBeenCalledWith('chat-1', null)
  })

  it('flips the panel optimistically before the request settles',
    async () => {
      seedContext(null)

      type PinResponse = { pinnedAt: string | null }

      let resolveRequest: (value: PinResponse) => void = () => {}

      mocks.fetch.mockReturnValue(new Promise((resolve) => {
        resolveRequest = resolve
      }))

      const { toggleChatPin, savingSlug } = useChatPin()
      const pending = toggleChatPin({
        id: 'id-1',
        slug: 'chat-1',
        pinnedAt: null,
      })

      expect(readPinnedAt()).not.toBeNull()
      expect(savingSlug.value).toBe('chat-1')

      resolveRequest({ pinnedAt: '2026-11-10T10:00:00.000Z' })
      await pending
    })

  it('ignores a second toggle while the first one saves', async () => {
    seedContext(null)

    const { toggleChatPin, savingSlug } = useChatPin()

    savingSlug.value = 'chat-1'

    await expect(toggleChatPin({
      id: 'id-1',
      slug: 'chat-1',
      pinnedAt: null,
    })).resolves.toBe(false)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rolls back and shows the error when the request fails', async () => {
    seedContext(null)
    mocks.fetch.mockRejectedValue(
      Object.assign(new Error('Chat not found'), { status: 404 }),
    )

    const { toggleChatPin, savingSlug } = useChatPin()

    await expect(toggleChatPin({
      id: 'id-1',
      slug: 'chat-1',
      pinnedAt: null,
    })).resolves.toBe(false)

    expect(readPinnedAt()).toBeNull()
    expect(mocks.errorMessage).toHaveBeenCalledOnce()
    expect(mocks.setHistoryChatPinnedBySlug).not.toHaveBeenCalled()
    expect(savingSlug.value).toBeNull()
  })
})
