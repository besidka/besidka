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
  const queuedResetKey = shallowRef<string | null>(null)

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
    const requestKey = activeKey.value
    let retryOptions: { background: boolean } | null = null

    if (isLoading.value) {
      if (reset) {
        queuedResetKey.value = requestKey
      }

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
      isRefreshing.value = false

      const retryKey = queuedResetKey.value
      const shouldRetryQueuedReset = retryKey !== null
        && retryKey !== requestKey
        && retryKey === activeKey.value

      if (shouldRetryQueuedReset) {
        const retryHasCache = !!cache.value[retryKey]?.hasLoaded

        queuedResetKey.value = null
        isSearching.value = search.value.length >= 2
        retryOptions = {
          background: retryHasCache,
        }
      } else {
        queuedResetKey.value = null
        isSearching.value = false
      }
    }

    if (retryOptions) {
      await fetchHistory({
        reset: true,
        background: retryOptions.background,
      })
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

  function updateEntries(
    update: (
      entry: HistoryCacheEntry,
      cacheKey: string,
    ) => HistoryCacheEntry,
  ) {
    const nextCache = { ...cache.value }
    let hasActiveEntry = false

    for (const [cacheKey, entry] of Object.entries(cache.value)) {
      if (!entry.hasLoaded) {
        continue
      }

      nextCache[cacheKey] = update(entry, cacheKey)

      if (cacheKey === activeKey.value) {
        hasActiveEntry = true
      }
    }

    if (!hasActiveEntry) {
      nextCache[activeKey.value] = update({
        chats: chats.value,
        pinned: pinned.value,
        nextCursor: nextCursor.value,
        hasLoaded: true,
        lastFetchedAt: Date.now(),
      }, activeKey.value)
    }

    cache.value = nextCache
    chats.value = nextCache[activeKey.value]?.chats || []
    pinned.value = nextCache[activeKey.value]?.pinned || []
    nextCursor.value = nextCache[activeKey.value]?.nextCursor || null
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

      updateEntries((entry) => {
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
    const selectedChatIds = new Set(chatIds)
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

      updateEntries((entry) => {
        return {
          ...entry,
          chats: entry.chats.filter((chat) => {
            return !selectedChatIds.has(chat.id)
          }),
          pinned: entry.pinned.filter((chat) => {
            return !selectedChatIds.has(chat.id)
          }),
        }
      })

      clearCompletedSelection(chatIds)

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

      updateEntries((entry) => {
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

      updateEntries((entry) => {
        return {
          ...entry,
          chats: entry.chats.filter(chat => chat.id !== chatId),
          pinned: entry.pinned.filter(chat => chat.id !== chatId),
        }
      })

      clearCompletedSelection([chatId])

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

      updateEntries((entry) => {
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
    const selectedChatIds = new Set(chatIds)
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

      updateEntries((entry) => {
        const update = (items: HistoryChat[]) => {
          return items.map((chat) => {
            return selectedChatIds.has(chat.id)
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

      clearCompletedSelection(chatIds)

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

  watch(activeKey, (newKey, oldKey) => {
    if (newKey === oldKey) {
      return
    }

    deselectAll()
  })

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
