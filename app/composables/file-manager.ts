import { parseError } from 'evlog'
import type { FileManagerFile, ViewMode } from '~/types/file-manager'

interface FetchFilesResponse {
  files: FileManagerFile[]
  total: number
  offset: number
  limit: number
}

export function useFileManager() {
  const files = ref<FileManagerFile[]>([])
  const selectedIds = ref<Set<string>>(new Set())
  const lastSelectedIndex = shallowRef<number | null>(null)
  const isLoading = shallowRef<boolean>(false)
  const isSearching = shallowRef<boolean>(false)
  const isDeletingSelected = shallowRef<boolean>(false)
  const searchLoadingTimeout = ref<ReturnType<typeof setTimeout> | null>(null)
  const search = shallowRef<string>('')
  const viewMode = useLocalStorage<ViewMode>('file-manager-view-mode', 'grid')
  const pagination = reactive({
    offset: 0,
    limit: 20,
    total: 0,
  })

  const hasMore = computed(() => {
    return files.value.length < pagination.total
  })

  const selectedCount = computed(() => selectedIds.value.size)

  const selectedFiles = computed(() => {
    return files.value.filter(file => selectedIds.value.has(file.id))
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
    isSearching.value = false
  }

  async function fetchFiles(reset = false, isSearch = false) {
    let isSuccess = false

    if (reset) {
      pagination.offset = 0
      files.value = []
      selectedIds.value.clear()
    }

    isLoading.value = true

    if (isSearch) {
      clearSearchTimeout()
      searchLoadingTimeout.value = setTimeout(() => {
        isSearching.value = true
      }, 300)
    }

    try {
      const response = await $fetch<FetchFilesResponse>('/api/v1/files', {
        query: {
          offset: pagination.offset,
          limit: pagination.limit,
          ...(search.value && { search: search.value }),
        },
      })

      if (reset) {
        files.value = response.files
      } else {
        files.value.push(...response.files)
      }

      pagination.total = response.total
      isSuccess = true
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to load files',
        parsedException.why,
      )
    } finally {
      isLoading.value = false
      clearSearchTimeout()
    }

    return isSuccess
  }

  async function loadMore() {
    if (!hasMore.value || isLoading.value) return

    const previousOffset = pagination.offset

    pagination.offset += pagination.limit
    const isSuccess = await fetchFiles(false)

    if (!isSuccess) {
      pagination.offset = previousOffset
    }
  }

  async function syncLoadedFiles() {
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
          ...(search.value && { search: search.value }),
        },
      })

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

    files.value = syncedFiles
    pagination.total = syncedTotal

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
  }

  function toggleSelect(id: string, index?: number) {
    if (selectedIds.value.has(id)) {
      selectedIds.value.delete(id)
    } else {
      selectedIds.value.add(id)
    }

    if (index !== undefined) {
      lastSelectedIndex.value = index
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

    selectedIds.value = new Set(selectedIds.value)
  }

  function handleSelect(id: string, index: number, shiftKey: boolean) {
    if (shiftKey && lastSelectedIndex.value !== null && hasSelection.value) {
      selectRange(lastSelectedIndex.value, index)
    } else {
      toggleSelect(id, index)
    }
  }

  function selectAll() {
    selectedIds.value = new Set(files.value.map(file => file.id))
  }

  function deselectAll() {
    selectedIds.value.clear()
    selectedIds.value = new Set()
    lastSelectedIndex.value = null
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

  async function deleteFile(id: string) {
    try {
      await $fetch(`/api/v1/files/${id}`, {
        method: 'DELETE',
      })

      const index = files.value.findIndex(f => f.id === id)
      if (index !== -1) {
        files.value.splice(index, 1)
        pagination.total--
      }

      selectedIds.value.delete(id)
      selectedIds.value = new Set(selectedIds.value)

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
    isDeletingSelected.value = true

    try {
      await $fetch('/api/v1/files/delete/bulk', {
        method: 'POST',
        body: { ids },
      })

      files.value = files.value.filter(file => !selectedIds.value.has(file.id))
      pagination.total = Math.max(0, pagination.total - ids.length)

      selectedIds.value.clear()
      selectedIds.value = new Set()

      useSuccessMessage(`${ids.length} file(s) deleted successfully`)

      return true
    } catch (exception) {
      const parsedException = parseError(exception)

      if (parsedException.status === 409) {
        try {
          await syncLoadedFiles()
        } catch (_exception) {
          void _exception
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
    clearSearchTimeout()
    files.value = []
    selectedIds.value.clear()
    selectedIds.value = new Set()
    lastSelectedIndex.value = null
    search.value = ''
    pagination.offset = 0
    pagination.total = 0
  }

  const debouncedSearch = useDebounceFn(() => {
    fetchFiles(true, true)
  }, 300)

  watch(search, () => {
    debouncedSearch()
  })

  return {
    files,
    selectedIds,
    lastSelectedIndex,
    isLoading,
    isSearching,
    search,
    viewMode,
    pagination,

    hasMore,
    selectedCount,
    selectedFiles,
    hasSelection,
    allSelected,

    fetchFiles,
    loadMore,
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
