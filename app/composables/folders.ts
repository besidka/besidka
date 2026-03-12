import { parseError } from 'evlog'
import type { Folder, FoldersResponse } from '#shared/types/folders.d'

interface FoldersCacheEntry {
  folders: Folder[]
  pinned: Folder[]
  hasLoaded: boolean
  lastFetchedAt: number | null
}

export function useFolders() {
  const nuxtApp = useNuxtApp()
  const cache = useState<Record<string, FoldersCacheEntry>>(
    'folders:cache',
    () => ({}),
  )

  const folders = useState<Folder[]>('folders:list', () => [])
  const pinned = useState<Folder[]>('folders:pinned', () => [])
  const search = useState<string>('folders:search', () => '')
  const sortBy = useState<'name' | 'activity'>('folders:sort', () => 'activity')
  const showArchived = useState<boolean>('folders:archived', () => false)

  const isLoading = shallowRef<boolean>(false)
  const isLoadingInitial = shallowRef<boolean>(false)
  const isSearching = shallowRef<boolean>(false)
  const isRefreshing = shallowRef<boolean>(false)
  const isCreating = shallowRef<boolean>(false)

  const activeKey = computed(() => {
    return [
      'folders',
      search.value.trim().toLowerCase(),
      sortBy.value,
      showArchived.value ? 'archived' : 'active',
    ].join(':')
  })

  const hasCachedData = computed(() => {
    return !!cache.value[activeKey.value]?.hasLoaded
  })

  function setEntry(cacheKey: string, entry: FoldersCacheEntry) {
    cache.value = {
      ...cache.value,
      [cacheKey]: entry,
    }

    if (cacheKey === activeKey.value) {
      folders.value = entry.folders
      pinned.value = entry.pinned
    }
  }

  function prime(response: FoldersResponse) {
    setEntry(activeKey.value, {
      folders: response.folders,
      pinned: response.pinned,
      hasLoaded: true,
      lastFetchedAt: Date.now(),
    })
  }

  function hydrateFromCache() {
    const entry = cache.value[activeKey.value]

    if (!entry?.hasLoaded) {
      return false
    }

    folders.value = entry.folders
    pinned.value = entry.pinned

    return true
  }

  async function fetchFolders(options?: {
    background?: boolean
  }) {
    const { background = false } = options || {}

    isLoading.value = true

    if (background) {
      isRefreshing.value = true
    } else {
      isLoadingInitial.value = true
    }

    try {
      const requestKey = activeKey.value
      const requestSearch = search.value
      const requestSortBy = sortBy.value
      const requestShowArchived = showArchived.value

      const response = await $fetch('/api/v1/folders', {
        query: {
          ...(requestSearch.length >= 2 ? { search: requestSearch } : {}),
          sortBy: requestSortBy,
          ...(requestShowArchived ? { archived: 'true' } : {}),
        },
      })

      setEntry(requestKey, {
        folders: response.folders,
        pinned: response.pinned,
        hasLoaded: true,
        lastFetchedAt: Date.now(),
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to load folders',
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
      folders.value = []
      pinned.value = []
    }

    await fetchFolders({ background: hasCache })
  }

  function updateEntry(
    update: (entry: FoldersCacheEntry) => FoldersCacheEntry,
  ) {
    const currentEntry = cache.value[activeKey.value] || {
      folders: folders.value,
      pinned: pinned.value,
      hasLoaded: true,
      lastFetchedAt: Date.now(),
    }

    setEntry(activeKey.value, update(currentEntry))
  }

  function matchesActiveFilters(folder: Folder) {
    if (showArchived.value) {
      return folder.archivedAt !== null
    }

    if (folder.archivedAt !== null) {
      return false
    }

    const normalizedSearch = search.value.trim().toLowerCase()

    if (normalizedSearch.length < 2) {
      return true
    }

    return folder.name.toLowerCase().includes(normalizedSearch)
  }

  function sortFolders(items: Folder[]) {
    return [...items].sort((firstFolder, secondFolder) => {
      if (sortBy.value === 'name') {
        return firstFolder.name.localeCompare(secondFolder.name)
      }

      return secondFolder.activityAt.localeCompare(firstFolder.activityAt)
    })
  }

  async function createFolder(name: string) {
    isCreating.value = true

    try {
      const folder = await $fetch('/api/v1/folders', {
        method: 'PUT',
        body: { name },
      })

      updateEntry((entry) => {
        if (!matchesActiveFilters(folder)) {
          return entry
        }

        return {
          ...entry,
          folders: sortFolders([folder, ...entry.folders]),
        }
      })

      nuxtApp.runWithContext(() => {
        useSuccessMessage('Folder created')
      })

      return folder
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to create folder',
          parsedException.why,
        )
      })

      return null
    } finally {
      isCreating.value = false
    }
  }

  async function renameFolder(folderId: string, name: string) {
    try {
      await $fetch(`/api/v1/folders/${folderId}/name`, {
        method: 'PATCH',
        body: { name },
      })

      updateEntry((entry) => {
        const update = (items: Folder[]) => {
          return items.map((folder) => {
            return folder.id === folderId ? { ...folder, name } : folder
          })
        }

        return {
          ...entry,
          folders: update(entry.folders),
          pinned: update(entry.pinned),
        }
      })

      nuxtApp.runWithContext(() => {
        useSuccessMessage('Folder renamed')
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to rename folder',
          parsedException.why,
        )
      })
    }
  }

  async function togglePin(folderId: string) {
    try {
      const result = await $fetch(`/api/v1/folders/${folderId}/pin`, {
        method: 'POST',
      })

      const newPinnedAt = result.pinnedAt
      const folder = folders.value.find(candidate => candidate.id === folderId)
        ?? pinned.value.find(candidate => candidate.id === folderId)

      if (!folder) return

      updateEntry((entry) => {
        if (newPinnedAt) {
          return {
            ...entry,
            folders: entry.folders.filter((candidate) => {
              return candidate.id !== folderId
            }),
            pinned: [
              { ...folder, pinnedAt: newPinnedAt },
              ...entry.pinned.filter(candidate => candidate.id !== folderId),
            ],
          }
        }

        return {
          ...entry,
          folders: [
            { ...folder, pinnedAt: null },
            ...entry.folders.filter(candidate => candidate.id !== folderId),
          ],
          pinned: entry.pinned.filter(candidate => candidate.id !== folderId),
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

  async function toggleArchive(folderId: string) {
    try {
      const result = await $fetch(`/api/v1/folders/${folderId}/archive`, {
        method: 'POST',
      })

      const newArchivedAt = (result as { archivedAt: Date | null }).archivedAt

      updateEntry((entry) => {
        const removeFolder = (items: Folder[]) => {
          return items.filter(folder => folder.id !== folderId)
        }

        if (showArchived.value) {
          const targetFolder = [
            ...entry.folders,
            ...entry.pinned,
          ].find(folder => folder.id === folderId)

          if (!newArchivedAt || !targetFolder) {
            return {
              ...entry,
              folders: removeFolder(entry.folders),
              pinned: removeFolder(entry.pinned),
            }
          }
        }

        return {
          ...entry,
          folders: removeFolder(entry.folders),
          pinned: removeFolder(entry.pinned),
        }
      })

      nuxtApp.runWithContext(() => {
        useSuccessMessage(newArchivedAt ? 'Folder archived' : 'Folder restored')
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to archive folder',
          parsedException.why,
        )
      })
    }
  }

  async function deleteFolder(folderId: string) {
    try {
      await $fetch(`/api/v1/folders/${folderId}`, {
        method: 'DELETE',
      })

      updateEntry((entry) => {
        return {
          ...entry,
          folders: entry.folders.filter(folder => folder.id !== folderId),
          pinned: entry.pinned.filter(folder => folder.id !== folderId),
        }
      })

      nuxtApp.runWithContext(() => {
        useSuccessMessage('Folder deleted')
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to delete folder',
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

  watch([sortBy, showArchived], () => {
    hydrateAndRefresh()
  })

  return {
    folders,
    pinned,
    search,
    sortBy,
    showArchived,
    isLoading,
    isLoadingInitial,
    isSearching,
    isRefreshing,
    isCreating,
    hasCachedData,
    prime,
    hydrateAndRefresh,
    createFolder,
    renameFolder,
    togglePin,
    toggleArchive,
    deleteFolder,
  }
}
