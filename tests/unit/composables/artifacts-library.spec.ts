import { effectScope, nextTick, reactive, ref } from 'vue'
import type { EffectScope } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactSummary } from '../../../shared/utils/artifacts'
import {
  ARTIFACT_LIBRARY_SEARCH_DEBOUNCE_MS,
  ARTIFACT_LIBRARY_SKELETON_DELAY_MS,
  formatArtifactUsage,
  parseArtifactKindFilter,
  parseArtifactSearch,
  toArtifactSearchTerm,
  useArtifactLibrary,
  useArtifactLibraryFilters,
} from '../../../app/composables/artifacts-library'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  push: vi.fn(),
  errorMessage: vi.fn(),
}))

const mockRoute = reactive<{ path: string, query: Record<string, unknown> }>({
  path: '/chats/artifacts',
  query: {},
})
const lazyData = ref<Record<string, any> | undefined>(undefined)
const lazyStatus = ref<string>('pending')
const lazyError = ref<unknown>(null)
const lazyRefresh = vi.fn()

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)

mockNuxtImport('useRoute', () => {
  return () => mockRoute
})

mockNuxtImport('useRouter', (original) => {
  return () => {
    return new Proxy(original(), {
      get(target, property) {
        return property === 'push'
          ? mocks.push
          : Reflect.get(target, property)
      },
    })
  }
})

mockNuxtImport('useLazyFetch', () => {
  return () => ({
    data: lazyData,
    status: lazyStatus,
    error: lazyError,
    refresh: lazyRefresh,
  })
})

function createArtifact(
  id: string,
  overrides: Partial<ArtifactSummary> = {},
): ArtifactSummary {
  return {
    id,
    title: `Artifact ${id}`,
    kind: 'html',
    currentVersion: 1,
    versionCount: 1,
    updatedAt: '2026-11-09T08:00:00.000Z',
    originChatSlug: null,
    originChatTitle: null,
    createdVia: 'chat',
    activeShareCount: 0,
    takenDown: false,
    ...overrides,
  }
}

function createIds(count: number, prefix = 'a'): string[] {
  return Array.from({ length: count }, (_value, index) => {
    return `${prefix}${index + 1}`
  })
}

function createPage(ids: string[], total: number, usedBytes = 1024) {
  return {
    items: ids.map(id => createArtifact(id)),
    total,
    usedBytes,
  }
}

describe('artifacts-library helpers', () => {
  it('accepts only known kinds as a filter', () => {
    expect(parseArtifactKindFilter('svg')).toBe('svg')
    expect(parseArtifactKindFilter('exe')).toBe('all')
    expect(parseArtifactKindFilter(undefined)).toBe('all')
    expect(parseArtifactKindFilter(['svg'])).toBe('all')
  })

  it('reads the first text of a search parameter and trims it', () => {
    expect(parseArtifactSearch('  quiz ')).toBe('quiz')
    expect(parseArtifactSearch(['one', 'two'])).toBe('one')
    expect(parseArtifactSearch(undefined)).toBe('')
  })

  it('ignores a search term shorter than the minimum length', () => {
    expect(toArtifactSearchTerm('a')).toBe('')
    expect(toArtifactSearchTerm(' ab ')).toBe('ab')
  })

  it('formats the quota line', () => {
    expect(formatArtifactUsage(0)).toBe('Using 0 B of 25.0 MB')
    expect(formatArtifactUsage(3 * 1024 * 1024))
      .toBe('Using 3.0 MB of 25.0 MB')
  })
})

