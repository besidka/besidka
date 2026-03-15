import { parseError } from 'evlog'
import type { Project, ProjectChatsResponse } from '#shared/types/projects.d'
import type { HistoryChat } from '#shared/types/history.d'

interface ProjectChatsCacheEntry {
  project: Project | null
  pinned: HistoryChat[]
  chats: HistoryChat[]
  nextCursor: string | null
  hasLoaded: boolean
  lastFetchedAt: number | null
}

export function useProjectChats(projectId: MaybeRefOrGetter<string>) {
  const nuxtApp = useNuxtApp()
  const resolvedProjectId = computed(() => toValue(projectId))
  const cache = useState<Record<string, ProjectChatsCacheEntry>>(
    'project-chats:cache',
    () => ({}),
  )

  const project = useState<Project | null>('project-chats:project', () => null)
  const pinned = useState<HistoryChat[]>('project-chats:pinned', () => [])
  const chats = useState<HistoryChat[]>('project-chats:chats', () => [])
  const nextCursor = useState<string | null>('project-chats:cursor', () => null)

  const isLoadingInitial = shallowRef<boolean>(false)
  const isRefreshing = shallowRef<boolean>(false)
  const isLoadingMore = shallowRef<boolean>(false)
  const isLoading = shallowRef<boolean>(false)
  const queuedResetKey = shallowRef<string | null>(null)

  const cacheKey = computed(() => {
    return `project:${resolvedProjectId.value}`
  })

  const hasCachedData = computed(() => {
    return !!cache.value[cacheKey.value]?.hasLoaded
  })

  const hasMore = computed(() => nextCursor.value !== null)

  function applyEntry(entry: ProjectChatsCacheEntry) {
    project.value = entry.project
    pinned.value = entry.pinned
    chats.value = entry.chats
    nextCursor.value = entry.nextCursor
  }

  function setEntry(entryCacheKey: string, entry: ProjectChatsCacheEntry) {
    cache.value = {
      ...cache.value,
      [entryCacheKey]: entry,
    }

    if (entryCacheKey === cacheKey.value) {
      applyEntry(entry)
    }
  }

  function prime(response: ProjectChatsResponse) {
    setEntry(cacheKey.value, {
      project: response.project,
      pinned: response.pinned,
      chats: response.chats,
      nextCursor: response.nextCursor,
      hasLoaded: true,
      lastFetchedAt: Date.now(),
    })
  }

  function hydrateFromCache() {
    const entry = cache.value[cacheKey.value]

    if (!entry?.hasLoaded) {
      return false
    }

    applyEntry(entry)

    return true
  }

  async function fetchProjectChats(options?: {
    reset?: boolean
    background?: boolean
    cursor?: string | null
  }) {
    const { reset = true, background = false, cursor = null } = options || {}
    const requestCacheKey = cacheKey.value
    let retryOptions: { background: boolean } | null = null

    if (!resolvedProjectId.value) {
      return
    }

    if (isLoading.value) {
      if (reset) {
        queuedResetKey.value = requestCacheKey
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
    } else {
      isLoadingMore.value = true
    }

    try {
      const requestProjectId = resolvedProjectId.value
      const currentEntry = cache.value[requestCacheKey]
      const currentProject = currentEntry?.project || project.value
      const currentPinned = currentEntry?.pinned || pinned.value
      const currentChats = currentEntry?.chats || chats.value

      const response = await $fetch(
        `/api/v1/projects/${requestProjectId}/chats`,
        {
          query: cursor ? { cursor } : undefined,
        },
      )

      if (reset) {
        setEntry(requestCacheKey, {
          project: response.project,
          pinned: response.pinned,
          chats: response.chats,
          nextCursor: response.nextCursor,
          hasLoaded: true,
          lastFetchedAt: Date.now(),
        })
      } else {
        const updatedChats = [...currentChats, ...response.chats]

        setEntry(requestCacheKey, {
          project: currentProject,
          pinned: currentPinned,
          chats: updatedChats,
          nextCursor: response.nextCursor,
          hasLoaded: true,
          lastFetchedAt: Date.now(),
        })
      }
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to load chats',
          parsedException.why,
        )
      })
    } finally {
      isLoading.value = false
      isLoadingInitial.value = false
      isRefreshing.value = false
      isLoadingMore.value = false

      const retryKey = queuedResetKey.value
      const shouldRetryQueuedReset = retryKey !== null
        && retryKey !== requestCacheKey
        && retryKey === cacheKey.value

      if (shouldRetryQueuedReset) {
        const retryHasCache = !!cache.value[retryKey]?.hasLoaded

        queuedResetKey.value = null
        retryOptions = {
          background: retryHasCache,
        }
      } else {
        queuedResetKey.value = null
      }
    }

    if (retryOptions) {
      await fetchProjectChats({
        reset: true,
        background: retryOptions.background,
      })
    }
  }

  async function hydrateAndRefresh() {
    const hasCache = hydrateFromCache()

    if (!hasCache) {
      project.value = null
      pinned.value = []
      chats.value = []
      nextCursor.value = null
    }

    await fetchProjectChats({
      reset: true,
      background: hasCache,
    })
  }

  async function loadMore() {
    if (!hasMore.value || isLoading.value) {
      return
    }

    await fetchProjectChats({
      reset: false,
      cursor: nextCursor.value,
    })
  }

  function updateLists(
    updater: (items: HistoryChat[]) => HistoryChat[],
    nextProject: Project | null = project.value,
  ) {
    const entry = cache.value[cacheKey.value] || {
      project: nextProject,
      pinned: [],
      chats: [],
      nextCursor: null,
      hasLoaded: false,
      lastFetchedAt: null,
    }

    setEntry(cacheKey.value, {
      ...entry,
      project: nextProject,
      pinned: updater(entry.pinned),
      chats: updater(entry.chats),
    })
  }

  function removeChat(chatId: string) {
    updateLists((items) => {
      return items.filter(chat => chat.id !== chatId)
    })
  }

  function renameChat(chatId: string, title: string) {
    const existingChat = [...pinned.value, ...chats.value].find((chat) => {
      return chat.id === chatId
    })

    if (!existingChat) {
      return
    }

    const updatedChat = {
      ...existingChat,
      title,
      activityAt: new Date().toISOString(),
    }

    setEntry(cacheKey.value, {
      project: project.value,
      pinned: existingChat.pinnedAt
        ? pinned.value.map((chat) => {
          return chat.id === chatId ? updatedChat : chat
        })
        : pinned.value,
      chats: existingChat.pinnedAt
        ? chats.value
        : [
          updatedChat,
          ...chats.value.filter((chat) => {
            return chat.id !== chatId
          }),
        ],
      nextCursor: nextCursor.value,
      hasLoaded: true,
      lastFetchedAt: Date.now(),
    })
  }

  function moveChat(chatId: string, projectTargetId: string | null) {
    if (projectTargetId !== resolvedProjectId.value) {
      removeChat(chatId)

      return
    }

    updateLists((items) => {
      return items.map((chat) => {
        return chat.id === chatId
          ? { ...chat, projectId: projectTargetId }
          : chat
      })
    })
  }

  function togglePin(chatId: string, pinnedAt: string | null) {
    const allChats = [...pinned.value, ...chats.value]
    const targetChat = allChats.find(chat => chat.id === chatId)

    if (!targetChat) {
      return
    }

    const updatedChat = {
      ...targetChat,
      pinnedAt,
      activityAt: new Date().toISOString(),
    }

    if (pinnedAt) {
      setEntry(cacheKey.value, {
        project: project.value,
        pinned: [
          updatedChat,
          ...pinned.value.filter(chat => chat.id !== chatId),
        ],
        chats: chats.value.filter(chat => chat.id !== chatId),
        nextCursor: nextCursor.value,
        hasLoaded: true,
        lastFetchedAt: Date.now(),
      })

      return
    }

    setEntry(cacheKey.value, {
      project: project.value,
      pinned: pinned.value.filter(chat => chat.id !== chatId),
      chats: [updatedChat, ...chats.value.filter(chat => chat.id !== chatId)],
      nextCursor: nextCursor.value,
      hasLoaded: true,
      lastFetchedAt: Date.now(),
    })
  }

  function updateProject(nextProject: Project) {
    const entry = cache.value[cacheKey.value] || {
      project: nextProject,
      pinned: pinned.value,
      chats: chats.value,
      nextCursor: nextCursor.value,
      hasLoaded: true,
      lastFetchedAt: Date.now(),
    }

    setEntry(cacheKey.value, {
      ...entry,
      project: nextProject,
    })
  }

  watch(resolvedProjectId, () => {
    if (!resolvedProjectId.value) {
      return
    }

    hydrateAndRefresh()
  })

  return {
    project,
    pinned,
    chats,
    nextCursor,
    hasMore,
    hasCachedData,
    isLoadingInitial,
    isRefreshing,
    isLoadingMore,
    prime,
    hydrateAndRefresh,
    loadMore,
    removeChat,
    renameChat,
    moveChat,
    togglePin,
    updateProject,
  }
}
