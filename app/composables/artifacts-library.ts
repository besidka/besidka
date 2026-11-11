import type { Ref } from 'vue'
import { parseError } from 'evlog'
import type { ArtifactKind, ArtifactSummary } from '#shared/utils/artifacts'
import {
  ARTIFACT_BULK_DELETE_MAX,
  ARTIFACT_KINDS,
  ARTIFACT_USER_QUOTA_BYTES,
} from '#shared/utils/artifacts'
import { formatFileSize } from '#shared/utils/files'
import { MIN_SEARCH_LENGTH } from '#shared/utils/search'

export type ArtifactKindFilter = ArtifactKind | 'all'

export interface ArtifactDeleteResult {
  deletedIds: string[]
  heldIds: string[]
}

export const ARTIFACT_LIBRARY_PAGE_SIZE = 20
export const ARTIFACT_LIBRARY_SEARCH_DEBOUNCE_MS = 300
export const ARTIFACT_LIBRARY_SKELETON_DELAY_MS = 300
export const ARTIFACT_LIBRARY_SKELETON_ROWS = 6
export const ARTIFACT_LIBRARY_PATH = '/chats/artifacts'

export const ARTIFACT_LIBRARY_KIND_FILTERS: Array<{
  value: ArtifactKindFilter
  label: string
}> = [
  { value: 'all', label: 'All' },
  { value: 'html', label: 'HTML' },
  { value: 'react', label: 'React' },
  { value: 'svg', label: 'SVG' },
  { value: 'mermaid', label: 'Mermaid' },
  { value: 'markdown', label: 'Markdown' },
]

export function parseArtifactKindFilter(value: unknown): ArtifactKindFilter {
  return typeof value === 'string'
    && (ARTIFACT_KINDS as readonly string[]).includes(value)
    ? value as ArtifactKind
    : 'all'
}

export function parseArtifactSearch(value: unknown): string {
  const text = Array.isArray(value) ? value[0] : value

  return typeof text === 'string' ? text.trim() : ''
}

export function toArtifactSearchTerm(value: string): string {
  const trimmed = value.trim()

  return trimmed.length >= MIN_SEARCH_LENGTH ? trimmed : ''
}

export function formatArtifactUsage(usedBytes: number): string {
  return `Using ${formatFileSize(usedBytes)} of `
    + formatFileSize(ARTIFACT_USER_QUOTA_BYTES)
}

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = []

  for (let start = 0; start < ids.length; start += ARTIFACT_BULK_DELETE_MAX) {
    chunks.push(ids.slice(start, start + ARTIFACT_BULK_DELETE_MAX))
  }

  return chunks
}

/**
 * Search text and kind filter of the artifacts library. The URL query is the
 * source of truth (`?query=...&kind=...`), so a filter change is a history
 * entry and Back restores the previous filters.
 */
export function useArtifactLibraryFilters() {
  const route = useRoute()
  const router = useRouter()

  const appliedQuery = computed<string>(() => {
    return toArtifactSearchTerm(parseArtifactSearch(route.query.query))
  })
  const appliedKind = computed<ArtifactKindFilter>(() => {
    return parseArtifactKindFilter(route.query.kind)
  })

  const search = shallowRef<string>(parseArtifactSearch(route.query.query))

  let isCommitting = false

  async function commitQuery(changes: Record<string, string | undefined>) {
    const query = Object.fromEntries(
      Object.entries({ ...route.query, ...changes }).filter(([, value]) => {
        return value !== undefined
      }),
    )

    isCommitting = true

    try {
      await router.push({ path: route.path, query })
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
  }, ARTIFACT_LIBRARY_SEARCH_DEBOUNCE_MS)

  async function setKind(kind: ArtifactKindFilter) {
    if (kind === appliedKind.value) {
      return
    }

    await commitQuery({ kind: kind === 'all' ? undefined : kind })
  }

  async function clearFilters() {
    search.value = ''

    await commitQuery({ query: undefined, kind: undefined })
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
    appliedKind,
    setKind,
    clearFilters,
  }
}

/**
 * Search text and kind filter of the artifact picker. Unlike the library
 * these live in memory only: the picker is a dialog, so no URL changes.
 */
