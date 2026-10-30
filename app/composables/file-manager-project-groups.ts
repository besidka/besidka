import type { Ref } from 'vue'
import { parseError } from 'evlog'
import type {
  FetchFilesResponse,
  FileManagerFile,
  ProjectFileGroup,
} from '~/types/file-manager'

interface ProjectGroupsOptions {
  search: Readonly<Ref<string>>
}

interface ProjectGroupRequestContext {
  listGeneration: number
  groupGeneration: number
}

const PROJECT_GROUP_PAGE_SIZE = 20
const PROJECT_GROUP_FETCH_CONCURRENCY = 4
const SEARCH_INDICATOR_DELAY = 300

export function useFileManagerProjectGroups(options: ProjectGroupsOptions) {
  const groups = ref<ProjectFileGroup[]>([])
  const isLoading = shallowRef<boolean>(false)
  const isSearching = shallowRef<boolean>(false)
  const searchLoadingTimeout = shallowRef<
    ReturnType<typeof setTimeout> | null
  >(null)
  const groupGenerations = new Map<string, number>()
  let listGeneration = 0
  let appliedSearch = ''

  const loadedFiles = computed<FileManagerFile[]>(() => {
    const uniqueFiles = new Map<string, FileManagerFile>()

    for (const group of groups.value) {
      for (const file of group.files) {
        if (!uniqueFiles.has(file.id)) {
          uniqueFiles.set(file.id, file)
        }
      }
    }

    return Array.from(uniqueFiles.values())
  })

  function clearSearchTimeout() {
    if (searchLoadingTimeout.value) {
      clearTimeout(searchLoadingTimeout.value)
      searchLoadingTimeout.value = null
    }

    isSearching.value = false
  }

  function findGroup(groupId: string): ProjectFileGroup | undefined {
    return groups.value.find(group => group.id === groupId)
  }

  function invalidate() {
    listGeneration++
    isLoading.value = false
    clearSearchTimeout()

    for (const group of groups.value) {
      group.isLoading = false
    }
  }

  function clear() {
    invalidate()
    groups.value = []
    groupGenerations.clear()
  }

  function createGroupRequestContext(
    groupId: string,
    isRefresh: boolean,
  ): ProjectGroupRequestContext {
    const currentGeneration = groupGenerations.get(groupId) ?? 0
    const groupGeneration = isRefresh
      ? currentGeneration + 1
      : currentGeneration

    groupGenerations.set(groupId, groupGeneration)

    return {
      listGeneration,
      groupGeneration,
    }
  }

  function isCurrentGroupRequest(
    groupId: string,
    context: ProjectGroupRequestContext,
  ): boolean {
    return context.listGeneration === listGeneration
      && context.groupGeneration === (groupGenerations.get(groupId) ?? 0)
  }

  function removeGroup(groupId: string) {
    groups.value = groups.value.filter(group => group.id !== groupId)
    groupGenerations.delete(groupId)
  }

  async function fetchGroupFiles(
    groupId: string,
    reset: boolean,
  ): Promise<boolean> {
    const group = findGroup(groupId)

    if (!group) {
      return false
    }

    const context = createGroupRequestContext(groupId, reset)
    const requestOffset = reset ? 0 : group.serverOffset
    let isSuccess = false

    group.isLoading = true

    try {
      const response = await $fetch<FetchFilesResponse>('/api/v1/files', {
        query: {
          source: 'project',
          projectId: groupId,
          offset: requestOffset,
          limit: PROJECT_GROUP_PAGE_SIZE,
          ...(appliedSearch && {
            search: appliedSearch,
          }),
        },
      })

      if (!isCurrentGroupRequest(groupId, context)) {
        return false
      }

      const currentGroup = findGroup(groupId)

      if (!currentGroup) {
        return false
      }

      if (reset) {
        currentGroup.files = response.files
        currentGroup.serverOffset = response.files.length
      } else {
        currentGroup.files.push(...response.files)
        currentGroup.serverOffset += response.files.length
      }

      currentGroup.total = response.total
      currentGroup.fileCount = response.total
      currentGroup.hasLoaded = true
      isSuccess = true

      if (response.total === 0) {
        removeGroup(groupId)
      }
    } catch (exception) {
      if (!isCurrentGroupRequest(groupId, context)) {
        return false
      }

      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to load project files',
        parsedException.why,
      )
    } finally {
      if (isCurrentGroupRequest(groupId, context)) {
        const settledGroup = findGroup(groupId)

        if (settledGroup) {
          settledGroup.isLoading = false
        }
      }
    }

    return isSuccess
  }

  async function loadGroupPages(groupIds: string[], generation: number) {
    const queue = [...groupIds]
    const workers = Array.from({
      length: Math.min(PROJECT_GROUP_FETCH_CONCURRENCY, queue.length),
    }, async () => {
      while (queue.length > 0 && generation === listGeneration) {
        const groupId = queue.shift()

        if (groupId === undefined) {
          return
        }

        await fetchGroupFiles(groupId, true)
      }
    })

    await Promise.all(workers)
  }

  async function fetchGroups(
    preserveOpen = false,
    isSearch = false,
  ): Promise<boolean> {
    const generation = ++listGeneration
    const search = options.search.value
    const previousOpenIds = new Set(
      groups.value.filter(group => group.isOpen).map(group => group.id),
    )
    let openGroupIds: string[] = []
    let isSuccess = false

    appliedSearch = search
    isLoading.value = true
    clearSearchTimeout()

    if (isSearch) {
      searchLoadingTimeout.value = setTimeout(() => {
        if (generation !== listGeneration) {
          return
        }

        isSearching.value = true
      }, SEARCH_INDICATOR_DELAY)
    }

    try {
      const response = await $fetch('/api/v1/files/projects', {
        query: {
          ...(search && { search }),
        },
      })

      if (generation !== listGeneration) {
        return false
      }

      const hasPreservedOpenGroup = preserveOpen
        && response.projects.some(project => previousOpenIds.has(project.id))

      groupGenerations.clear()
      groups.value = response.projects.map((project, index) => {
        let isOpen = index === 0

        if (search) {
          isOpen = true
        } else if (hasPreservedOpenGroup) {
          isOpen = previousOpenIds.has(project.id)
        }

        return {
          id: project.id,
          name: project.name,
          fileCount: project.fileCount,
          pinned: project.pinned,
          archived: project.archived,
          files: [],
          total: project.fileCount,
          serverOffset: 0,
          isLoading: isOpen,
          isOpen,
          hasLoaded: false,
        }
      })
      openGroupIds = groups.value
        .filter(group => group.isOpen)
        .map(group => group.id)
      isSuccess = true
    } catch (exception) {
      if (generation !== listGeneration) {
        return false
      }

      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to load projects',
        parsedException.why,
      )
    } finally {
      if (generation === listGeneration) {
        isLoading.value = false
        clearSearchTimeout()
      }
    }

    if (!isSuccess) {
      return false
    }

    await loadGroupPages(openGroupIds, generation)

    return generation === listGeneration
  }

  async function toggleGroup(groupId: string) {
    const group = findGroup(groupId)

    if (!group) {
      return
    }

    group.isOpen = !group.isOpen

    if (group.isOpen && !group.hasLoaded && !group.isLoading) {
      await fetchGroupFiles(groupId, true)
    }
  }

  async function loadMoreGroup(groupId: string): Promise<boolean> {
    const group = findGroup(groupId)

    if (!group || group.isLoading) {
      return false
    }

    if (!group.hasLoaded) {
      return fetchGroupFiles(groupId, true)
    }

    if (group.serverOffset >= group.total) {
      return false
    }

    return fetchGroupFiles(groupId, false)
  }

  function renameFile(fileId: string, name: string) {
    for (const group of groups.value) {
      for (const file of group.files) {
        if (file.id === fileId) {
          file.name = name
        }
      }
    }
  }

  function removeFiles(fileIds: string[]) {
    const removedIds = new Set(fileIds)
    const emptiedGroupIds: string[] = []

    for (const group of groups.value) {
      const previousFileCount = group.files.length

      group.files = group.files.filter(file => !removedIds.has(file.id))

      const removedFileCount = previousFileCount - group.files.length

      if (removedFileCount === 0) {
        continue
      }

      group.total = Math.max(0, group.total - removedFileCount)
      group.fileCount = group.total
      group.serverOffset = Math.max(0, group.serverOffset - removedFileCount)

      if (group.total === 0) {
        emptiedGroupIds.push(group.id)
      }
    }

    for (const groupId of emptiedGroupIds) {
      removeGroup(groupId)
    }
  }

  return {
    groups,
    isLoading,
    isSearching,
    loadedFiles,

    findGroup,
    fetchGroups,
    toggleGroup,
    loadMoreGroup,
    renameFile,
    removeFiles,
    invalidate,
    clear,
  }
}