describe('useArtifactLibraryFilters', () => {
  let scope: EffectScope

  beforeEach(() => {
    vi.useFakeTimers()
    mockRoute.query = {}
    mocks.push.mockReset().mockResolvedValue(undefined)
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
  })

  function setup() {
    return scope.run(() => useArtifactLibraryFilters())!
  }

  it('starts from the URL query', () => {
    mockRoute.query = { query: 'quiz', kind: 'svg' }

    const filters = setup()

    expect(filters.search.value).toBe('quiz')
    expect(filters.appliedQuery.value).toBe('quiz')
    expect(filters.appliedKind.value).toBe('svg')
  })

  it('pushes the debounced search into the URL', async () => {
    const filters = setup()

    filters.search.value = 'quiz'
    await nextTick()

    expect(mocks.push).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(ARTIFACT_LIBRARY_SEARCH_DEBOUNCE_MS)

    expect(mocks.push).toHaveBeenCalledWith({
      path: '/chats/artifacts',
      query: { query: 'quiz' },
    })
  })

  it('does not push a search that is too short', async () => {
    const filters = setup()

    filters.search.value = 'q'
    await nextTick()
    await vi.advanceTimersByTimeAsync(ARTIFACT_LIBRARY_SEARCH_DEBOUNCE_MS)

    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('pushes a kind change and drops the parameter for All', async () => {
    mockRoute.query = { query: 'quiz' }

    const filters = setup()

    await filters.setKind('mermaid')

    expect(mocks.push).toHaveBeenLastCalledWith({
      path: '/chats/artifacts',
      query: { query: 'quiz', kind: 'mermaid' },
    })

    mockRoute.query = { query: 'quiz', kind: 'mermaid' }

    await filters.setKind('all')

    expect(mocks.push).toHaveBeenLastCalledWith({
      path: '/chats/artifacts',
      query: { query: 'quiz' },
    })
  })

  it('does not push when the kind did not change', async () => {
    const filters = setup()

    await filters.setKind('all')

    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('clears the search input and the URL parameter', async () => {
    mockRoute.query = { query: 'quiz', kind: 'svg' }

    const filters = setup()

    await filters.clearSearch()

    expect(filters.search.value).toBe('')
    expect(mocks.push).toHaveBeenCalledWith({
      path: '/chats/artifacts',
      query: { kind: 'svg' },
    })
  })

  it('restores the search input when Back changes the URL', async () => {
    mockRoute.query = { query: 'quiz' }

    const filters = setup()

    mockRoute.query = {}
    await nextTick()

    expect(filters.search.value).toBe('')
    expect(filters.appliedQuery.value).toBe('')
  })

  it('keeps other URL parameters when it pushes', async () => {
    mockRoute.query = { artifact: 'ArtifactPublicId01' }

    const filters = setup()

    await filters.setKind('react')

    expect(mocks.push).toHaveBeenCalledWith({
      path: '/chats/artifacts',
      query: { artifact: 'ArtifactPublicId01', kind: 'react' },
    })
  })
})

describe('useArtifactLibrary', () => {
  let scope: EffectScope
  const query = ref<string>('')
  const kind = ref<'all' | 'html'>('all')

  beforeEach(() => {
    vi.useFakeTimers()
    query.value = ''
    kind.value = 'all'
    lazyData.value = undefined
    lazyStatus.value = 'pending'
    lazyError.value = null
    lazyRefresh.mockReset()
    mocks.fetch.mockReset()
    mocks.errorMessage.mockReset()
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
  })

  async function setup(response = createPage(['a1', 'a2'], 2)) {
    const library = scope.run(() => useArtifactLibrary({ query, kind }))!

    lazyData.value = response
    lazyStatus.value = 'success'
    await nextTick()

    return library
  }

  it('shows the skeleton only after the delay while the first load runs',
    async () => {
      const library = scope.run(() => {
        return useArtifactLibrary({ query, kind })
      })!

      await nextTick()

      expect(library.isInitialLoad.value).toBe(true)
      expect(library.isSkeletonVisible.value).toBe(false)

      await vi.advanceTimersByTimeAsync(ARTIFACT_LIBRARY_SKELETON_DELAY_MS)

      expect(library.isSkeletonVisible.value).toBe(true)

      lazyData.value = createPage(['a1'], 1)
      lazyStatus.value = 'success'
      await nextTick()

      expect(library.isSkeletonVisible.value).toBe(false)
      expect(library.items.value.map(item => item.id)).toEqual(['a1'])
    })

  it('never shows the skeleton when the first load is fast', async () => {
    const library = await setup()

    await vi.advanceTimersByTimeAsync(ARTIFACT_LIBRARY_SKELETON_DELAY_MS)

    expect(library.isSkeletonVisible.value).toBe(false)
  })

  it('exposes the total and the quota from the first page', async () => {
    const library = await setup(createPage(['a1', 'a2'], 5, 4096))

    expect(library.total.value).toBe(5)
    expect(library.usedBytes.value).toBe(4096)
    expect(library.hasMore.value).toBe(true)
  })

  it('appends the next page at the right offset without duplicates',
    async () => {
      const library = await setup(createPage(['a1', 'a2'], 4))

      mocks.fetch.mockResolvedValue(createPage(['a2', 'a3', 'a4'], 4, 2048))

      await library.loadMore()

      expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/artifacts', {
        query: { limit: 20, offset: 2 },
      })
      expect(library.items.value.map(item => item.id))
        .toEqual(['a1', 'a2', 'a3', 'a4'])
      expect(library.hasMore.value).toBe(false)
      expect(library.usedBytes.value).toBe(2048)
    })

  it('sends the filters with every page request', async () => {
    query.value = 'quiz'
    kind.value = 'html'

    const library = await setup(createPage(['a1'], 2))

    mocks.fetch.mockResolvedValue(createPage(['a2'], 2))

    await library.loadMore()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/artifacts', {
      query: { limit: 20, query: 'quiz', kind: 'html', offset: 1 },
    })
  })

  it('reports a failed page load and keeps the list', async () => {
    const library = await setup(createPage(['a1'], 3))

    mocks.fetch.mockRejectedValue(new Error('offline'))

    await library.loadMore()

    expect(mocks.errorMessage).toHaveBeenCalledTimes(1)
    expect(library.items.value.map(item => item.id)).toEqual(['a1'])
    expect(library.isLoadingMore.value).toBe(false)
  })

  it('drops the loaded pages when the first page is fetched again',
    async () => {
      const library = await setup(createPage(['a1'], 2))

      mocks.fetch.mockResolvedValue(createPage(['a2'], 2))
      await library.loadMore()

      lazyData.value = createPage(['a9'], 1)
      await nextTick()

      expect(library.items.value.map(item => item.id)).toEqual(['a9'])
      expect(library.total.value).toBe(1)
    })

  describe('delete', () => {
    it('removes deleted rows locally, keeps held ones and refreshes the quota',
      async () => {
        const library = await setup(createPage(['a1', 'a2', 'a3'], 3, 9000))

        mocks.fetch
          .mockResolvedValueOnce({ deletedIds: ['a1'], heldIds: ['a2'] })
          .mockResolvedValueOnce({ items: [], total: 2, usedBytes: 4000 })

        const result = await library.deleteArtifacts(['a1', 'a2'])

        expect(mocks.fetch).toHaveBeenNthCalledWith(
          1,
          '/api/v1/artifacts/delete/bulk',
          { method: 'POST', body: { ids: ['a1', 'a2'] } },
        )
        expect(mocks.fetch).toHaveBeenNthCalledWith(
          2,
          '/api/v1/artifacts',
          { query: { limit: 1 } },
        )
        expect(result).toEqual({ deletedIds: ['a1'], heldIds: ['a2'] })
        expect(library.items.value.map(item => item.id))
          .toEqual(['a2', 'a3'])
        expect(library.total.value).toBe(2)
        expect(library.usedBytes.value).toBe(4000)
        expect(library.isDeleting.value).toBe(false)
      })

    it('sends more than fifty ids in sequential chunks of fifty', async () => {
      const ids = createIds(120)
      const library = await setup(createPage(ids, 120))

      mocks.fetch.mockImplementation(async (url: string, options: any) => {
        if (url.endsWith('/delete/bulk')) {
          return { deletedIds: options.body.ids, heldIds: [] }
        }

        return { items: [], total: 0, usedBytes: 0 }
      })

      const result = await library.deleteArtifacts(ids)
      const bulkCalls = mocks.fetch.mock.calls.filter((call) => {
        return String(call[0]).endsWith('/delete/bulk')
      })

      expect(bulkCalls.map(call => call[1].body.ids.length))
        .toEqual([50, 50, 20])
      expect(result.deletedIds).toHaveLength(120)
      expect(library.items.value).toHaveLength(0)
    })

    it('keeps the rows and reports when the request fails', async () => {
      const library = await setup(createPage(['a1', 'a2'], 2))

      mocks.fetch.mockRejectedValue(new Error('offline'))

      const result = await library.deleteArtifacts(['a1'])

      expect(result).toEqual({ deletedIds: [], heldIds: [] })
      expect(mocks.errorMessage).toHaveBeenCalledTimes(1)
      expect(library.items.value).toHaveLength(2)
      expect(library.isDeleting.value).toBe(false)
    })

    it('removes the deleted ids from the selection', async () => {
      const library = await setup(createPage(['a1', 'a2'], 2))

      library.enterSelectionMode('a1', 0)
      library.handleSelect('a2', 1, false)
      mocks.fetch
        .mockResolvedValueOnce({ deletedIds: ['a1', 'a2'], heldIds: [] })
        .mockResolvedValueOnce({ items: [], total: 0, usedBytes: 0 })

      await library.deleteArtifacts(['a1', 'a2'])

      expect(library.selectedCount.value).toBe(0)
      expect(library.isSelectionMode.value).toBe(false)
    })
  })

  describe('selection', () => {
    it('enters selection mode with one row selected', async () => {
      const library = await setup()

      library.enterSelectionMode('a1', 0)

      expect(library.isSelectionMode.value).toBe(true)
      expect([...library.selectedIds.value]).toEqual(['a1'])
    })

    it('toggles rows and leaves selection mode when the last is unselected',
      async () => {
        const library = await setup()

        library.enterSelectionMode('a1', 0)
        library.handleSelect('a2', 1, false)

        expect(library.selectedCount.value).toBe(2)

        library.handleSelect('a1', 0, false)
        library.handleSelect('a2', 1, false)

        expect(library.selectedCount.value).toBe(0)
        expect(library.isSelectionMode.value).toBe(false)
      })

    it('selects a range with shift', async () => {
      const library = await setup(createPage(['a1', 'a2', 'a3', 'a4'], 4))

      library.enterSelectionMode('a1', 0)
      library.handleSelect('a4', 3, true)

      expect([...library.selectedIds.value].sort())
        .toEqual(['a1', 'a2', 'a3', 'a4'])
    })

    it('clears the selection when a filter changes', async () => {
      const library = await setup()

      library.enterSelectionMode('a1', 0)
      kind.value = 'html'
      await nextTick()

      expect(library.selectedCount.value).toBe(0)
      expect(library.isSelectionMode.value).toBe(false)
    })
  })

  describe('refreshItem', () => {
    it('patches the share count and title from the detail', async () => {
      const library = await setup(createPage(['a1', 'a2'], 2))

      mocks.fetch.mockResolvedValue({
        ...createArtifact('a1', { title: 'Renamed', activeShareCount: 1 }),
        totalBytes: 10,
        createdAt: '2026-11-09T08:00:00.000Z',
        versions: [],
      })

      await library.refreshItem('a1')

      expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/artifacts/a1')
      expect(library.items.value[0]).toMatchObject({
        id: 'a1',
        title: 'Renamed',
        activeShareCount: 1,
      })
      expect(library.items.value[1]?.title).toBe('Artifact a2')
    })
  })

  describe('error state', () => {
    it('reports an error only when there is no data to show', async () => {
      const library = await setup()

      lazyError.value = new Error('boom')

      expect(library.hasError.value).toBe(false)

      lazyData.value = undefined

      expect(library.hasError.value).toBe(true)
    })
  })
})
