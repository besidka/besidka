import { effectScope, nextTick, reactive, ref } from 'vue'
import type { EffectScope } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DocumentFormatCounts,
  DocumentLibraryItem,
  DocumentSourceCounts,
} from '../../../shared/utils/documents'
import {
  DOCUMENT_LIBRARY_SEARCH_DEBOUNCE_MS,
  buildDocumentFormatOptions,
  buildDocumentSourceOptions,
  parseDocumentFormatFilter,
  parseDocumentSourceFilter,
  resolveDocumentFilter,
  toDocumentFileName,
  useDocumentLibrary,
  useDocumentLibraryFilters,
} from '../../../app/composables/documents-library'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  lazyFetch: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  errorMessage: vi.fn(),
  callHook: vi.fn(),
}))

const mockRoute = reactive<{ path: string, query: Record<string, unknown> }>({
  path: '/chats/documents',
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
        if (property === 'push') {
          return mocks.push
        }

        return property === 'replace'
          ? mocks.replace
          : Reflect.get(target, property)
      },
    })
  }
})

mockNuxtImport('useNuxtApp', (original) => {
  return () => {
    return new Proxy(original(), {
      get(target, property) {
        return property === 'callHook'
          ? mocks.callHook
          : Reflect.get(target, property)
      },
    })
  }
})

mockNuxtImport('useLazyFetch', () => {
  return (url: string, options: unknown) => {
    mocks.lazyFetch(url, options)

    return {
      data: lazyData,
      status: lazyStatus,
      error: lazyError,
      refresh: lazyRefresh,
    }
  }
})

function createItem(
  id: string,
  overrides: Partial<DocumentLibraryItem> = {},
): DocumentLibraryItem {
  return {
    id,
    format: 'pdf',
    title: `Document ${id}`,
    source: 'chat',
    fileId: `file-${id}`,
    fileName: `Document ${id}.pdf`,
    storageKey: `${id}.pdf`,
    size: 1024,
    stats: null,
    originChatSlug: null,
    originChatTitle: null,
    createdAt: '2026-11-09T08:00:00.000Z',
    ...overrides,
  }
}

function createFormatCounts(
  overrides: Partial<DocumentFormatCounts> = {},
): DocumentFormatCounts {
  return { pdf: 0, docx: 0, pptx: 0, xlsx: 0, ...overrides }
}

function createSourceCounts(
  overrides: Partial<DocumentSourceCounts> = {},
): DocumentSourceCounts {
  return { chat: 0, mcp: 0, ...overrides }
}

function createPage(ids: string[], total: number) {
  return {
    items: ids.map(id => createItem(id)),
    total,
    formatCounts: createFormatCounts({ pdf: total }),
    sourceCounts: createSourceCounts({ chat: total }),
  }
}

describe('documents-library helpers', () => {
  it('accepts only known formats and sources as filters', () => {
    expect(parseDocumentFormatFilter('docx')).toBe('docx')
    expect(parseDocumentFormatFilter('exe')).toBe('all')
    expect(parseDocumentFormatFilter(['pdf'])).toBe('all')
    expect(parseDocumentSourceFilter('mcp')).toBe('mcp')
    expect(parseDocumentSourceFilter('research')).toBe('all')
    expect(parseDocumentSourceFilter(undefined)).toBe('all')
  })

  it('appends the format extension unless it is already there', () => {
    expect(toDocumentFileName('Plan', 'docx')).toBe('Plan.docx')
    expect(toDocumentFileName('  Plan.DOCX ', 'docx')).toBe('Plan.DOCX')
    expect(toDocumentFileName('Plan.pdf', 'docx')).toBe('Plan.pdf.docx')
  })

  describe('buildDocumentFormatOptions', () => {
    it('has no chips without counts or with a single format', () => {
      expect(buildDocumentFormatOptions(null)).toEqual([])
      expect(buildDocumentFormatOptions(createFormatCounts({ pdf: 4 })))
        .toEqual([])
    })

    it('lists All first and only the formats the user has', () => {
      const options = buildDocumentFormatOptions(createFormatCounts({
        pdf: 2,
        pptx: 1,
        xlsx: 3,
      }))

      expect(options).toEqual([
        { value: 'all', label: 'All', count: 6 },
        { value: 'pdf', label: 'PDF', count: 2 },
        { value: 'pptx', label: 'PowerPoint', count: 1 },
        { value: 'xlsx', label: 'Excel', count: 3 },
      ])
    })

    it('names the Word format', () => {
      const options = buildDocumentFormatOptions(createFormatCounts({
        pdf: 1,
        docx: 1,
      }))

      expect(options.map(option => option.label))
        .toEqual(['All', 'PDF', 'Word'])
    })
  })

  describe('buildDocumentSourceOptions', () => {
    it('has no chips until both sources have documents', () => {
      expect(buildDocumentSourceOptions(null)).toEqual([])
      expect(buildDocumentSourceOptions(createSourceCounts({ chat: 3 })))
        .toEqual([])
    })

    it('lists Chat and Connected app with counts', () => {
      expect(buildDocumentSourceOptions(
        createSourceCounts({ chat: 3, mcp: 1 }),
      )).toEqual([
        { value: 'all', label: 'All sources', count: 4 },
        { value: 'chat', label: 'Chat', count: 3 },
        { value: 'mcp', label: 'Connected app', count: 1 },
      ])
    })
  })

  describe('resolveDocumentFilter', () => {
    it('keeps All, unknown counts and filters with documents', () => {
      const counts = createFormatCounts({ pdf: 1 })

      expect(resolveDocumentFilter('all', counts)).toBe('all')
      expect(resolveDocumentFilter('pdf', null)).toBe('pdf')
      expect(resolveDocumentFilter('pdf', counts)).toBe('pdf')
    })

    it('falls back to All for a filter without documents', () => {
      expect(resolveDocumentFilter('docx', createFormatCounts({ pdf: 1 })))
        .toBe('all')
    })
  })
})

