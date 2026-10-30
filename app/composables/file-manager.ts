import { parseError } from 'evlog'
import type {
  FetchFilesResponse,
  FileManagerFile,
  FileSourceFilter,
  ViewMode,
} from '~/types/file-manager'

interface FileRequestContext {
  generation: number
  search: string
  source: FileSourceFilter
}

export function useFileManager() {
  const files = ref<FileManagerFile[]>([])
  const selectedIds = ref<Set<string>>(new Set())
  const lastSelectedIndex = shallowRef<number | null>(null)
  const lastSelectedGroupId = shallowRef<string | null>(null)
  const isLoading = shallowRef<boolean>(false)
  const isFlatSearching = shallowRef<boolean>(false)
  const isDeletingSelected = shallowRef<boolean>(false)
  const searchLoadingTimeout = shallowRef<
    ReturnType<typeof setTimeout> | null
  >(null)
  const searchDebounceTimeout = shallowRef<
    ReturnType<typeof setTimeout> | null
  >(null)
  const search = shallowRef<string>('')
  const source = shallowRef<FileSourceFilter>('all')
  const projectGroupsManager = useFileManagerProjectGroups({ search })
  const projectGroups = projectGroupsManager.groups
  const prefStorage = usePreferenceStorage()
  const viewMode = customRef<ViewMode>((track, trigger) => ({
    get() {
      track()

      return (
        prefStorage.getItem('file-manager-view-mode') as ViewMode
      ) ?? 'grid'
    },
    set(value) {
      prefStorage.setItem('file-manager-view-mode', value)
      requestPersistence()
      trigger()
    },
  }))
  const pagination = reactive({
    offset: 0,
    limit: 20,
    total: 0,
  })
  const serverOffset = shallowRef<number>(0)
  let fileRequestGeneration = 0
  let isFileManagerActive = false

  const hasMore = computed(() => {
    if (files.value.length > 0) {
      return serverOffset.value < pagination.total
    }

    return pagination.total > 0
  })

  const selectedCount = computed(() => selectedIds.value.size)

  const loadedFiles = computed<FileManagerFile[]>(() => {
    const uniqueFiles = new Map<string, FileManagerFile>()

    for (const file of [
      ...files.value,
      ...projectGroupsManager.loadedFiles.value,
    ]) {
      if (!uniqueFiles.has(file.id)) {
        uniqueFiles.set(file.id, file)
      }
    }

    return Array.from(uniqueFiles.values())
  })

  const selectedFiles = computed(() => {
    return loadedFiles.value.filter((file) => {
      return selectedIds.value.has(file.id)
    })
  })

  const hasSelection = computed(() => selectedIds.value.size > 0)

  const allSelected = computed(() => {
    return files.value.length > 0
      && files.value.every(file => selectedIds.value.has(file.id))
  })

  function clearSearchTimeout() {
    if (searchLoadingTimeout.value) {
      clearTimeout(searchLoadingTimeout.value)
      searchLoadingTimeout.value = null
    }
    isFlatSearching.value = false
  }

  function clearSearchDebounce() {
    if (!searchDebounceTimeout.value) {
      return
    }

    clearTimeout(searchDebounceTimeout.value)
    searchDebounceTimeout.value = null
  }

  function invalidateFileRequests() {
    fileRequestGeneration++
    isLoading.value = false
    clearSearchTimeout()
    projectGroupsManager.invalidate()
  }

  function createFileRequestContext(): FileRequestContext {
    return {
      generation: ++fileRequestGeneration,
      search: search.value,
      source: source.value,
    }
  }

  function isCurrentFileRequest(context: FileRequestContext): boolean {
    return context.generation === fileRequestGeneration
  }

  async function fetchProjectGroups(reset: boolean, isSearch: boolean) {
    if (!reset) {
      return false
    }

    pagination.offset = 0
    pagination.total = 0
    serverOffset.value = 0
    files.value = []
    selectedIds.value = new Set()
    lastSelectedIndex.value = null
    lastSelectedGroupId.value = null

    return projectGroupsManager.fetchGroups(false, isSearch)
  }

  async function fetchFiles(reset = false, isSearch = false) {
    isFileManagerActive = true

    if (source.value === 'project') {
      return fetchProjectGroups(reset, isSearch)
    }

    const requestContext = createFileRequestContext()
    const requestOffset = reset ? 0 : pagination.offset
    let isSuccess = false

    if (reset) {
      pagination.offset = 0
      serverOffset.value = 0
      files.value = []
      projectGroupsManager.clear()
      selectedIds.value.clear()
      selectedIds.value = new Set()
      lastSelectedIndex.value = null
      lastSelectedGroupId.value = null
    }

    isLoading.value = true

    if (isSearch) {
      clearSearchTimeout()
      searchLoadingTimeout.value = setTimeout(() => {
        if (!isCurrentFileRequest(requestContext)) {
          return
        }

        isFlatSearching.value = true
      }, 300)
    }

    try {
      const response = await $fetch<FetchFilesResponse>('/api/v1/files', {
        query: {
          offset: requestOffset,
          limit: pagination.limit,
          source: requestContext.source,
          ...(requestContext.search && {
            search: requestContext.search,
          }),
        },
      })

      if (!isCurrentFileRequest(requestContext)) {
        return false
      }

      if (reset) {
        files.value = response.files
        serverOffset.value = response.files.length
      } else {
        files.value.push(...response.files)
        serverOffset.value += response.files.length
      }

      pagination.total = response.total
      isSuccess = true
    } catch (exception) {
      if (!isCurrentFileRequest(requestContext)) {
        return false
      }

      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to load files',
        parsedException.why,
      )
    } finally {
      if (isCurrentFileRequest(requestContext)) {
        isLoading.value = false
        clearSearchTimeout()
      }
    }

    return isSuccess
  }

  async function loadMore() {
    if (!hasMore.value || isLoading.value) return

    pagination.offset = serverOffset.value
    await fetchFiles(false)
  }

  function pruneSelectionToLoadedFiles() {
    const loadedIds = new Set(loadedFiles.value.map(file => file.id))

    selectedIds.value = new Set(
      Array.from(selectedIds.value).filter((id) => {
        return loadedIds.has(id)
      }),
    )

    if (selectedIds.value.size === 0) {
      lastSelectedIndex.value = null
      lastSelectedGroupId.value = null
    }
  }

  async function syncLoadedFiles() {
    invalidateFileRequests()

    if (source.value === 'project') {
      const isSynced = await projectGroupsManager.fetchGroups(true)

      pruneSelectionToLoadedFiles()

      return isSynced
    }

    const requestContext = createFileRequestContext()
    const loadedCount = Math.max(files.value.length, pagination.limit)
    const syncedFiles: FileManagerFile[] = []
    let syncedTotal = pagination.total
    let offset = 0

    while (syncedFiles.length < loadedCount) {
      const remainingCount = loadedCount - syncedFiles.length
      const response = await $fetch<FetchFilesResponse>('/api/v1/files', {
        query: {
          offset,
          limit: Math.min(remainingCount, 100),
          source: requestContext.source,
          ...(requestContext.search && {
            search: requestContext.search,
          }),
        },
      })

      if (!isCurrentFileRequest(requestContext)) {
        return false
      }

      if (offset === 0) {
        syncedTotal = response.total
      }

      if (response.files.length === 0) {
        break
      }

      syncedFiles.push(...response.files)
      offset += response.files.length

      if (syncedFiles.length >= syncedTotal) {
        break
      }
    }

    if (!isCurrentFileRequest(requestContext)) {
      return false
    }

    files.value = syncedFiles
    pagination.total = syncedTotal
    serverOffset.value = syncedFiles.length

    if (files.value.length === 0) {
      pagination.offset = 0
    } else {
      pagination.offset = Math.floor(
        (files.value.length - 1) / pagination.limit,
      ) * pagination.limit
    }

    const visibleIds = new Set(files.value.map(file => file.id))

    selectedIds.value = new Set(
      Array.from(selectedIds.value).filter((id) => {
        return visibleIds.has(id)
      }),
    )

    if (selectedIds.value.size === 0) {
      lastSelectedIndex.value = null
    }

    return true
  }

  function toggleSelect(id: string, index?: number, groupId?: string) {
    if (selectedIds.value.has(id)) {
      selectedIds.value.delete(id)
    } else {
      selectedIds.value.add(id)
    }

    if (index !== undefined) {
      lastSelectedIndex.value = index
      lastSelectedGroupId.value = groupId ?? null
    }

    selectedIds.value = new Set(selectedIds.value)
  }

  function selectRange(fromIndex: number, toIndex: number) {
    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)

    for (let index = start; index <= end; index++) {
      const file = files.value[index]
      if (file) {
        selectedIds.value.add(file.id)
      }
    }

    lastSelectedIndex.value = toIndex
    lastSelectedGroupId.value = null

    selectedIds.value = new Set(selectedIds.value)
  }

  function handleSelect(id: string, index: number, shiftKey: boolean) {
    if (shiftKey && lastSelectedIndex.value !== null && hasSelection.value) {
      selectRange(lastSelectedIndex.value, index)
    } else {
      toggleSelect(id, index)
    }
  }

  function getProjectGroupFiles(groupId: string): FileManagerFile[] {
    return projectGroupsManager.findGroup(groupId)?.files ?? []
  }

  function selectProjectGroupRange(
    groupId: string,
    fromIndex: number,
    toIndex: number,
  ) {
    const groupFiles = getProjectGroupFiles(groupId)
    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)

    for (let index = start; index <= end; index++) {
      const file = groupFiles[index]

      if (file) {
        selectedIds.value.add(file.id)
      }
    }

    lastSelectedIndex.value = toIndex
    lastSelectedGroupId.value = groupId
    selectedIds.value = new Set(selectedIds.value)
  }

  function handleProjectGroupSelect(
    groupId: string,
    id: string,
    index: number,
    shiftKey: boolean,
  ) {
    if (
      shiftKey
      && lastSelectedIndex.value !== null
      && lastSelectedGroupId.value === groupId
      && hasSelection.value
    ) {
      selectProjectGroupRange(groupId, lastSelectedIndex.value, index)

      return
    }

    toggleSelect(id, index, groupId)
  }

  function toggleProjectGroupSelectAll(groupId: string) {
    const groupFiles = getProjectGroupFiles(groupId)
    const isGroupAllSelected = groupFiles.length > 0
      && groupFiles.every(file => selectedIds.value.has(file.id))

    for (const file of groupFiles) {
      if (isGroupAllSelected) {
        selectedIds.value.delete(file.id)
      } else {
        selectedIds.value.add(file.id)
      }
    }

    selectedIds.value = new Set(selectedIds.value)

    if (selectedIds.value.size === 0) {
      lastSelectedIndex.value = null
      lastSelectedGroupId.value = null
    }
  }

  function selectAll() {
    selectedIds.value = new Set(files.value.map(file => file.id))
  }

  function deselectAll() {
    selectedIds.value.clear()
    selectedIds.value = new Set()
    lastSelectedIndex.value = null
    lastSelectedGroupId.value = null
  }

  function toggleSelectAll() {
    if (allSelected.value) {
      deselectAll()
    } else {
      selectAll()
    }
  }

  async function renameFile(id: string, newName: string) {
    try {
      const result = await $fetch(`/api/v1/files/${id}/name`, {
        method: 'PATCH',
        body: { name: newName },
      })

      const matchingFile = files.value.find(file => file.id === id)
      if (matchingFile) {
        matchingFile.name = result.name
      }

      projectGroupsManager.renameFile(id, result.name)

      useSuccessMessage('File renamed successfully')

      return true
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to rename file',
        parsedException.why,
      )

      return false
    }
  }

  function reconcileDeletedFiles(ids: string[]) {
    const deletedIds = new Set(ids)
    const previousFileCount = files.value.length

    files.value = files.value.filter((file) => {
      return !deletedIds.has(file.id)
    })

    const removedFileCount = previousFileCount - files.value.length

    pagination.total = Math.max(0, pagination.total - removedFileCount)
    projectGroupsManager.removeFiles(ids)
    selectedIds.value = new Set(
      Array.from(selectedIds.value).filter((selectedId) => {
        return !deletedIds.has(selectedId)
      }),
    )

    if (selectedIds.value.size === 0) {
      lastSelectedIndex.value = null
      lastSelectedGroupId.value = null
    }
  }

  async function syncAfterStaleDelete() {
    if (!isFileManagerActive) {
      return
    }

    try {
      await syncLoadedFiles()
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        'File deleted, but the file list could not be refreshed',
        parsedException.why,
      )
    }
  }

  async function deleteFile(id: string) {
    const requestGeneration = fileRequestGeneration

    try {
      await $fetch(`/api/v1/files/${id}`, {
        method: 'DELETE',
      })

      const hasStaleRequestContext
        = requestGeneration !== fileRequestGeneration

      reconcileDeletedFiles([id])

      if (hasStaleRequestContext) {
        await syncAfterStaleDelete()
      } else if (files.value.length === 0 && pagination.total > 0) {
        await fetchFiles(true)
      }

      useSuccessMessage('File deleted successfully')

      return true
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to delete file',
        parsedException.why,
      )

      return false
    }
  }

  async function deleteSelected() {
    if (selectedIds.value.size === 0) return false

    const ids = Array.from(selectedIds.value)
    const requestGeneration = fileRequestGeneration
    isDeletingSelected.value = true

    try {
      await $fetch('/api/v1/files/delete/bulk', {
        method: 'POST',
        body: { ids },
      })

      const hasStaleRequestContext
        = requestGeneration !== fileRequestGeneration

      reconcileDeletedFiles(ids)

      useSuccessMessage(`${ids.length} file(s) deleted successfully`)

      if (hasStaleRequestContext) {
        await syncAfterStaleDelete()
      } else if (files.value.length === 0 && pagination.total > 0) {
        await fetchFiles(true)
      }

      return true
    } catch (exception) {
      const parsedException = parseError(exception)

      if (
        parsedException.status === 409
        && requestGeneration === fileRequestGeneration
      ) {
        try {
          await syncLoadedFiles()
        } catch {
          reset()
        }
      }

      useErrorMessage(
        parsedException.message || 'Failed to delete files',
        parsedException.why,
      )

      return false
    } finally {
      isDeletingSelected.value = false
    }
  }

  function getSelectedForAttach(): FileManagerFile[] {
    const selected = selectedFiles.value

    deselectAll()

    return selected
  }

  function reset() {
    isFileManagerActive = false
    invalidateFileRequests()
    clearSearchDebounce()
    files.value = []
    projectGroupsManager.clear()
    selectedIds.value.clear()
    selectedIds.value = new Set()
    lastSelectedIndex.value = null
    lastSelectedGroupId.value = null
    search.value = ''
    pagination.offset = 0
    pagination.total = 0
    serverOffset.value = 0
    clearSearchDebounce()
  }

  watch(search, () => {
    invalidateFileRequests()
    clearSearchDebounce()
    searchDebounceTimeout.value = setTimeout(() => {
      searchDebounceTimeout.value = null
      fetchFiles(true, true)
    }, 300)
  }, { flush: 'sync' })

  watch(source, async () => {
    invalidateFileRequests()
    clearSearchDebounce()
    await fetchFiles(true)
  }, { flush: 'sync' })

  return {
    files,
    selectedIds,
    lastSelectedIndex,
    isLoading,
    isSearching: computed(() => {
      return isFlatSearching.value || projectGroupsManager.isSearching.value
    }),
    search,
    source,
    viewMode,
    pagination,
    projectGroups,
    isProjectGroupsLoading: projectGroupsManager.isLoading,
    projectLoadedFiles: projectGroupsManager.loadedFiles,

    hasMore,
    loadedFiles,
    selectedCount,
    selectedFiles,
    hasSelection,
    allSelected,

    fetchFiles,
    loadMore,
    toggleProjectGroup: projectGroupsManager.toggleGroup,
    loadMoreProjectGroup: projectGroupsManager.loadMoreGroup,
    selectProjectGroupRange,
    handleProjectGroupSelect,
    toggleProjectGroupSelectAll,
    isDeletingSelected,
    toggleSelect,
    selectRange,
    handleSelect,
    selectAll,
    deselectAll,
    toggleSelectAll,
    renameFile,
    deleteFile,
    deleteSelected,
    getSelectedForAttach,
    reset,
  }
}
