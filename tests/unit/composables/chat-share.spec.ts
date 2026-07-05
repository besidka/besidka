import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useChatShare } from '../../../app/composables/chat-share'

const { navigateToMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn(),
}))

mockNuxtImport('navigateTo', () => navigateToMock)

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

describe('useChatShare', () => {
  beforeEach(() => {
    resetChatShareState()
    navigateToMock.mockClear()
  })

  afterEach(() => {
    resetChatShareState()
    vi.unstubAllGlobals()
  })

  it('narrows a share row with no slug to no active share', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({
      share: {
        slug: null,
        url: null,
        expiresAt: null,
        indexable: true,
        showFiles: true,
        showMetadata: true,
      },
      hasFiles: true,
    }))

    const {
      loadShare,
      share,
      targetChatSlug,
      targetHasFiles,
    } = useChatShare()

    targetChatSlug.value = 'chat-1'
    await loadShare('chat-1')

    expect(share.value).toBeNull()
    expect(targetHasFiles.value).toBe(true)
  })

  it('treats a null share payload as no active share', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({
      share: null,
      hasFiles: false,
    }))

    const {
      loadShare,
      share,
      targetChatSlug,
      targetHasFiles,
    } = useChatShare()

    targetChatSlug.value = 'chat-1'
    await loadShare('chat-1')

    expect(share.value).toBeNull()
    expect(targetHasFiles.value).toBe(false)
  })

  it('loads an active share row', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({
      share: {
        slug: 'abc123',
        url: 'https://example.com/shared/abc123',
        expiresAt: null,
        indexable: true,
        showFiles: true,
        showMetadata: false,
      },
      hasFiles: false,
    }))

    const { loadShare, share, targetChatSlug } = useChatShare()

    targetChatSlug.value = 'chat-1'
    await loadShare('chat-1')

    expect(share.value).toEqual({
      slug: 'abc123',
      url: 'https://example.com/shared/abc123',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: false,
    })
  })

  it('opens the modal and overrides targetHasFiles from the GET response', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({
      share: null,
      hasFiles: true,
    }))

    const { openShareModal, isModalOpen, targetChatSlug, targetHasFiles }
      = useChatShare()

    await openShareModal('chat-1', false)

    expect(isModalOpen.value).toBe(true)
    expect(targetChatSlug.value).toBe('chat-1')
    expect(targetHasFiles.value).toBe(true)
  })

  it('creates a share and stores it, returning the share url', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      slug: 'new-slug',
      url: 'https://example.com/shared/new-slug',
      expiresAt: null,
      indexable: true,
      showFiles: false,
      showMetadata: true,
    })
    vi.stubGlobal('$fetch', fetchMock)

    const { createOrUpdateShare, share } = useChatShare()

    const url = await createOrUpdateShare('chat-1', {
      duration: 'forever',
      indexable: true,
      showFiles: false,
      showMetadata: true,
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/chat-1/share', {
      method: 'POST',
      body: {
        duration: 'forever',
        indexable: true,
        showFiles: false,
        showMetadata: true,
      },
    })
    expect(url).toBe('https://example.com/shared/new-slug')
    expect(share.value).toEqual({
      slug: 'new-slug',
      url: 'https://example.com/shared/new-slug',
      expiresAt: null,
      indexable: true,
      showFiles: false,
      showMetadata: true,
    })
  })

  it('revokes the active share and clears local state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('$fetch', fetchMock)

    const { share, revokeShare } = useChatShare()

    share.value = {
      slug: 'abc123',
      url: 'https://example.com/shared/abc123',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
    }

    await revokeShare('chat-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/chats/chat-1/share/revoke',
      { method: 'POST' },
    )
    expect(share.value).toBeNull()
  })

  it('forks an owned chat and navigates to the new chat', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ slug: 'forked-chat' })
    vi.stubGlobal('$fetch', fetchMock)

    const { forkOwnedChat } = useChatShare()

    await forkOwnedChat('chat-1')

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/branch', {
      method: 'POST',
      body: { chatSlug: 'chat-1' },
    })
    expect(navigateToMock).toHaveBeenCalledWith('/chats/forked-chat')
  })
})