export function useArtifactPickerFilters() {
  const search = shallowRef<string>('')
  const appliedQuery = shallowRef<string>('')
  const appliedKind = shallowRef<ArtifactKindFilter>('all')

  const commitSearch = useDebounceFn(() => {
    appliedQuery.value = toArtifactSearchTerm(search.value)
  }, ARTIFACT_LIBRARY_SEARCH_DEBOUNCE_MS)

  watch(search, () => {
    commitSearch()
  })

  function setKind(kind: ArtifactKindFilter) {
    appliedKind.value = kind
  }

  function reset() {
    search.value = ''
    appliedQuery.value = ''
    appliedKind.value = 'all'
  }

  return { search, appliedQuery, appliedKind, setKind, reset }
}

/**
 * The owner's artifact list: first page through `useLazyFetch`, further
 * pages appended with `$fetch`, local removal after a delete (so the list
 * keeps its depth), selection for the bulk toolbar and the quota figure.
 */
export function useArtifactLibrary(filters: {
  query: Ref<string>
  kind: Ref<ArtifactKindFilter>
}, options: { key?: string } = {}) {
  const nuxtApp = useNuxtApp()
  const panel = useArtifactPanel()

  const requestQuery = computed(() => {
    return {
      limit: ARTIFACT_LIBRARY_PAGE_SIZE,
      ...(filters.query.value ? { query: filters.query.value } : {}),
      ...(filters.kind.value !== 'all' ? { kind: filters.kind.value } : {}),
    }
  })

  const { data, status, error, refresh } = useLazyFetch('/api/v1/artifacts', {
    query: requestQuery,
    ...(options.key ? { key: options.key } : {}),
  })

  const extraItems = shallowRef<ArtifactSummary[]>([])
  const removedIds = shallowRef<Set<string>>(new Set())
  const patches = shallowRef<Record<string, Partial<ArtifactSummary>>>({})
  const loadedTotal = shallowRef<number | null>(null)
  const removedAtLoadedTotal = shallowRef<number>(0)
  const loadedUsedBytes = shallowRef<number | null>(null)
  const isLoadingMore = shallowRef<boolean>(false)
  const isDeleting = shallowRef<boolean>(false)
  const isSkeletonDelayElapsed = shallowRef<boolean>(false)
  const selectedIds = ref<Set<string>>(new Set())
  const isSelectionMode = shallowRef<boolean>(false)
  const lastSelectedIndex = shallowRef<number | null>(null)

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

  const items = computed<ArtifactSummary[]>(() => {
    const seen = new Set<string>()
    const merged: ArtifactSummary[] = []

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

  const usedBytes = computed<number>(() => {
    return loadedUsedBytes.value ?? data.value?.usedBytes ?? 0
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

  const selectedCount = computed<number>(() => selectedIds.value.size)

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
    }, ARTIFACT_LIBRARY_SKELETON_DELAY_MS)
  }, { immediate: true })

  watch(data, () => {
    generation++
    extraItems.value = []
    removedIds.value = new Set()
    patches.value = {}
    loadedTotal.value = null
    removedAtLoadedTotal.value = 0
    loadedUsedBytes.value = null
  })

  watch(
    () => [filters.query.value, filters.kind.value],
    () => {
      deselectAll()
    },
  )

  onScopeDispose(clearSkeletonTimer)

  const removeDeletedHook = nuxtApp.hook('artifacts:deleted', async (ids) => {
    removeLocally(ids)
    await refreshTotals()
  })

  onScopeDispose(removeDeletedHook)

  async function loadMore() {
    if (isLoadingMore.value || isDeleting.value || !hasMore.value) {
      return
    }

    const requestGeneration = generation
    const offset = items.value.length

    isLoadingMore.value = true

    try {
      const response = await $fetch('/api/v1/artifacts', {
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
          parsedException.message || 'Failed to load more artifacts',
          parsedException.why,
        )
      })
    } finally {
      isLoadingMore.value = false
    }
  }

  function applyServerTotals(response: { total: number, usedBytes: number }) {
    loadedTotal.value = response.total
    removedAtLoadedTotal.value = removedIds.value.size
    loadedUsedBytes.value = response.usedBytes
  }

  async function refreshTotals() {
    const requestGeneration = generation

    try {
      const response = await $fetch('/api/v1/artifacts', {
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

  async function refreshItem(artifactId: string) {
    try {
      const detail = await $fetch(
        `/api/v1/artifacts/${encodeURIComponent(artifactId)}`,
      )

      patches.value = {
        ...patches.value,
        [artifactId]: {
          title: detail.title,
          currentVersion: detail.currentVersion,
          versionCount: detail.versionCount,
          updatedAt: detail.updatedAt,
          activeShareCount: detail.activeShareCount,
          takenDown: detail.takenDown,
        },
      }
    } catch {
      return
    }
  }

  function removeLocally(ids: string[]) {
    removedIds.value = new Set([...removedIds.value, ...ids])
    selectedIds.value = new Set(
      [...selectedIds.value].filter((id) => {
        return !ids.includes(id)
      }),
    )

    lastSelectedIndex.value = null

    if (selectedIds.value.size === 0) {
      isSelectionMode.value = false
    }
  }

  async function deleteArtifacts(ids: string[]): Promise<ArtifactDeleteResult> {
    const result: ArtifactDeleteResult = { deletedIds: [], heldIds: [] }

    if (!ids.length || isDeleting.value) {
      return result
    }

    isDeleting.value = true
    generation++

    try {
      for (const chunk of chunkIds(ids)) {
        const response = await $fetch('/api/v1/artifacts/delete/bulk', {
          method: 'POST',
          body: { ids: chunk },
        })

        result.deletedIds.push(...response.deletedIds)
        result.heldIds.push(...response.heldIds)
      }
    } catch (exception) {
      const parsedException = parseError(exception)

      nuxtApp.runWithContext(() => {
        useErrorMessage(
          parsedException.message || 'Failed to delete artifacts',
          parsedException.why,
        )
      })
    } finally {
      isDeleting.value = false
    }

    if (result.deletedIds.length) {
      panel.markDeleted(result.deletedIds)
      removeLocally(result.deletedIds)
      await refreshTotals()

      if (!items.value.length && hasMore.value) {
        await loadMore()
      }
    }

    return result
  }

  function toggleSelect(artifactId: string, index?: number) {
    const next = new Set(selectedIds.value)

    if (next.has(artifactId)) {
      next.delete(artifactId)
    } else {
      next.add(artifactId)
    }

    selectedIds.value = next

    if (index !== undefined) {
      lastSelectedIndex.value = index
    }

    if (next.size === 0) {
      isSelectionMode.value = false
    }
  }

  function selectRange(fromIndex: number, toIndex: number) {
    const next = new Set(selectedIds.value)
    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)

    for (let index = start; index <= end; index++) {
      const item = items.value[index]

      if (item) {
        next.add(item.id)
      }
    }

    selectedIds.value = next
    lastSelectedIndex.value = toIndex
  }

  function handleSelect(artifactId: string, index: number, shiftKey: boolean) {
    const canSelectRange = shiftKey
      && !selectedIds.value.has(artifactId)
      && lastSelectedIndex.value !== null
      && selectedIds.value.size > 0

    if (canSelectRange) {
      selectRange(lastSelectedIndex.value as number, index)

      return
    }

    toggleSelect(artifactId, index)
  }

  function enterSelectionMode(artifactId: string, index?: number) {
    isSelectionMode.value = true
    lastSelectedIndex.value = index ?? null
    selectedIds.value = new Set([artifactId])
  }

  function deselectAll() {
    selectedIds.value = new Set()
    isSelectionMode.value = false
    lastSelectedIndex.value = null
  }

  return {
    items,
    total,
    usedBytes,
    hasMore,
    hasError,
    hasLoaded,
    errorMessage,
    isInitialLoad,
    isRefreshing,
    isSkeletonVisible,
    isLoadingMore,
    isDeleting,
    selectedIds,
    selectedCount,
    isSelectionMode,
    refresh,
    refreshItem,
    loadMore,
    deleteArtifacts,
    handleSelect,
    enterSelectionMode,
    deselectAll,
  }
}
