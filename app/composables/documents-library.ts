import type { Ref } from 'vue'
import { parseError } from 'evlog'
import {
  DOCUMENT_FORMATS,
  DOCUMENT_FORMAT_LIBRARY_LABELS,
  DOCUMENT_LIBRARY_SOURCES,
  DOCUMENT_SOURCE_LIBRARY_LABELS,
  getDocumentDisplayTitle,
} from '#shared/utils/documents'
import type {
  DocumentFormat,
  DocumentFormatCounts,
  DocumentLibraryItem,
  DocumentLibrarySource,
  DocumentSourceCounts,
} from '#shared/utils/documents'

export type DocumentFormatFilter = DocumentFormat | 'all'
export type DocumentSourceFilter = DocumentLibrarySource | 'all'

export interface DocumentFilterOption<Value extends string> {
  value: Value | 'all'
  label: string
  count: number
}

export const DOCUMENT_LIBRARY_PAGE_SIZE = 20
export const DOCUMENT_LIBRARY_SEARCH_DEBOUNCE_MS = 300
export const DOCUMENT_LIBRARY_SKELETON_DELAY_MS = 300
export const DOCUMENT_LIBRARY_SKELETON_ROWS = 6
export const DOCUMENT_LIBRARY_PATH = '/chats/documents'
export const DOCUMENT_FILTER_MIN_OPTIONS = 2

function buildFilterOptions<Value extends string>(
  values: readonly Value[],
  labels: Record<Value, string>,
  counts: Record<Value, number> | null,
): Array<DocumentFilterOption<Value>> {
  if (!counts) {
    return []
  }

  const available = values.filter(value => counts[value] > 0)

  if (available.length < DOCUMENT_FILTER_MIN_OPTIONS) {
    return []
  }

  const total = available.reduce((sum, value) => sum + counts[value], 0)

  return [
    { value: 'all', label: 'All', count: total },
    ...available.map((value) => {
      return { value, label: labels[value], count: counts[value] }
    }),
  ]
}

/**
 * The format chips: only formats the user has, each with its count, preceded
 * by All. Empty when fewer than two formats exist, because All and the single
 * format would show the same list.
 */
export function buildDocumentFormatOptions(
  counts: DocumentFormatCounts | null,
): Array<DocumentFilterOption<DocumentFormat>> {
  return buildFilterOptions(
    DOCUMENT_FORMATS,
    DOCUMENT_FORMAT_LIBRARY_LABELS,
    counts,
  )
}

export function buildDocumentSourceOptions(
  counts: DocumentSourceCounts | null,
): Array<DocumentFilterOption<DocumentLibrarySource>> {
  return buildFilterOptions(
    DOCUMENT_LIBRARY_SOURCES,
    DOCUMENT_SOURCE_LIBRARY_LABELS,
    counts,
  )
}

export function resolveDocumentFilter<Value extends string>(
  value: Value | 'all',
  counts: Record<Value, number> | null,
): Value | 'all' {
  if (value === 'all' || !counts) {
    return value
  }

  return counts[value] > 0 ? value : 'all'
}

export function parseDocumentFormatFilter(
  value: unknown,
): DocumentFormatFilter {
  return typeof value === 'string'
    && (DOCUMENT_FORMATS as readonly string[]).includes(value)
    ? value as DocumentFormat
    : 'all'
}

export function parseDocumentSourceFilter(
  value: unknown,
): DocumentSourceFilter {
  return typeof value === 'string'
    && (DOCUMENT_LIBRARY_SOURCES as readonly string[]).includes(value)
    ? value as DocumentLibrarySource
    : 'all'
}

/**
 * Search text, format and source filters of the documents library. The URL
 * query is the source of truth (`?query=...&format=...&source=...`), so a
 * filter change is a history entry and Back restores the previous filters.
 */
