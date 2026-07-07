import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ShareModal from '../../../../app/components/Chat/ShareModal.client.vue'
import { useChatShare } from '../../../../app/composables/chat-share'
import * as messagesComposable from '../../../../app/composables/messages'

const useConfirmMock = vi.hoisted(() => {
  return vi.fn<() => Promise<boolean | null>>(async () => true)
})

mockNuxtImport('useConfirm', () => {
  return useConfirmMock
})

function resetChatShareState() {
  const {
    closeShareModal,
    isLoading,
    isSaving,
    isBranching,
  } = useChatShare()

  closeShareModal()
  isLoading.value = false
  isSaving.value = false
  isBranching.value = false
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

  it('defaults the author avatar toggle to on', async () => {
    const wrapper = await mountSuspended(ShareModal)

    const authorToggle = wrapper.find('[data-testid="share-toggle-author"]')

    expect((authorToggle.element as HTMLInputElement).checked).toBe(true)
  })

  it('defaults the allow branch toggle to on', async () => {
    const wrapper = await mountSuspended(ShareModal)

    const branchToggle = wrapper.find('[data-testid="share-toggle-branch"]')

    expect((branchToggle.element as HTMLInputElement).checked).toBe(true)
  })

  it('labels the metadata toggle "Show message details"', async () => {
    const wrapper = await mountSuspended(ShareModal)

    const toggleInput = wrapper.find('[data-testid="share-toggle-metadata"]')
    const toggleRow = toggleInput.element.closest('label')

    expect(toggleRow?.querySelector('span')?.textContent?.trim())
      .toBe('Show message details')
  })

  it('renders each toggle row with the label before the toggle', async () => {
    const wrapper = await mountSuspended(ShareModal)

    const toggleTestIds = [
      'share-toggle-indexable',
      'share-toggle-files',
      'share-toggle-metadata',
      'share-toggle-author',
      'share-toggle-branch',
    ]

    toggleTestIds.forEach((testId) => {
      const toggleInput = wrapper.find(`[data-testid="${testId}"]`)
      const toggleRow = toggleInput.element.closest('label')

      expect(toggleRow?.firstElementChild?.tagName).toBe('SPAN')
      expect(toggleRow?.lastElementChild?.tagName).toBe('INPUT')
    })
  })

  it('generates a share link, auto-copies it, and shows the Copied state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      slug: 'share-1',
      url: 'https://old-preview-host.example/shared/share-1',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
      showAuthorAvatar: true,
      allowBranch: true,
    })
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = await mountSuspended(ShareModal)

    await wrapper.find('[data-testid="share-generate-button"]')
      .trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/chat-1/share', {
      method: 'POST',
      body: {
        duration: 'never',
        indexable: true,
        showFiles: true,
        showMetadata: true,
        showAuthorAvatar: true,
        allowBranch: true,
      },
    })

    const linkInput = wrapper.find('[data-testid="share-link-input"]')

    expect(linkInput.exists()).toBe(true)
    expect((linkInput.element as HTMLInputElement).value).toBe(
      'http://localhost:3000/shared/share-1',
    )

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'http://localhost:3000/shared/share-1',
    )

    const copyButton = wrapper.find('[data-testid="share-copy-button"]')

    expect(copyButton.text()).toContain('Copied!')
  })

  it('does not show an error when auto-copy fails after generating', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
    })

    const fetchMock = vi.fn().mockResolvedValue({
      slug: 'share-1',
      url: 'https://old-preview-host.example/shared/share-1',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
      showAuthorAvatar: true,
      allowBranch: true,
    })
    vi.stubGlobal('$fetch', fetchMock)

    const wrapper = await mountSuspended(ShareModal)

    await wrapper.find('[data-testid="share-generate-button"]')
      .trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'http://localhost:3000/shared/share-1',
    )
    expect(useErrorMessage).not.toHaveBeenCalled()
  })

  it('shows an error when the explicit copy button fails', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
    })

    const { share } = useChatShare()

    share.value = {
      slug: 'share-1',
      url: 'http://localhost:3000/shared/share-1',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
      showAuthorAvatar: true,
      allowBranch: true,
    }

    const wrapper = await mountSuspended(ShareModal)

    await wrapper.find('[data-testid="share-copy-button"]')
      .trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(useErrorMessage).toHaveBeenCalledWith('Failed to copy link')
  })

  it('copies the share link to the clipboard on demand', async () => {
    const { share } = useChatShare()

    share.value = {
      slug: 'share-1',
      url: 'http://localhost:3000/shared/share-1',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
      showAuthorAvatar: true,
      allowBranch: true,
    }

    const wrapper = await mountSuspended(ShareModal)

    expect(wrapper.find('[data-testid="share-copy-button"]').text())
      .toContain('Copy')

    await wrapper.find('[data-testid="share-copy-button"]')
      .trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'http://localhost:3000/shared/share-1',
    )
    expect(wrapper.find('[data-testid="share-copy-button"]').text())
      .toContain('Copied!')
  })

  it('stops sharing and removes the active share', async () => {
    useConfirmMock.mockResolvedValue(true)

    const fetchMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('$fetch', fetchMock)

    const { share } = useChatShare()

    share.value = {
      slug: 'share-1',
      url: 'http://localhost:3000/shared/share-1',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
      showAuthorAvatar: true,
      allowBranch: true,
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

  it('does not stop sharing when confirmation is declined', async () => {
    useConfirmMock.mockResolvedValue(null)

    const fetchMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('$fetch', fetchMock)

    const { share } = useChatShare()

    share.value = {
      slug: 'share-1',
      url: 'http://localhost:3000/shared/share-1',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
      showAuthorAvatar: true,
      allowBranch: true,
    }

    const wrapper = await mountSuspended(ShareModal)

    await wrapper.find('[data-testid="share-revoke-button"]')
      .trigger('click')
    await new Promise(resolve => setTimeout(resolve))
    await wrapper.vm.$nextTick()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(share.value).not.toBeNull()
  })

  it('disables the submit buttons while loading share settings', async () => {
    const { isLoading } = useChatShare()

    isLoading.value = true

    const wrapper = await mountSuspended(ShareModal)

    expect(
      wrapper.find('[data-testid="share-form-skeleton"]').exists(),
    ).toBe(true)
    expect(
      (
        wrapper.find('[data-testid="share-generate-button"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('resets stale toggle state when the target chat changes', async () => {
    const wrapper = await mountSuspended(ShareModal)

    await wrapper.find('[data-testid="share-toggle-indexable"]')
      .setValue(false)

    expect(
      (
        wrapper.find('[data-testid="share-toggle-indexable"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(false)

    const { targetChatSlug } = useChatShare()

    targetChatSlug.value = 'chat-2'
    await wrapper.vm.$nextTick()

    expect(
      (
        wrapper.find('[data-testid="share-toggle-indexable"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(true)
  })
})
