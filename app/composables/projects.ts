import { parseError } from 'evlog'
import type { Project, ProjectsResponse } from '#shared/types/projects.d'

interface ProjectsCacheEntry {
  projects: Project[]
  pinned: Project[]
  hasLoaded: boolean
  lastFetchedAt: number | null
}

export function useProjects() {
  const nuxtApp = useNuxtApp()
  const cache = useState<Record<string, ProjectsCacheEntry>>(
    'projects:cache',
    () => ({}),
  )

  const projects = useState<Project[]>('projects:list', () => [])
  const pinned = useState<Project[]>('projects:pinned', () => [])
  const search = useState<string>('projects:search', () => '')
  const sortBy = useState<'name' | 'activity'>('projects:sort', () => 'activity')
  const showArchived = useState<boolean>('projects:archived', () => false)

  const isLoading = shallowRef<boolean>(false)
  const isLoadingInitial = shallowRef<boolean>(false)
  const isSearching = shallowRef<boolean>(false)
  const isRefreshing = shallowRef<boolean>(false)
  const isCreating = shallowRef<boolean>(false)
  const queuedRefreshKey = shallowRef<string | null>(null)

  const activeKey = computed(() => {
    return [
      'projects',
      search.value.trim().toLowerCase(),
      sortBy.value,
      showArchived.value ? 'archived' : 'active',
    ].join(':')
  })

  const hasCachedData = computed(() => {
    return !!cache.value[activeKey.value]?.hasLoaded
  })

  function setEntry(cacheKey: string, entry: ProjectsCacheEntry) {
    cache.value = {
      ...cache.value,
      [cacheKey]: entry,
    }

    if (cacheKey === activeKey.value) {
      projects.value = entry.projects
      pinned.value = entry.pinned
    }
  }

  function prime(response: ProjectsResponse) {
    setEntry(activeKey.value, {
      projects: response.projects,
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

    projects.value = entry.projects
    pinned.value = entry.pinned

    return true
  }

  async function fetchProjects(options?: {
    background?: boolean
  }) {
    const { background = false } = options || {}
    const requestKey = activeKey.value
    let retryBackground: boolean | null = null

    if (isLoading.value) {
      queuedRefreshKey.value = requestKey

      return
    }

    isLoading.value = true

    if (background) {
      isRefreshing.value = true
    } else {
      isLoadingInitial.value = true
    }

    try {
      const requestSearch = search.value
      const requestSortBy = sortBy.value
      const requestShowArchived = showArchived.value

      const response = await $fetch('/api/v1/projects', {
        query: {
          ...(requestSearch.length >= 2 ? { search: requestSearch } : {}),
          sortBy: requestSortBy,
          ...(requestShowArchived ? { archived: 'true' } : {}),
        },
      })

      setEntry(requestKey, {
        projects: response.projects,
        pinned: response.pinned,
        hasLoaded: true,
        lastFetchedAt: Date.now(),
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to load projects',
          parsedException.why,
        )
      })
    } finally {
      isLoading.value = false
      isLoadingInitial.value = false
      isRefreshing.value = false

      const retryKey = queuedRefreshKey.value
      const shouldRetryQueuedRefresh = retryKey !== null
        && retryKey !== requestKey
        && retryKey === activeKey.value

      if (shouldRetryQueuedRefresh) {
        retryBackground = !!cache.value[retryKey]?.hasLoaded
        queuedRefreshKey.value = null
        isSearching.value = search.value.length >= 2
      } else {
        queuedRefreshKey.value = null
        isSearching.value = false
      }
    }

    if (retryBackground !== null) {
      await fetchProjects({ background: retryBackground })
    }
  }

  async function hydrateAndRefresh() {
    const hasCache = hydrateFromCache()

    if (!hasCache) {
      projects.value = []
      pinned.value = []
    }

    await fetchProjects({ background: hasCache })
  }

  function updateEntry(
    update: (entry: ProjectsCacheEntry) => ProjectsCacheEntry,
  ) {
    const currentEntry = cache.value[activeKey.value] || {
      projects: projects.value,
      pinned: pinned.value,
      hasLoaded: true,
      lastFetchedAt: Date.now(),
    }

    setEntry(activeKey.value, update(currentEntry))
  }

  function matchesActiveFilters(project: Project) {
    if (showArchived.value) {
      return project.archivedAt !== null
    }

    if (project.archivedAt !== null) {
      return false
    }

    const normalizedSearch = search.value.trim().toLowerCase()

    if (normalizedSearch.length < 2) {
      return true
    }

    return project.name.toLowerCase().includes(normalizedSearch)
  }

  function sortProjects(items: Project[]) {
    return [...items].sort((firstProject, secondProject) => {
      if (sortBy.value === 'name') {
        return firstProject.name.localeCompare(secondProject.name)
      }

      return secondProject.activityAt.localeCompare(firstProject.activityAt)
    })
  }

  function updateVisibleProjects(
    items: Project[],
    projectId: string,
    update: (project: Project) => Project,
  ) {
    return sortProjects(items.map((project) => {
      return project.id === projectId ? update(project) : project
    }).filter(matchesActiveFilters))
  }

  async function createProject(name: string) {
    isCreating.value = true

    try {
      const project = await $fetch('/api/v1/projects', {
        method: 'PUT',
        body: { name },
      })

      updateEntry((entry) => {
        if (!matchesActiveFilters(project)) {
          return entry
        }

        return {
          ...entry,
          projects: sortProjects([project, ...entry.projects]),
        }
      })

      nuxtApp.runWithContext(() => {
        useSuccessMessage('Project created')
      })

      return project
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to create project',
          parsedException.why,
        )
      })

      return null
    } finally {
      isCreating.value = false
    }
  }

  async function renameProject(projectId: string, name: string) {
    try {
      await $fetch(`/api/v1/projects/${projectId}/name`, {
        method: 'PATCH',
        body: { name },
      })

      updateEntry((entry) => {
        return {
          ...entry,
          projects: updateVisibleProjects(
            entry.projects,
            projectId,
            (project) => {
              return { ...project, name }
            },
          ),
          pinned: updateVisibleProjects(
            entry.pinned,
            projectId,
            (project) => {
              return { ...project, name }
            },
          ),
        }
      })

      nuxtApp.runWithContext(() => {
        useSuccessMessage('Project renamed')
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to rename project',
          parsedException.why,
        )
      })
    }
  }

  async function togglePin(projectId: string) {
    try {
      const result = await $fetch(`/api/v1/projects/${projectId}/pin`, {
        method: 'POST',
      })

      const newPinnedAt = result.pinnedAt
      const project = projects.value.find((candidate) => {
        return candidate.id === projectId
      })
      ?? pinned.value.find(candidate => candidate.id === projectId)

      if (!project) return

      updateEntry((entry) => {
        if (newPinnedAt) {
          return {
            ...entry,
            projects: entry.projects.filter((candidate) => {
              return candidate.id !== projectId
            }),
            pinned: sortProjects([
              { ...project, pinnedAt: newPinnedAt },
              ...entry.pinned.filter(candidate => candidate.id !== projectId),
            ]),
          }
        }

        return {
          ...entry,
          projects: sortProjects([
            { ...project, pinnedAt: null },
            ...entry.projects.filter(candidate => candidate.id !== projectId),
          ]),
          pinned: entry.pinned.filter(candidate => candidate.id !== projectId),
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

  async function toggleArchive(projectId: string) {
    try {
      const result = await $fetch(`/api/v1/projects/${projectId}/archive`, {
        method: 'POST',
      })

      const newArchivedAt = result.archivedAt

      updateEntry((entry) => {
        const removeProject = (items: Project[]) => {
          return items.filter(project => project.id !== projectId)
        }

        return {
          ...entry,
          projects: removeProject(entry.projects),
          pinned: removeProject(entry.pinned),
        }
      })

      nuxtApp.runWithContext(() => {
        useSuccessMessage(newArchivedAt ? 'Project archived' : 'Project restored')
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to archive project',
          parsedException.why,
        )
      })
    }
  }

  async function deleteProject(projectId: string) {
    try {
      await $fetch(`/api/v1/projects/${projectId}`, {
        method: 'DELETE',
      })

      updateEntry((entry) => {
        return {
          ...entry,
          projects: entry.projects.filter(project => project.id !== projectId),
          pinned: entry.pinned.filter(project => project.id !== projectId),
        }
      })

      nuxtApp.runWithContext(() => {
        useSuccessMessage('Project deleted')
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to delete project',
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
    projects,
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
    createProject,
    renameProject,
    togglePin,
    toggleArchive,
    deleteProject,
  }
}
