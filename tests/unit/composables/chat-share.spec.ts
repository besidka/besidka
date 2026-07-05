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
    isBranching,
    isSendingToApp,
  } = useChatShare()

  closeShareModal()
  isLoading.value = false
  isSaving.value = false
  isBranching.value = false
  isSendingToApp.value = false
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
        showAuthorAvatar: true,
        allowBranch: true,
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

  it('loads an active share row using the current origin', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({
      share: {
        slug: 'abc123',
        url: 'https://old-preview-host.example/shared/abc123',
        expiresAt: null,
        indexable: true,
        showFiles: true,
        showMetadata: false,
        showAuthorAvatar: true,
        allowBranch: false,
      },
      hasFiles: false,
    }))

    const { loadShare, share, targetChatSlug } = useChatShare()

    targetChatSlug.value = 'chat-1'
    await loadShare('chat-1')

    expect(share.value).toEqual({
      slug: 'abc123',
      url: 'http://localhost:3000/shared/abc123',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: false,
      showAuthorAvatar: true,
      allowBranch: false,
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

  it('creates a share and stores it using the current origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      slug: 'new-slug',
      url: 'https://old-preview-host.example/shared/new-slug',
      expiresAt: null,
      indexable: true,
      showFiles: false,
      showMetadata: true,
      showAuthorAvatar: false,
      allowBranch: true,
    })
    vi.stubGlobal('$fetch', fetchMock)

    const { createOrUpdateShare, share } = useChatShare()

    const url = await createOrUpdateShare('chat-1', {
      duration: 'never',
      indexable: true,
      showFiles: false,
      showMetadata: true,
      showAuthorAvatar: false,
      allowBranch: true,
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/chat-1/share', {
      method: 'POST',
      body: {
        duration: 'never',
        indexable: true,
        showFiles: false,
        showMetadata: true,
        showAuthorAvatar: false,
        allowBranch: true,
      },
    })
    expect(url).toBe('http://localhost:3000/shared/new-slug')
    expect(share.value).toEqual({
      slug: 'new-slug',
      url: 'http://localhost:3000/shared/new-slug',
      expiresAt: null,
      indexable: true,
      showFiles: false,
      showMetadata: true,
      showAuthorAvatar: false,
      allowBranch: true,
    })
  })

  it('revokes the active share and clears local state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('$fetch', fetchMock)

    const { share, revokeShare } = useChatShare()

    share.value = {
      slug: 'abc123',
      url: 'http://localhost:3000/shared/abc123',
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
      showAuthorAvatar: true,
      allowBranch: true,
    }

    await revokeShare('chat-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/chats/chat-1/share/revoke',
      { method: 'POST' },
    )
    expect(share.value).toBeNull()
  })

  it('branches an owned chat and navigates to the new chat', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ slug: 'branched-chat' })
    vi.stubGlobal('$fetch', fetchMock)

    const { branchOwnedChat } = useChatShare()

    await branchOwnedChat('chat-1')

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/branch', {
      method: 'POST',
      body: { chatSlug: 'chat-1' },
    })
    expect(navigateToMock).toHaveBeenCalledWith('/chats/branched-chat')
  })

  it('branches a shared chat and navigates to the new chat', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ slug: 'branched-chat' })
    vi.stubGlobal('$fetch', fetchMock)

    const { branchSharedChat } = useChatShare()

    await branchSharedChat('share-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/chats/shares/share-1/branch',
      { method: 'POST' },
    )
    expect(navigateToMock).toHaveBeenCalledWith('/chats/branched-chat')
  })

  it('requests a push handoff for the shared chat', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ sent: true })
    vi.stubGlobal('$fetch', fetchMock)

    const { sendSharedChatToApp, isSendingToApp } = useChatShare()

    await sendSharedChatToApp('share-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/chats/shares/share-1/handoff',
      { method: 'POST' },
    )
    expect(isSendingToApp.value).toBe(false)
  })

  it('resets the sending state when the handoff request fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'))
    vi.stubGlobal('$fetch', fetchMock)

    const { sendSharedChatToApp, isSendingToApp } = useChatShare()

    await sendSharedChatToApp('share-1')

    expect(isSendingToApp.value).toBe(false)
  })
})
