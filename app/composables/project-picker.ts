import { parseError } from 'evlog'
import type { Project } from '#shared/types/projects.d'

const PAGE_SIZE = 30
const SEARCH_DEBOUNCE_MS = 180

export function useProjectPicker() {
  const nuxtApp = useNuxtApp()

  const search = shallowRef<string>('')
  const pinned = shallowRef<Project[]>([])
  const projects = shallowRef<Project[]>([])
  const nextCursor = shallowRef<string | null>(null)
  const pageVersion = shallowRef<number>(0)
  const isLoadingInitial = shallowRef<boolean>(false)
  const isLoadingMore = shallowRef<boolean>(false)
  const isSearching = shallowRef<boolean>(false)

  let latestRequestId = 0
  let appliedSearch = ''

  const hasMore = computed(() => nextCursor.value !== null)

  function buildQuery(cursor?: string) {
    return {
      limit: PAGE_SIZE,
      sortBy: 'activity',
      ...(appliedSearch.length > 0 ? { search: appliedSearch } : {}),
      ...(cursor ? { cursor } : {}),
    }
  }

  function reset() {
    latestRequestId += 1
    appliedSearch = ''
    search.value = ''
    pinned.value = []
    projects.value = []
    nextCursor.value = null
    isLoadingInitial.value = false
    isLoadingMore.value = false
    isSearching.value = false
  }

  async function fetchFirstPage() {
    latestRequestId += 1

    const requestId = latestRequestId
    const hasItems = pinned.value.length > 0 || projects.value.length > 0

    appliedSearch = search.value.trim()
    nextCursor.value = null
    isLoadingMore.value = false
    isLoadingInitial.value = !hasItems
    isSearching.value = hasItems

    try {
      const response = await $fetch('/api/v1/projects', {
        query: buildQuery(),
      })

      if (requestId !== latestRequestId) {
        return
      }

      pinned.value = response.pinned
      projects.value = response.projects
      nextCursor.value = response.nextCursor
      pageVersion.value += 1
    } catch (exception) {
      if (requestId !== latestRequestId) {
        return
      }

      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to load projects',
          parsedException.why,
        )
      })
    } finally {
      if (requestId === latestRequestId) {
        isLoadingInitial.value = false
        isSearching.value = false
      }
    }
  }

  async function loadMore() {
    const cursor = nextCursor.value

    if (
      !cursor
      || isLoadingMore.value
      || isLoadingInitial.value
      || isSearching.value
    ) {
      return
    }

    const requestId = latestRequestId

    isLoadingMore.value = true

    try {
      const response = await $fetch('/api/v1/projects', {
        query: buildQuery(cursor),
      })

      if (requestId !== latestRequestId) {
        return
      }

      projects.value = [...projects.value, ...response.projects]
      nextCursor.value = response.nextCursor
      pageVersion.value += 1
    } catch (exception) {
      if (requestId !== latestRequestId) {
        return
      }

      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to load more projects',
          parsedException.why,
        )
      })
    } finally {
      if (requestId === latestRequestId) {
        isLoadingMore.value = false
      }
    }
  }

  function prependProject(project: Project) {
    projects.value = [project, ...projects.value]
  }

  const debouncedSearch = useDebounceFn(() => {
    if (search.value.trim() === appliedSearch) {
      return
    }

    fetchFirstPage()
  }, SEARCH_DEBOUNCE_MS)

  watch(search, () => {
    debouncedSearch()
  })

  return {
    search,
    pinned,
    projects,
    pageVersion,
    hasMore,
    isLoadingInitial,
    isLoadingMore,
    isSearching,
    reset,
    fetchFirstPage,
    loadMore,
    prependProject,
  }
}
