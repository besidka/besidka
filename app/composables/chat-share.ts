import { parseError } from 'evlog'
import type {
  ChatShare,
  ChatShareOptions,
} from '~/types/chat-share.d'

export function useChatShare() {
  const nuxtApp = useNuxtApp()

  const isModalOpen = useState<boolean>(
    'chat-share:is-modal-open',
    () => false,
  )
  const targetChatSlug = useState<string | null>(
    'chat-share:target-chat-slug',
    () => null,
  )
  const targetHasFiles = useState<boolean>(
    'chat-share:target-has-files',
    () => false,
  )
  const share = useState<ChatShare | null>(
    'chat-share:active-share',
    () => null,
  )
  const isLoading = useState<boolean>('chat-share:is-loading', () => false)
  const isSaving = useState<boolean>('chat-share:is-saving', () => false)
  const isForking = useState<boolean>('chat-share:is-forking', () => false)

  async function loadShare(slug: string) {
    isLoading.value = true

    try {
      const response = await $fetch(`/api/v1/chats/${slug}/share`)

      targetHasFiles.value = response.hasFiles
      share.value = response.share?.slug && response.share.url
        ? {
          ...response.share,
          slug: response.share.slug,
          url: response.share.url,
        }
        : null
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to load share settings',
          parsedException.why,
        )
      })
    } finally {
      isLoading.value = false
    }
  }

  async function openShareModal(chatSlug: string, hasFiles = false) {
    targetChatSlug.value = chatSlug
    targetHasFiles.value = hasFiles
    isModalOpen.value = true

    await loadShare(chatSlug)
  }

  function closeShareModal() {
    isModalOpen.value = false
    targetChatSlug.value = null
    targetHasFiles.value = false
    share.value = null
  }

  async function createOrUpdateShare(
    slug: string,
    options: ChatShareOptions,
  ) {
    isSaving.value = true

    try {
      const response = await $fetch(`/api/v1/chats/${slug}/share`, {
        method: 'POST',
        body: options,
      })

      share.value = {
        slug: response.slug,
        url: response.url,
        expiresAt: response.expiresAt,
        indexable: response.indexable,
        showFiles: response.showFiles,
        showMetadata: response.showMetadata,
      }

      nuxtApp.runWithContext(() => {
        useSuccessMessage('Share link ready')
      })

      return response.url
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to create share link',
          parsedException.why,
        )
      })

      return null
    } finally {
      isSaving.value = false
    }
  }

  async function revokeShare(slug: string) {
    isSaving.value = true

    try {
      await $fetch(`/api/v1/chats/${slug}/share/revoke`, {
        method: 'POST',
      })

      share.value = null

      nuxtApp.runWithContext(() => {
        useSuccessMessage('Sharing stopped')
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to stop sharing',
          parsedException.why,
        )
      })
    } finally {
      isSaving.value = false
    }
  }

  async function forkOwnedChat(slug: string) {
    isForking.value = true

    try {
      const response = await $fetch('/api/v1/chats/branch', {
        method: 'POST',
        body: { chatSlug: slug },
      })

      nuxtApp.runWithContext(() => {
        useSuccessMessage('Chat forked')
      })

      await navigateTo(`/chats/${response.slug}`)
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to fork chat',
          parsedException.why,
        )
      })
    } finally {
      isForking.value = false
    }
  }

  return {
    isModalOpen,
    targetChatSlug,
    targetHasFiles,
    share,
    isLoading,
    isSaving,
    isForking,
    openShareModal,
    closeShareModal,
    loadShare,
    createOrUpdateShare,
    revokeShare,
    forkOwnedChat,
  }
}