export function useDocumentLibraryFilters() {
  const route = useRoute()
  const router = useRouter()

  const appliedQuery = computed<string>(() => {
    return toArtifactSearchTerm(parseArtifactSearch(route.query.query))
  })
  const appliedFormat = computed<DocumentFormatFilter>(() => {
    return parseDocumentFormatFilter(route.query.format)
  })
  const appliedSource = computed<DocumentSourceFilter>(() => {
    return parseDocumentSourceFilter(route.query.source)
  })

  const search = shallowRef<string>(parseArtifactSearch(route.query.query))

  let isCommitting = false

  async function commitQuery(
    changes: Record<string, string | undefined>,
    options: { replace?: boolean } = {},
  ) {
    const query = Object.fromEntries(
      Object.entries({ ...route.query, ...changes }).filter(([, value]) => {
        return value !== undefined
      }),
    )

    isCommitting = true

    try {
      if (options.replace) {
        await router.replace({ path: route.path, query })
      } else {
        await router.push({ path: route.path, query })
      }
    } finally {
      isCommitting = false
    }
  }

  const commitSearch = useDebounceFn(async () => {
    const term = toArtifactSearchTerm(search.value)

    if (term === appliedQuery.value) {
      return
    }

    await commitQuery({ query: term || undefined })
  }, DOCUMENT_LIBRARY_SEARCH_DEBOUNCE_MS)

  async function setFormat(
    format: DocumentFormatFilter,
    options: { replace?: boolean } = {},
  ) {
    if (format === appliedFormat.value) {
      return
    }

    await commitQuery({ format: format === 'all' ? undefined : format }, options)
  }

  async function setSource(
    source: DocumentSourceFilter,
    options: { replace?: boolean } = {},
  ) {
    if (source === appliedSource.value) {
      return
    }

    await commitQuery({ source: source === 'all' ? undefined : source }, options)
  }

  async function clearFilters() {
    search.value = ''

    await commitQuery({
      query: undefined,
      format: undefined,
      source: undefined,
    })
  }

  watch(search, () => {
    commitSearch()
  })

  watch(() => route.query.query, (value) => {
    if (isCommitting) {
      return
    }

    const fromUrl = parseArtifactSearch(value)

    if (toArtifactSearchTerm(search.value) !== toArtifactSearchTerm(fromUrl)) {
      search.value = fromUrl
    }
  })

  return {
    search,
    appliedQuery,
    appliedFormat,
    appliedSource,
    setFormat,
    setSource,
    clearFilters,
  }
}

export function toDocumentFileName(
  name: string,
  format: DocumentFormat,
): string {
  const trimmed = name.trim()

  return trimmed.toLowerCase().endsWith(`.${format}`)
    ? trimmed
    : `${trimmed}.${format}`
}

/**
 * The owner's document list: first page through `useLazyFetch`, further pages
 * appended with `$fetch`, local removal and rename patches so the list keeps
 * its depth, and the counts for the filter chips.
 */
