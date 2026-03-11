import { parseError } from 'evlog'
import type { HistoryChat, HistoryResponse } from '#shared/types/history.d'

interface HistoryCacheEntry {
  pinned: HistoryChat[]
  chats: HistoryChat[]
  nextCursor: string | null
  hasLoaded: boolean
  lastFetchedAt: number | null
}

export function useHistory() {
  const nuxtApp = useNuxtApp()
  const cache = useState<Record<string, HistoryCacheEntry>>(
    'history:cache',
    () => ({}),
  )

  const chats = useState<HistoryChat[]>('history:chats', () => [])
  const pinned = useState<HistoryChat[]>('history:pinned', () => [])
  const nextCursor = useState<string | null>('history:cursor', () => null)
  const search = useState<string>('history:search', () => '')

  const isLoading = shallowRef<boolean>(false)
  const isLoadingInitial = shallowRef<boolean>(false)
  const isSearching = shallowRef<boolean>(false)
  const isRefreshing = shallowRef<boolean>(false)
  const hasMore = computed(() => nextCursor.value !== null)

  const selectedIds = ref<Set<string>>(new Set())
  const isSelectionMode = shallowRef<boolean>(false)
  const selectedCount = computed(() => selectedIds.value.size)
  const lastSelectedIndex = shallowRef<number | null>(null)

  const activeKey = computed(() => {
    return `history:${search.value.trim().toLowerCase()}`
  })

  const hasCachedData = computed(() => {
    return !!cache.value[activeKey.value]?.hasLoaded
  })

  function setEntry(cacheKey: string, entry: HistoryCacheEntry) {
    cache.value = {
      ...cache.value,
      [cacheKey]: entry,
    }

    if (cacheKey === activeKey.value) {
      chats.value = entry.chats
      pinned.value = entry.pinned
      nextCursor.value = entry.nextCursor
    }
  }

  function prime(response: HistoryResponse) {
    setEntry(activeKey.value, {
      chats: response.chats,
      pinned: response.pinned,
      nextCursor: response.nextCursor,
      hasLoaded: true,
      lastFetchedAt: Date.now(),
    })
  }

  function hydrateFromCache() {
    const entry = cache.value[activeKey.value]

    if (!entry?.hasLoaded) {
      return false
    }

    chats.value = entry.chats
    pinned.value = entry.pinned
    nextCursor.value = entry.nextCursor

    return true
  }

  async function fetchHistory(options?: {
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
      const requestKey = activeKey.value
      const requestSearch = search.value
      const currentEntry = cache.value[requestKey]
      const currentChats = currentEntry?.chats || chats.value
      const currentPinned = currentEntry?.pinned || pinned.value

      const response = await $fetch('/api/v1/chats/history', {
        query: {
          ...(nextCursor.value && !reset ? { cursor: nextCursor.value } : {}),
          ...(requestSearch.length >= 2 ? { search: requestSearch } : {}),
        },
      })

      if (reset) {
        setEntry(requestKey, {
          chats: response.chats,
          pinned: response.pinned,
          nextCursor: response.nextCursor,
          hasLoaded: true,
          lastFetchedAt: Date.now(),
        })
      } else {
        setEntry(requestKey, {
          chats: [...currentChats, ...response.chats],
          pinned: currentPinned,
          nextCursor: response.nextCursor,
          hasLoaded: true,
          lastFetchedAt: Date.now(),
        })
      }
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to load history',
          parsedException.why,
        )
      })
    } finally {
      isLoading.value = false
      isLoadingInitial.value = false
      isSearching.value = false
      isRefreshing.value = false
    }
  }

  async function hydrateAndRefresh() {
    const hasCache = hydrateFromCache()

    if (!hasCache) {
      chats.value = []
      pinned.value = []
      nextCursor.value = null
    }

    await fetchHistory({
      reset: true,
      background: hasCache,
    })
  }

  async function loadMore() {
    if (!hasMore.value || isLoading.value) return

    await fetchHistory({ reset: false })
  }

  function updateEntry(
    update: (entry: HistoryCacheEntry) => HistoryCacheEntry,
  ) {
    const currentEntry = cache.value[activeKey.value] || {
      chats: chats.value,
      pinned: pinned.value,
      nextCursor: nextCursor.value,
      hasLoaded: true,
      lastFetchedAt: Date.now(),
    }

    setEntry(activeKey.value, update(currentEntry))
  }

  async function togglePin(chatId: string) {
    try {
      const result = await $fetch('/api/v1/chats/history/pin', {
        method: 'POST',
        body: { chatId },
      })

      const allChats = [...chats.value, ...pinned.value]
      const chat = allChats.find(candidate => candidate.id === chatId)

      if (!chat) return

      const newPinnedAt = result.pinnedAt
      const updatedChat = {
        ...chat,
        pinnedAt: newPinnedAt,
        activityAt: new Date().toISOString(),
      }

      updateEntry((entry) => {
        if (newPinnedAt) {
          return {
            ...entry,
            pinned: [
              updatedChat,
              ...entry.pinned.filter(candidate => candidate.id !== chatId),
            ],
            chats: entry.chats.filter(candidate => candidate.id !== chatId),
          }
        }

        return {
          ...entry,
          pinned: entry.pinned.filter(candidate => candidate.id !== chatId),
          chats: [
            updatedChat,
            ...entry.chats.filter(candidate => candidate.id !== chatId),
          ],
        }
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to toggle pin',
          parsedException.why,
        )
      })
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
    const allChats = [...pinned.value, ...chats.value]
    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)

    for (let index = start; index <= end; index++) {
      const chat = allChats[index]

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

  async function deleteSelected() {
    if (selectedIds.value.size === 0) return

    const chatIds = Array.from(selectedIds.value)
    const chunks = []

    for (let index = 0; index < chatIds.length; index += 90) {
      chunks.push(chatIds.slice(index, index + 90))
    }

    try {
      for (const chunk of chunks) {
        await $fetch('/api/v1/chats/history/delete/bulk', {
          method: 'POST',
          body: { chatIds: chunk },
        })
      }

      updateEntry((entry) => {
        return {
          ...entry,
          chats: entry.chats.filter(chat => !selectedIds.value.has(chat.id)),
          pinned: entry.pinned.filter(chat => !selectedIds.value.has(chat.id)),
        }
      })

      selectedIds.value = new Set()
      isSelectionMode.value = false

      nuxtApp.runWithContext(() => {
        useSuccessMessage(
          `${chatIds.length} chat${chatIds.length === 1 ? '' : 's'} deleted`,
        )
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to delete chats',
          parsedException.why,
        )
      })
    }
  }

  async function renameChat(chatId: string, slug: string, title: string) {
    try {
      await $fetch(`/api/v1/chats/${slug}/rename`, {
        method: 'PATCH',
        body: { title },
      })

      updateEntry((entry) => {
        const existingChat = [...entry.pinned, ...entry.chats].find((chat) => {
          return chat.id === chatId
        })

        if (!existingChat) {
          return entry
        }

        const updatedChat = {
          ...existingChat,
          title,
          activityAt: new Date().toISOString(),
        }

        return {
          ...entry,
          chats: existingChat.pinnedAt
            ? entry.chats
            : [
              updatedChat,
              ...entry.chats.filter((chat) => {
                return chat.id !== chatId
              }),
            ],
          pinned: existingChat.pinnedAt
            ? entry.pinned.map((chat) => {
              return chat.id === chatId ? updatedChat : chat
            })
            : entry.pinned,
        }
      })

      nuxtApp.runWithContext(() => {
        useSuccessMessage('Chat renamed')
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to rename chat',
          parsedException.why,
        )
      })
    }
  }

  async function deleteChat(chatId: string, slug: string) {
    try {
      await $fetch(`/api/v1/chats/${slug}`, {
        method: 'DELETE',
      })

      updateEntry((entry) => {
        return {
          ...entry,
          chats: entry.chats.filter(chat => chat.id !== chatId),
          pinned: entry.pinned.filter(chat => chat.id !== chatId),
        }
      })

      selectedIds.value.delete(chatId)
      selectedIds.value = new Set(selectedIds.value)

      nuxtApp.runWithContext(() => {
        useSuccessMessage('Chat deleted')
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to delete chat',
          parsedException.why,
        )
      })
    }
  }

  async function moveChatToFolder(
    chatId: string,
    slug: string,
    folderId: string | null,
    folderName: string | null = null,
  ) {
    try {
      await $fetch(`/api/v1/chats/${slug}/folder`, {
        method: 'PATCH',
        body: { folderId },
      })

      updateEntry((entry) => {
        const update = (items: HistoryChat[]) => {
          return items.map((chat) => {
            return chat.id === chatId
              ? { ...chat, folderId, folderName }
              : chat
          })
        }

        return {
          ...entry,
          chats: update(entry.chats),
          pinned: update(entry.pinned),
        }
      })

      nuxtApp.runWithContext(() => {
        useSuccessMessage(folderId ? 'Moved to folder' : 'Removed from folder')
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to move chat',
          parsedException.why,
        )
      })
    }
  }

  async function moveSelectedToFolder(
    folderId: string | null,
    folderName: string | null = null,
  ) {
    if (selectedIds.value.size === 0) return

    const chatIds = Array.from(selectedIds.value)
    const chunks = []

    for (let index = 0; index < chatIds.length; index += 90) {
      chunks.push(chatIds.slice(index, index + 90))
    }

    try {
      for (const chunk of chunks) {
        await $fetch('/api/v1/chats/history/folder/bulk', {
          method: 'POST',
          body: { chatIds: chunk, folderId },
        })
      }

      updateEntry((entry) => {
        const update = (items: HistoryChat[]) => {
          return items.map((chat) => {
            return selectedIds.value.has(chat.id)
              ? { ...chat, folderId, folderName }
              : chat
          })
        }

        return {
          ...entry,
          chats: update(entry.chats),
          pinned: update(entry.pinned),
        }
      })

      selectedIds.value = new Set()
      isSelectionMode.value = false

      nuxtApp.runWithContext(() => {
        useSuccessMessage(
          folderId
            ? `${chatIds.length} chat${chatIds.length === 1 ? '' : 's'} moved to folder`
            : `${chatIds.length} chat${chatIds.length === 1 ? '' : 's'} removed from folder`,
        )
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to move chats',
          parsedException.why,
        )
      })
    }
  }

  const debouncedSearch = useDebounceFn(() => {
    isSearching.value = search.value.length >= 2
    hydrateAndRefresh()
  }, 180)

  watch(search, () => {
    debouncedSearch()
  })

  return {
    chats,
    pinned,
    nextCursor,
    search,
    isLoading,
    isLoadingInitial,
    isSearching,
    isRefreshing,
    hasCachedData,
    hasMore,
    prime,
    selectedIds,
    isSelectionMode,
    selectedCount,
    hydrateAndRefresh,
    loadMore,
    togglePin,
    toggleSelect,
    handleSelect,
    enterSelectionMode,
    deselectAll,
    deleteSelected,
    renameChat,
    deleteChat,
    moveChatToFolder,
    moveSelectedToFolder,
  }
}
