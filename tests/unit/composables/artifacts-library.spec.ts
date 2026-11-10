import { effectScope, nextTick, reactive, ref } from 'vue'
import type { EffectScope } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactSummary } from '../../../shared/utils/artifacts'
import { useArtifactPanel } from '../../../app/composables/artifacts'
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

  it('clears the search and the kind with one history entry', async () => {
    mockRoute.query = { query: 'quiz', kind: 'svg', artifact: 'keep' }

    const filters = setup()

    await filters.clearFilters()

    expect(filters.search.value).toBe('')
    expect(mocks.push).toHaveBeenCalledTimes(1)
    expect(mocks.push).toHaveBeenCalledWith({
      path: '/chats/artifacts',
      query: { artifact: 'keep' },
    })
  })

  it('does not overwrite typing while its own push is in flight',
    async () => {
      let finishPush: () => void = () => {}

      mocks.push.mockReturnValue(new Promise<void>((resolve) => {
        finishPush = resolve
      }))

      const filters = setup()
      const pending = filters.setKind('svg')

      filters.search.value = 'abc'
      mockRoute.query = { kind: 'svg', query: 'ab' }
      await nextTick()

      expect(filters.search.value).toBe('abc')

      finishPush()
      await pending
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

  it('loads the next page after a delete at the offset of the rows shown',
    async () => {
      const ids = createIds(20)
      const library = await setup(createPage(ids, 40))

      mocks.fetch
        .mockResolvedValueOnce({
          deletedIds: ids.slice(0, 5),
          heldIds: [],
        })
        .mockResolvedValueOnce({ items: [], total: 35, usedBytes: 0 })
        .mockResolvedValueOnce(createPage(createIds(15, 'b'), 35))

      await library.deleteArtifacts(ids.slice(0, 5))

      expect(library.items.value).toHaveLength(15)
      expect(library.total.value).toBe(35)

      await library.loadMore()

      expect(mocks.fetch).toHaveBeenLastCalledWith('/api/v1/artifacts', {
        query: { limit: 20, offset: 15 },
      })
      expect(library.items.value).toHaveLength(30)
      expect(library.total.value).toBe(35)
      expect(library.hasMore.value).toBe(true)
    })

  it('does not load the next page while a delete runs', async () => {
    const ids = createIds(20)
    const library = await setup(createPage(ids, 40))
    let resolveDelete: (value: unknown) => void = () => {}

    mocks.fetch
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveDelete = resolve
      }))
      .mockResolvedValueOnce({ items: [], total: 35, usedBytes: 0 })
      .mockResolvedValueOnce(createPage(createIds(15, 'b'), 35))

    const deletion = library.deleteArtifacts(ids.slice(0, 5))

    await library.loadMore()

    expect(mocks.fetch).toHaveBeenCalledTimes(1)

    resolveDelete({ deletedIds: ids.slice(0, 5), heldIds: [] })
    await deletion
    await library.loadMore()

    expect(mocks.fetch).toHaveBeenLastCalledWith('/api/v1/artifacts', {
      query: { limit: 20, offset: 15 },
    })
    expect(library.items.value).toHaveLength(30)
  })

  it('loads the next page when a delete empties the loaded rows', async () => {
    const ids = createIds(20)
    const library = await setup(createPage(ids, 25))

    mocks.fetch
      .mockResolvedValueOnce({ deletedIds: ids, heldIds: [] })
      .mockResolvedValueOnce({ items: [], total: 5, usedBytes: 0 })
      .mockResolvedValueOnce(createPage(createIds(5, 'b'), 5))

    await library.deleteArtifacts(ids)

    expect(mocks.fetch).toHaveBeenLastCalledWith('/api/v1/artifacts', {
      query: { limit: 20, offset: 0 },
    })
    expect(library.items.value.map(item => item.id))
      .toEqual(createIds(5, 'b'))
    expect(library.hasMore.value).toBe(false)
  })

  it('drops a page that was in flight when a delete started', async () => {
    const ids = createIds(20)
    const library = await setup(createPage(ids, 40))
    let resolvePage: (value: unknown) => void = () => {}

    mocks.fetch
      .mockReturnValueOnce(new Promise((resolve) => {
        resolvePage = resolve
      }))
      .mockResolvedValueOnce({ deletedIds: ids.slice(0, 5), heldIds: [] })
      .mockResolvedValueOnce({ items: [], total: 35, usedBytes: 0 })
      .mockResolvedValueOnce(createPage(createIds(15, 'c'), 35))

    const staleLoad = library.loadMore()

    await library.deleteArtifacts(ids.slice(0, 5))

    resolvePage(createPage(createIds(20, 'b'), 40))
    await staleLoad

    expect(library.items.value).toHaveLength(15)

    await library.loadMore()

    expect(mocks.fetch).toHaveBeenLastCalledWith('/api/v1/artifacts', {
      query: { limit: 20, offset: 15 },
    })
    expect(library.items.value.map(item => item.id))
      .toEqual([...ids.slice(5), ...createIds(15, 'c')])
  })

  it('does not subtract a delete twice from a total read after it',
    async () => {
      const library = await setup(createPage(['a1', 'a2', 'a3'], 6))

      mocks.fetch
        .mockResolvedValueOnce({ deletedIds: ['a1'], heldIds: [] })
        .mockResolvedValueOnce({ items: [], total: 5, usedBytes: 0 })

      await library.deleteArtifacts(['a1'])

      expect(library.total.value).toBe(5)

      mocks.fetch.mockResolvedValueOnce({
        deletedIds: ['a2'],
        heldIds: [],
      })
      mocks.fetch.mockRejectedValueOnce(new Error('offline'))

      await library.deleteArtifacts(['a2'])

      expect(library.total.value).toBe(4)
    })

  it('re-reads the totals with the active filters after a delete',
    async () => {
      kind.value = 'html'

      const library = await setup(createPage(['a1'], 1))

      mocks.fetch
        .mockResolvedValueOnce({ deletedIds: ['a1'], heldIds: [] })
        .mockResolvedValueOnce({ items: [], total: 0, usedBytes: 0 })

      await library.deleteArtifacts(['a1'])

      expect(mocks.fetch).toHaveBeenLastCalledWith('/api/v1/artifacts', {
        query: { limit: 1, kind: 'html' },
      })
    })

  it('ignores a totals response that arrives after the filters changed',
    async () => {
      const library = await setup(createPage(['a1', 'a2'], 2, 1000))
      let resolveTotals: (value: unknown) => void = () => {}

      mocks.fetch
        .mockResolvedValueOnce({ deletedIds: ['a1'], heldIds: [] })
        .mockReturnValueOnce(new Promise((resolve) => {
          resolveTotals = resolve
        }))

      const deletion = library.deleteArtifacts(['a1'])

      await vi.waitFor(() => {
        expect(mocks.fetch).toHaveBeenCalledTimes(2)
      })

      kind.value = 'html'
      lazyData.value = createPage(['b1', 'b2', 'b3'], 3, 2000)
      await nextTick()

      resolveTotals({ items: [], total: 99, usedBytes: 99999 })
      await deletion

      expect(library.total.value).toBe(3)
      expect(library.usedBytes.value).toBe(2000)
      expect(library.items.value.map(item => item.id))
        .toEqual(['b1', 'b2', 'b3'])
    })

  describe('delete', () => {
    it('drops a row deleted from the side panel and refreshes the quota',
      async () => {
        const library = await setup(createPage(['a1', 'a2'], 2, 9000))

        mocks.fetch.mockResolvedValueOnce({
          items: [],
          total: 1,
          usedBytes: 4000,
        })

        await useNuxtApp().callHook('artifacts:deleted', ['a1'])

        expect(library.items.value.map(item => item.id)).toEqual(['a2'])
        expect(library.total.value).toBe(1)
        expect(library.usedBytes.value).toBe(4000)
      })

    it('stops listening for panel deletions when the scope ends', async () => {
      const library = await setup(createPage(['a1', 'a2'], 2))

      scope.stop()
      scope = effectScope()
      await useNuxtApp().callHook('artifacts:deleted', ['a1'])

      expect(library.items.value.map(item => item.id)).toEqual(['a1', 'a2'])
      expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('marks deleted rows as deleted for the chat cards', async () => {
      const library = await setup(createPage(['a1'], 1))

      mocks.fetch
        .mockResolvedValueOnce({ deletedIds: ['a1'], heldIds: [] })
        .mockResolvedValueOnce({ items: [], total: 0, usedBytes: 0 })

      await library.deleteArtifacts(['a1'])

      expect(useArtifactPanel().isDeleted('a1')).toBe(true)
    })

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