export function useDocumentLibrary(filters: {
  query: Ref<string>
  format: Ref<DocumentFormatFilter>
  source: Ref<DocumentSourceFilter>
}) {
  const nuxtApp = useNuxtApp()

  const requestQuery = computed(() => {
    return {
      limit: DOCUMENT_LIBRARY_PAGE_SIZE,
      ...(filters.query.value ? { query: filters.query.value } : {}),
      ...(filters.format.value !== 'all'
        ? { format: filters.format.value }
        : {}),
      ...(filters.source.value !== 'all'
        ? { source: filters.source.value }
        : {}),
    }
  })

  const { data, status, error, refresh } = useLazyFetch('/api/v1/documents', {
    query: requestQuery,
  })

  const extraItems = shallowRef<DocumentLibraryItem[]>([])
  const removedIds = shallowRef<Set<string>>(new Set())
  const patches = shallowRef<Record<string, Partial<DocumentLibraryItem>>>({})
  const loadedTotal = shallowRef<number | null>(null)
  const removedAtLoadedTotal = shallowRef<number>(0)
  const loadedFormatCounts = shallowRef<DocumentFormatCounts | null>(null)
  const loadedSourceCounts = shallowRef<DocumentSourceCounts | null>(null)
  const isLoadingMore = shallowRef<boolean>(false)
  const isMutating = shallowRef<boolean>(false)
  const isSkeletonDelayElapsed = shallowRef<boolean>(false)

  let skeletonTimer: ReturnType<typeof setTimeout> | null = null
  let generation = 0

  const isPending = computed<boolean>(() => {
    return status.value === 'pending'
  })

  const hasLoaded = computed<boolean>(() => !!data.value)

  const isRefreshing = computed<boolean>(() => {
    return isPending.value && !!data.value
  })

  const isInitialLoad = computed<boolean>(() => {
    return isPending.value && !data.value
  })

  const items = computed<DocumentLibraryItem[]>(() => {
    const seen = new Set<string>()
    const merged: DocumentLibraryItem[] = []

    for (const item of [...(data.value?.items ?? []), ...extraItems.value]) {
      if (seen.has(item.id) || removedIds.value.has(item.id)) {
        continue
      }

      seen.add(item.id)
      merged.push(patches.value[item.id]
        ? { ...item, ...patches.value[item.id] }
        : item)
    }

    return merged
  })

  const total = computed<number>(() => {
    const knownTotal = loadedTotal.value ?? data.value?.total ?? 0

    const removedSinceKnown = loadedTotal.value === null
      ? removedIds.value.size
      : removedIds.value.size - removedAtLoadedTotal.value

    return Math.max(knownTotal - removedSinceKnown, 0)
  })

  const formatCounts = computed<DocumentFormatCounts | null>(() => {
    return loadedFormatCounts.value ?? data.value?.formatCounts ?? null
  })

  const sourceCounts = computed<DocumentSourceCounts | null>(() => {
    return loadedSourceCounts.value ?? data.value?.sourceCounts ?? null
  })

  const hasMore = computed<boolean>(() => {
    return items.value.length < total.value
  })

  const isSkeletonVisible = computed<boolean>(() => {
    return isInitialLoad.value && isSkeletonDelayElapsed.value
  })

  const hasError = computed<boolean>(() => {
    return !!error.value && !data.value
  })

  const errorMessage = computed<string>(() => {
    return error.value
      ? parseError(error.value).message || 'Please try again.'
      : ''
  })

  function clearSkeletonTimer() {
    if (skeletonTimer) {
      clearTimeout(skeletonTimer)
      skeletonTimer = null
    }
  }

  watch(isPending, (pending) => {
    clearSkeletonTimer()

    if (!pending) {
      isSkeletonDelayElapsed.value = false

      return
    }

    skeletonTimer = setTimeout(() => {
      isSkeletonDelayElapsed.value = true
    }, DOCUMENT_LIBRARY_SKELETON_DELAY_MS)
  }, { immediate: true })

  watch(data, () => {
    generation++
    extraItems.value = []
    removedIds.value = new Set()
    patches.value = {}
    loadedTotal.value = null
    removedAtLoadedTotal.value = 0
    loadedFormatCounts.value = null
    loadedSourceCounts.value = null
  })

  onScopeDispose(clearSkeletonTimer)

  function applyServerTotals(response: {
    total: number
    formatCounts: DocumentFormatCounts
    sourceCounts: DocumentSourceCounts
  }) {
    loadedTotal.value = response.total
    removedAtLoadedTotal.value = removedIds.value.size
    loadedFormatCounts.value = response.formatCounts
    loadedSourceCounts.value = response.sourceCounts
  }

  async function loadMore() {
    if (isLoadingMore.value || isMutating.value || !hasMore.value) {
      return
    }

    const requestGeneration = generation
    const offset = items.value.length

    isLoadingMore.value = true

    try {
      const response = await $fetch('/api/v1/documents', {
        query: { ...requestQuery.value, offset },
      })

      if (requestGeneration !== generation) {
        return
      }

      extraItems.value = [...extraItems.value, ...response.items]
      applyServerTotals(response)
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to load more documents',
          parsedException.why,
        )
      })
    } finally {
      isLoadingMore.value = false
    }
  }

  async function refreshTotals() {
    const requestGeneration = generation

    try {
      const response = await $fetch('/api/v1/documents', {
        query: { ...requestQuery.value, limit: 1 },
      })

      if (requestGeneration !== generation) {
        return
      }

      applyServerTotals(response)
    } catch {
      return
    }
  }

  function removeLocally(ids: string[]) {
    removedIds.value = new Set([...removedIds.value, ...ids])
  }

  async function deleteDocument(
    item: DocumentLibraryItem,
  ): Promise<boolean> {
    if (isMutating.value) {
      return false
    }

    isMutating.value = true
    generation++

    try {
      await $fetch(`/api/v1/files/${encodeURIComponent(item.fileId)}`, {
        method: 'DELETE',
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to delete the document',
          parsedException.why,
        )
      })

      return false
    } finally {
      isMutating.value = false
    }

    removeLocally([item.id])
    await nuxtApp.callHook('files:deleted', [item.fileId])
    await refreshTotals()

    if (!items.value.length && hasMore.value) {
      await loadMore()
    }

    return true
  }

  async function renameDocument(
    item: DocumentLibraryItem,
    name: string,
  ): Promise<boolean> {
    const fileName = toDocumentFileName(name, item.format)

    try {
      await $fetch(`/api/v1/files/${encodeURIComponent(item.fileId)}/name`, {
        method: 'PATCH',
        body: { name: fileName },
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to rename the document',
          parsedException.why,
        )
      })

      return false
    }

    patches.value = {
      ...patches.value,
      [item.id]: {
        fileName,
        title: getDocumentDisplayTitle(fileName, item.format),
      },
    }

    return true
  }

  return {
    items,
    total,
    formatCounts,
    sourceCounts,
    hasMore,
    hasError,
    hasLoaded,
    errorMessage,
    isInitialLoad,
    isRefreshing,
    isSkeletonVisible,
    isLoadingMore,
    isMutating,
    refresh,
    loadMore,
    deleteDocument,
    renameDocument,
  }
}
