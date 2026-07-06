import { parseError } from 'evlog'
import type {
  SharedChat,
  SharedChatsResponse,
} from '#shared/types/history.d'

interface SharedChatsCacheEntry {
  chats: SharedChat[]
  nextCursor: string | null
  hasLoaded: boolean
  lastFetchedAt: number | null
}

export function removeSharedChatBySlug(slug: string) {
  const chats = useState<SharedChat[]>('shared-chats:chats', () => [])
  const cache = useState<SharedChatsCacheEntry | null>(
    'shared-chats:cache',
    () => null,
  )
  const nextCursor = useState<string | null>(
    'shared-chats:cursor',
    () => null,
  )

  const chatToRemove = chats.value.find(chat => chat.slug === slug)

  if (!chatToRemove) {
    return
  }

  const updatedChats = chats.value.filter((chat) => {
    return chat.id !== chatToRemove.id
  })

  chats.value = updatedChats
  cache.value = {
    chats: updatedChats,
    nextCursor: nextCursor.value,
    hasLoaded: true,
    lastFetchedAt: Date.now(),
  }
}

export function useSharedChats() {
  const nuxtApp = useNuxtApp()
  const cache = useState<SharedChatsCacheEntry | null>(
    'shared-chats:cache',
    () => null,
  )

  const chats = useState<SharedChat[]>('shared-chats:chats', () => [])
  const nextCursor = useState<string | null>(
    'shared-chats:cursor',
    () => null,
  )

  const isLoading = shallowRef<boolean>(false)
  const isLoadingInitial = shallowRef<boolean>(false)
  const isRefreshing = shallowRef<boolean>(false)
  const hasMore = computed(() => nextCursor.value !== null)
  const hasCachedData = computed(() => !!cache.value?.hasLoaded)

  const selectedIds = ref<Set<string>>(new Set())
  const isSelectionMode = shallowRef<boolean>(false)
  const selectedCount = computed(() => selectedIds.value.size)
  const lastSelectedIndex = shallowRef<number | null>(null)

  function setEntry(entry: SharedChatsCacheEntry) {
    cache.value = entry
    chats.value = entry.chats
    nextCursor.value = entry.nextCursor
  }

  function prime(response: SharedChatsResponse) {
    setEntry({
      chats: response.chats,
      nextCursor: response.nextCursor,
      hasLoaded: true,
      lastFetchedAt: Date.now(),
    })
  }

  function hydrateFromCache() {
    if (!cache.value?.hasLoaded) {
      return false
    }

    chats.value = cache.value.chats
    nextCursor.value = cache.value.nextCursor

    return true
  }

  async function fetchSharedChats(options?: {
    reset?: boolean
    background?: boolean
  }) {
    const { reset = false, background = false } = options || {}

    if (isLoading.value) {
      return
    }

    isLoading.value = true

    if (reset) {
      if (background) {
        isRefreshing.value = true
      } else {
        isLoadingInitial.value = true
      }
    }

    try {
      const currentChats = cache.value?.chats || chats.value

      const response = await $fetch('/api/v1/chats/shared', {
        query: nextCursor.value && !reset
          ? { cursor: nextCursor.value }
          : undefined,
      })

      setEntry({
        chats: reset
          ? response.chats
          : [...currentChats, ...response.chats],
        nextCursor: response.nextCursor,
        hasLoaded: true,
        lastFetchedAt: Date.now(),
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to load shared chats',
          parsedException.why,
        )
      })
    } finally {
      isLoading.value = false
      isLoadingInitial.value = false
      isRefreshing.value = false
    }
  }

  async function hydrateAndRefresh() {
    const hasCache = hydrateFromCache()

    if (!hasCache) {
      chats.value = []
      nextCursor.value = null
    }

    await fetchSharedChats({ reset: true, background: hasCache })
  }

  async function loadMore() {
    if (!hasMore.value || isLoading.value) return

    await fetchSharedChats({ reset: false })
  }

  function removeChats(chatIds: string[]) {
    const idsToRemove = new Set(chatIds)

    setEntry({
      chats: chats.value.filter((chat) => {
        return !idsToRemove.has(chat.id)
      }),
      nextCursor: nextCursor.value,
      hasLoaded: true,
      lastFetchedAt: Date.now(),
    })
  }

  function clearCompletedSelection(chatIds: string[]) {
    const completedChatIds = new Set(chatIds)

    selectedIds.value = new Set(
      Array.from(selectedIds.value).filter((chatId) => {
        return !completedChatIds.has(chatId)
      }),
    )

    if (selectedIds.value.size === 0) {
      isSelectionMode.value = false
      lastSelectedIndex.value = null
    }
  }

  function toggleSelect(chatId: string, index?: number) {
    if (selectedIds.value.has(chatId)) {
      selectedIds.value.delete(chatId)
    } else {
      selectedIds.value.add(chatId)
    }

    if (index !== undefined) {
      lastSelectedIndex.value = index
    }

    selectedIds.value = new Set(selectedIds.value)

    if (selectedIds.value.size === 0) {
      isSelectionMode.value = false
    }
  }

  function selectRange(fromIndex: number, toIndex: number) {
    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)

    for (let index = start; index <= end; index++) {
      const chat = chats.value[index]

      if (chat) {
        selectedIds.value.add(chat.id)
      }
    }

    lastSelectedIndex.value = toIndex
    selectedIds.value = new Set(selectedIds.value)
  }

  function handleSelect(chatId: string, index: number, shiftKey: boolean) {
    const hasSelection = selectedIds.value.size > 0
    const isAlreadySelected = selectedIds.value.has(chatId)

    if (
      shiftKey
      && !isAlreadySelected
      && lastSelectedIndex.value !== null
      && hasSelection
    ) {
      selectRange(lastSelectedIndex.value, index)
    } else {
      toggleSelect(chatId, index)
    }
  }

  function enterSelectionMode(chatId: string, index?: number) {
    isSelectionMode.value = true
    lastSelectedIndex.value = index ?? null
    selectedIds.value = new Set([chatId])
  }

  function deselectAll() {
    selectedIds.value = new Set()
    isSelectionMode.value = false
    lastSelectedIndex.value = null
  }

  async function cancelSharing(chatId: string) {
    try {
      await $fetch('/api/v1/chats/shared/revoke', {
        method: 'POST',
        body: { chatIds: [chatId] },
      })

      removeChats([chatId])
      clearCompletedSelection([chatId])

      nuxtApp.runWithContext(() => {
        useSuccessMessage('Sharing cancelled')
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to cancel sharing',
          parsedException.why,
        )
      })
    }
  }

  async function cancelSharingSelected() {
    if (selectedIds.value.size === 0) return

    const chatIds = Array.from(selectedIds.value)
    const chunks = []

    for (let index = 0; index < chatIds.length; index += 90) {
      chunks.push(chatIds.slice(index, index + 90))
    }

    const succeededChatIds: string[] = []

    try {
      for (const chunk of chunks) {
        await $fetch('/api/v1/chats/shared/revoke', {
          method: 'POST',
          body: { chatIds: chunk },
        })

        succeededChatIds.push(...chunk)
      }

      nuxtApp.runWithContext(() => {
        useSuccessMessage(
          `Sharing cancelled for ${chatIds.length} `
          + `chat${chatIds.length === 1 ? '' : 's'}`,
        )
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to cancel sharing',
          parsedException.why,
        )
      })
    } finally {
      if (succeededChatIds.length > 0) {
        removeChats(succeededChatIds)
        clearCompletedSelection(succeededChatIds)
      }
    }
  }

  return {
    chats,
    nextCursor,
    isLoading,
    isLoadingInitial,
    isRefreshing,
    hasMore,
    hasCachedData,
    selectedIds,
    isSelectionMode,
    selectedCount,
    prime,
    hydrateAndRefresh,
    loadMore,
    toggleSelect,
    handleSelect,
    enterSelectionMode,
    deselectAll,
    cancelSharing,
    cancelSharingSelected,
  }
}