describe('useDocumentLibraryFilters', () => {
  let scope: EffectScope

  beforeEach(() => {
    vi.useFakeTimers()
    mockRoute.query = {}
    mocks.push.mockReset().mockResolvedValue(undefined)
    mocks.replace.mockReset().mockResolvedValue(undefined)
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
  })

  function setup() {
    return scope.run(() => useDocumentLibraryFilters())!
  }

  it('starts from the URL query', () => {
    mockRoute.query = { query: 'plan', format: 'docx', source: 'mcp' }

    const filters = setup()

    expect(filters.search.value).toBe('plan')
    expect(filters.appliedQuery.value).toBe('plan')
    expect(filters.appliedFormat.value).toBe('docx')
    expect(filters.appliedSource.value).toBe('mcp')
  })

  it('ignores unknown filter values in the URL', () => {
    mockRoute.query = { format: 'exe', source: 'research' }

    const filters = setup()

    expect(filters.appliedFormat.value).toBe('all')
    expect(filters.appliedSource.value).toBe('all')
  })

  it('pushes the debounced search into the URL', async () => {
    const filters = setup()

    filters.search.value = 'plan'
    await nextTick()

    expect(mocks.push).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(DOCUMENT_LIBRARY_SEARCH_DEBOUNCE_MS)

    expect(mocks.push).toHaveBeenCalledWith({
      path: '/chats/documents',
      query: { query: 'plan' },
    })
  })

  it('pushes a format change and drops the parameter for All', async () => {
    mockRoute.query = { query: 'plan' }

    const filters = setup()

    await filters.setFormat('pptx')

    expect(mocks.push).toHaveBeenLastCalledWith({
      path: '/chats/documents',
      query: { query: 'plan', format: 'pptx' },
    })

    mockRoute.query = { query: 'plan', format: 'pptx' }

    await filters.setFormat('all')

    expect(mocks.push).toHaveBeenLastCalledWith({
      path: '/chats/documents',
      query: { query: 'plan' },
    })
  })

  it('replaces the entry for a fallback and keeps other filters', async () => {
    mockRoute.query = { format: 'pptx', source: 'chat' }

    const filters = setup()

    await filters.setFormat('all', { replace: true })

    expect(mocks.replace).toHaveBeenCalledWith({
      path: '/chats/documents',
      query: { source: 'chat' },
    })
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('does nothing when the chosen source is already applied', async () => {
    mockRoute.query = { source: 'mcp' }

    const filters = setup()

    await filters.setSource('mcp')

    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('clears the search, format and source together', async () => {
    mockRoute.query = { query: 'plan', format: 'pdf', source: 'chat' }

    const filters = setup()

    await filters.clearFilters()

    expect(filters.search.value).toBe('')
    expect(mocks.push).toHaveBeenCalledWith({
      path: '/chats/documents',
      query: {},
    })
  })
})

describe('useDocumentLibrary', () => {
  let scope: EffectScope
  const query = ref<string>('')
  const format = ref<'all' | 'pdf' | 'docx' | 'pptx' | 'xlsx'>('all')
  const source = ref<'all' | 'chat' | 'mcp'>('all')

  beforeEach(() => {
    vi.useFakeTimers()
    query.value = ''
    format.value = 'all'
    source.value = 'all'
    lazyData.value = undefined
    lazyStatus.value = 'pending'
    lazyError.value = null
    lazyRefresh.mockReset()
    mocks.fetch.mockReset()
    mocks.errorMessage.mockReset()
    mocks.callHook.mockReset().mockResolvedValue(undefined)
    mocks.lazyFetch.mockReset()
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
  })

  async function setup(response = createPage(['d1', 'd2'], 2)) {
    const library = scope.run(() => {
      return useDocumentLibrary({ query, format, source })
    })!

    lazyData.value = response
    lazyStatus.value = 'success'
    await nextTick()

    return library
  }

  it('requests the first page with the applied filters', async () => {
    query.value = 'plan'
    format.value = 'docx'
    source.value = 'mcp'

    await setup()

    const [url, options] = mocks.lazyFetch.mock.calls[0]!

    expect(url).toBe('/api/v1/documents')
    expect(options.query.value).toEqual({
      limit: 20,
      query: 'plan',
      format: 'docx',
      source: 'mcp',
    })
  })

  it('leaves All filters out of the request', async () => {
    await setup()

    const [, options] = mocks.lazyFetch.mock.calls[0]!

    expect(options.query.value).toEqual({ limit: 20 })
  })

  it('exposes the items, total and counts of the first page', async () => {
    const library = await setup({
      ...createPage(['d1', 'd2'], 3),
      formatCounts: createFormatCounts({ pdf: 2, docx: 1 }),
      sourceCounts: createSourceCounts({ chat: 2, mcp: 1 }),
    })

    expect(library.items.value.map(item => item.id)).toEqual(['d1', 'd2'])
    expect(library.total.value).toBe(3)
    expect(library.hasMore.value).toBe(true)
    expect(library.formatCounts.value).toEqual(createFormatCounts({
      pdf: 2,
      docx: 1,
    }))
    expect(library.sourceCounts.value).toEqual({ chat: 2, mcp: 1 })
  })

  it('appends the next page from the current offset', async () => {
    const library = await setup(createPage(['d1', 'd2'], 3))

    mocks.fetch.mockResolvedValue(createPage(['d3'], 3))

    await library.loadMore()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/documents', {
      query: { limit: 20, offset: 2 },
    })
    expect(library.items.value.map(item => item.id))
      .toEqual(['d1', 'd2', 'd3'])
    expect(library.hasMore.value).toBe(false)
  })

  it('reports a failed first load only while nothing is shown', async () => {
    const library = scope.run(() => {
      return useDocumentLibrary({ query, format, source })
    })!

    lazyError.value = { data: { message: 'Service down' } }
    lazyStatus.value = 'error'
    await nextTick()

    expect(library.hasError.value).toBe(true)
    expect(library.errorMessage.value).toBe('Service down')
  })

  describe('delete', () => {
    it('deletes the file, drops the row and refreshes the counts',
      async () => {
        const library = await setup(createPage(['d1', 'd2'], 2))

        mocks.fetch
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce({
            items: [],
            total: 1,
            formatCounts: createFormatCounts({ pdf: 1 }),
            sourceCounts: createSourceCounts({ chat: 1 }),
          })

        const isDeleted = await library.deleteDocument(
          createItem('d1'),
        )

        expect(isDeleted).toBe(true)
        expect(mocks.fetch).toHaveBeenNthCalledWith(
          1,
          '/api/v1/files/file-d1',
          { method: 'DELETE' },
        )
        expect(mocks.callHook)
          .toHaveBeenCalledWith('files:deleted', ['file-d1'])
        expect(mocks.fetch).toHaveBeenNthCalledWith(2, '/api/v1/documents', {
          query: { limit: 1 },
        })
        expect(library.items.value.map(item => item.id)).toEqual(['d2'])
        expect(library.total.value).toBe(1)
        expect(library.formatCounts.value).toEqual(
          createFormatCounts({ pdf: 1 }),
        )
      })

    it('keeps the row and reports the error when the delete fails',
      async () => {
        const library = await setup(createPage(['d1', 'd2'], 2))

        mocks.fetch.mockRejectedValueOnce({
          data: { message: 'Storage is busy' },
        })

        const isDeleted = await library.deleteDocument(createItem('d1'))

        expect(isDeleted).toBe(false)
        expect(library.items.value.map(item => item.id))
          .toEqual(['d1', 'd2'])
        expect(mocks.errorMessage).toHaveBeenCalledWith(
          'Storage is busy',
          undefined,
        )
        expect(mocks.callHook).not.toHaveBeenCalled()
      })

    it('loads the next page when a delete empties the loaded list',
      async () => {
        const library = await setup(createPage(['d1'], 2))

        mocks.fetch
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce({
            items: [],
            total: 1,
            formatCounts: createFormatCounts({ pdf: 1 }),
            sourceCounts: createSourceCounts({ chat: 1 }),
          })
          .mockResolvedValueOnce(createPage(['d2'], 1))

        await library.deleteDocument(createItem('d1'))

        expect(library.items.value.map(item => item.id)).toEqual(['d2'])
      })
  })

  describe('rename', () => {
    it('renames the file and shows the new title at once', async () => {
      const library = await setup(createPage(['d1'], 1))

      mocks.fetch.mockResolvedValueOnce({ id: 'file-d1', name: 'Board.pdf' })

      const isRenamed = await library.renameDocument(
        createItem('d1'),
        'Board',
      )

      expect(isRenamed).toBe(true)
      expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/files/file-d1/name', {
        method: 'PATCH',
        body: { name: 'Board.pdf' },
      })
      expect(library.items.value[0]).toMatchObject({
        title: 'Board',
        fileName: 'Board.pdf',
      })
    })

    it('leaves the row alone when the rename fails', async () => {
      const library = await setup(createPage(['d1'], 1))

      mocks.fetch.mockRejectedValueOnce({ data: { message: 'Nope' } })

      const isRenamed = await library.renameDocument(
        createItem('d1'),
        'Board',
      )

      expect(isRenamed).toBe(false)
      expect(library.items.value[0]!.title).toBe('Document d1')
      expect(mocks.errorMessage).toHaveBeenCalledWith('Nope', undefined)
    })
  })
})
