import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useChatMemoryExclusion } from '../../../app/composables/chat-memory-exclusion'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  confirm: vi.fn(),
  errorMessage: vi.fn(),
  setHistoryChatMemoryExcludedBySlug: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)
mockNuxtImport(
  'setHistoryChatMemoryExcludedBySlug',
  () => mocks.setHistoryChatMemoryExcludedBySlug,
)

describe('useChatMemoryExclusion', () => {
  beforeEach(() => {
    useState('chat-memory-exclusion:excluded-by-slug').value = {}
    useState('chat-memory-exclusion:saving-slug').value = null
    mocks.fetch.mockReset()
    mocks.confirm.mockReset()
    mocks.errorMessage.mockReset()
    mocks.setHistoryChatMemoryExcludedBySlug.mockReset()
  })

  it('falls back to the loaded value until the chat is toggled', () => {
    const { isChatMemoryExcluded, rememberChatMemoryExcluded }
      = useChatMemoryExclusion()

    expect(isChatMemoryExcluded('chat-1')).toBe(false)
    expect(isChatMemoryExcluded('chat-1', true)).toBe(true)

    rememberChatMemoryExcluded('chat-1', true)
    rememberChatMemoryExcluded('chat-1', false)

    expect(isChatMemoryExcluded('chat-1', false)).toBe(true)
  })

  it('asks before excluding and sends nothing when declined', async () => {
    mocks.confirm.mockResolvedValue(null)

    const { setChatMemoryExcluded, isChatMemoryExcluded }
      = useChatMemoryExclusion()

    await expect(setChatMemoryExcluded('chat-1', true)).resolves.toBe(false)
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Don\'t use this chat for memory?',
      subtitle: expect.stringContaining(
        'Besidka won\'t learn from this chat or find it in chat search. '
        + 'The chat is still saved in your history.',
      ),
    }))
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(isChatMemoryExcluded('chat-1')).toBe(false)
  })

  it('excludes the chat once confirmed and updates every view', async () => {
    mocks.confirm.mockResolvedValue({ label: 'ok', index: 0 })
    mocks.fetch.mockResolvedValue({ memoryExcluded: true })

    const { setChatMemoryExcluded, isChatMemoryExcluded, savingSlug }
      = useChatMemoryExclusion()

    await expect(setChatMemoryExcluded('chat-1', true)).resolves.toBe(true)
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/chats/chat-1/memory', {
      method: 'PATCH',
      body: { excluded: true },
    })
    expect(isChatMemoryExcluded('chat-1', false)).toBe(true)
    expect(mocks.setHistoryChatMemoryExcludedBySlug)
      .toHaveBeenCalledWith('chat-1', true)
    expect(savingSlug.value).toBeNull()
  })

  it('turns the exclusion off without asking', async () => {
    mocks.fetch.mockResolvedValue({ memoryExcluded: false })

    const { setChatMemoryExcluded, isChatMemoryExcluded }
      = useChatMemoryExclusion()

    await setChatMemoryExcluded('chat-1', false)

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/chats/chat-1/memory', {
      method: 'PATCH',
      body: { excluded: false },
    })
    expect(isChatMemoryExcluded('chat-1', true)).toBe(false)
  })

  it('shows the error and keeps the old value when the request fails',
    async () => {
      mocks.confirm.mockResolvedValue({ label: 'ok', index: 0 })
      mocks.fetch.mockRejectedValue(
        Object.assign(new Error('Chat not found'), { status: 404 }),
      )

      const { setChatMemoryExcluded, isChatMemoryExcluded, savingSlug }
        = useChatMemoryExclusion()

      await expect(setChatMemoryExcluded('chat-1', true)).resolves.toBe(false)
      expect(mocks.errorMessage).toHaveBeenCalledOnce()
      expect(isChatMemoryExcluded('chat-1')).toBe(false)
      expect(savingSlug.value).toBeNull()
    })
})
