import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ShareModal from '../../../../app/components/Chat/ShareModal.client.vue'
import { useChatShare } from '../../../../app/composables/chat-share'

function resetChatShareState() {
  const {
    closeShareModal,
    isLoading,
    isSaving,
    isForking,
  } = useChatShare()

  closeShareModal()
  isLoading.value = false
  isSaving.value = false
  isForking.value = false
}

function findButtonByText(
  wrapper: Awaited<ReturnType<typeof mountSuspended>>,
  text: string,
) {
  return wrapper.findAll('button').find((button) => {
    return button.text() === text
  })
}

describe('Chat/ShareModal.client', () => {
  beforeEach(() => {
    resetChatShareState()
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(() => {})
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(() => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })

    const { targetChatSlug } = useChatShare()

    targetChatSlug.value = 'chat-1'
  })

  afterEach(() => {
    resetChatShareState()
    vi.unstubAllGlobals()
  })

  it('shows the file warning when the chat has files and files are shown', async () => {
    const { targetHasFiles } = useChatShare()

    targetHasFiles.value = true

    const wrapper = await mountSuspended(ShareModal)

    expect(wrapper.find('[data-testid="share-files-warning"]').exists())
      .toBe(true)
  })

  it('hides the file warning when the chat has no files', async () => {
    const { targetHasFiles } = useChatShare()

    targetHasFiles.value = false

    const wrapper = await mountSuspended(ShareModal)

    expect(wrapper.find('[data-testid="share-files-warning"]').exists())
      .toBe(false)
  })

  it('hides the file warning once the show-files toggle is switched off', async () => {
    const { targetHasFiles } = useChatShare()

    targetHasFiles.value = true

    const wrapper = await mountSuspended(ShareModal)

    expect(wrapper.find('[data-testid="share-files-warning"]').exists())
      .toBe(true)

    await wrapper.find('[data-testid="share-toggle-files"]')
      .setValue(false)

    expect(wrapper.find('[data-testid="share-files-warning"]').exists())
      .toBe(false)
  })

  it('generates a share link and renders it in the link input', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      slug: 'share-1',
      url: 'https://example.com/shared/share-1',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
    })
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = await mountSuspended(ShareModal)

    await wrapper.find('[data-testid="share-generate-button"]')
      .trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/chat-1/share', {
      method: 'POST',
      body: {
        duration: 'forever',
        indexable: true,
        showFiles: true,
        showMetadata: true,
      },
    })

    const linkInput = wrapper.find('[data-testid="share-link-input"]')

    expect(linkInput.exists()).toBe(true)
    expect((linkInput.element as HTMLInputElement).value).toBe(
      'https://example.com/shared/share-1',
    )
  })

  it('copies the share link to the clipboard', async () => {
    const { share } = useChatShare()

    share.value = {
      slug: 'share-1',
      url: 'https://example.com/shared/share-1',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
    }

    const wrapper = await mountSuspended(ShareModal)
    const copyButton = findButtonByText(wrapper, 'Copy')

    expect(copyButton).toBeDefined()

    await copyButton!.trigger('click')
    await new Promise(resolve => setTimeout(resolve))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://example.com/shared/share-1',
    )
  })

  it('stops sharing and removes the active share', async () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('$fetch', fetchMock)

    const { share } = useChatShare()

    share.value = {
      slug: 'share-1',
      url: 'https://example.com/shared/share-1',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
    }

    const wrapper = await mountSuspended(ShareModal)

    await wrapper.find('[data-testid="share-revoke-button"]')
      .trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/chats/chat-1/share/revoke',
      { method: 'POST' },
    )
    expect(share.value).toBeNull()
    expect(wrapper.find('[data-testid="share-revoke-button"]').exists())
      .toBe(false)
  })
})
