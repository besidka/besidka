import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useFileManager } from '../../../app/composables/file-manager'

const smallFileSet = [
  {
    id: 'file-1',
    storageKey: 'file-1.png',
    name: 'Screenshot 1.png',
    size: 12345,
    type: 'image/png',
    createdAt: new Date('2024-01-01').toISOString(),
  },
  {
    id: 'file-2',
    storageKey: 'file-2.pdf',
    name: 'Document.pdf',
    size: 45678,
    type: 'application/pdf',
    createdAt: new Date('2024-01-02').toISOString(),
  },
  {
    id: 'file-3',
    storageKey: 'file-3.txt',
    name: 'Notes.txt',
    size: 890,
    type: 'text/plain',
    createdAt: new Date('2024-01-03').toISOString(),
  },
]

function generateFiles(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `file-${index + 1}`,
    storageKey: `file-${index + 1}.png`,
    name: `File ${index + 1}.png`,
    size: 1000 + index,
    type: 'image/png',
    createdAt: new Date(2024, 0, index + 1).toISOString(),
  }))
}

let fetchMock: ReturnType<typeof vi.fn>
let activeFileSet: typeof smallFileSet

function createFetchMock(fileSet: typeof smallFileSet) {
  return vi.fn(async (url: string, options?: any) => {
    if (url === '/api/v1/files') {
      const search = options?.query?.search?.toLowerCase() || ''
      const offset = options?.query?.offset || 0
      const limit = options?.query?.limit || 20
      const filteredFiles = search
        ? fileSet.filter((file) => {
          return file.name.toLowerCase().includes(search)
        })
        : fileSet

      return {
        files: filteredFiles.slice(offset, offset + limit),
        total: filteredFiles.length,
        offset,
        limit,
      }
    }

    if (url === '/api/v1/files/delete/bulk') {
      const ids = options?.body?.ids || []

      fileSet = fileSet.filter((file) => {
        return !ids.includes(file.id)
      })

      return { success: true }
    }

    if (
      url.startsWith('/api/v1/files/')
      && url.endsWith('/name')
    ) {
      return {
        id: 'file-1',
        name: options?.body?.name,
      }
    }

    if (
      url.startsWith('/api/v1/files/')
      && options?.method === 'DELETE'
    ) {
      const id = url.replace('/api/v1/files/', '')

      fileSet = fileSet.filter(file => file.id !== id)

      return { success: true }
    }

    throw new Error(`Unhandled $fetch call: ${url}`)
  })
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useFileManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeFileSet = [...smallFileSet]
    fetchMock = createFetchMock(activeFileSet)
    vi.stubGlobal('$fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('fetches files with pagination', async () => {
    const manager = useFileManager()

    await manager.fetchFiles(true)

    expect(manager.files.value).toHaveLength(3)
    expect(manager.pagination.total).toBe(3)
    expect(manager.hasMore.value).toBe(false)
  })

  it('searches files with debounce', async () => {
    vi.useFakeTimers()

    const manager = useFileManager()
    await manager.fetchFiles(true)

    manager.search.value = 'document'
    await flushPromises()
    vi.advanceTimersByTime(700)
    await flushPromises()

    expect(manager.files.value).toHaveLength(1)
    expect(manager.files.value[0]?.name).toBe('Document.pdf')
  })

  it('renames file and updates local state', async () => {
    const manager = useFileManager()
    await manager.fetchFiles(true)

    const result = await manager.renameFile('file-1', 'Renamed.png')

    expect(result).toBe(true)
    expect(manager.files.value[0]?.name).toBe('Renamed.png')
  })

  it('deletes selected files via bulk endpoint', async () => {
    const manager = useFileManager()
    await manager.fetchFiles(true)

    manager.selectedIds.value = new Set(['file-1', 'file-2'])

    const result = await manager.deleteSelected()

    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/files/delete/bulk',
      {
        method: 'POST',
        body: { ids: ['file-1', 'file-2'] },
      },
    )
    expect(manager.files.value).toHaveLength(1)
    expect(manager.files.value[0]?.id).toBe('file-3')
  })

  it('deletes file via single-file endpoint', async () => {
    const manager = useFileManager()
    await manager.fetchFiles(true)

    const result = await manager.deleteFile('file-1')

    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/files/file-1',
      { method: 'DELETE' },
    )
    expect(
      manager.files.value.find(file => file.id === 'file-1'),
    ).toBeFalsy()
  })

  it('shows error when fetching fails', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => {
      throw {
        statusCode: 500,
        statusMessage: 'Failed to load files',
      }
    }))

    const manager = useFileManager()
    await manager.fetchFiles(true)

    expect(manager.files.value).toHaveLength(0)
  })

  it('returns false when rename request fails', async () => {
    const manager = useFileManager()
    await manager.fetchFiles(true)

    fetchMock.mockImplementation(
      async (url: string, options?: any) => {
        if (url === '/api/v1/files') {
          const offset = options?.query?.offset || 0
          const limit = options?.query?.limit || 20

          return {
            files: activeFileSet.slice(offset, offset + limit),
            total: activeFileSet.length,
            offset,
            limit,
          }
        }

        if (
          url.startsWith('/api/v1/files/')
          && url.endsWith('/name')
        ) {
          throw {
            statusCode: 400,
            statusMessage: 'Invalid file name',
          }
        }

        throw new Error(`Unhandled $fetch call: ${url}`)
      },
    )

    const result = await manager.renameFile('file-1', '')

    expect(result).toBe(false)
  })

  it('returns false when delete request fails', async () => {
    const manager = useFileManager()
    await manager.fetchFiles(true)

    fetchMock.mockImplementation(
      async (url: string, options?: any) => {
        if (url === '/api/v1/files') {
          const offset = options?.query?.offset || 0
          const limit = options?.query?.limit || 20

          return {
            files: activeFileSet.slice(offset, offset + limit),
            total: activeFileSet.length,
            offset,
            limit,
          }
        }

        if (
          url === '/api/v1/files/file-1'
          && options?.method === 'DELETE'
        ) {
          throw {
            statusCode: 409,
            statusMessage: 'Failed to delete file from storage',
          }
        }

        throw new Error(`Unhandled $fetch call: ${url}`)
      },
    )

    const result = await manager.deleteFile('file-1')

    expect(result).toBe(false)
    expect(
      manager.files.value.find(file => file.id === 'file-1'),
    ).toBeTruthy()
  })

  describe('load more pagination', () => {
    it('shows hasMore when more files exist on server', async () => {
      const largeFileSet = generateFiles(45)

      fetchMock = createFetchMock(largeFileSet)
      vi.stubGlobal('$fetch', fetchMock)

      const manager = useFileManager()
      await manager.fetchFiles(true)

      expect(manager.files.value).toHaveLength(20)
      expect(manager.pagination.total).toBe(45)
      expect(manager.hasMore.value).toBe(true)
    })

    it(
      'uses files.length as offset for load more',
      async () => {
        const largeFileSet = generateFiles(45)

        fetchMock = createFetchMock(largeFileSet)
        vi.stubGlobal('$fetch', fetchMock)

        const manager = useFileManager()
        await manager.fetchFiles(true)
        await manager.loadMore()

        expect(manager.files.value).toHaveLength(40)

        const loadMoreCall = fetchMock.mock.calls.find(
          (call: any[]) => {
            return call[0] === '/api/v1/files'
              && call[1]?.query?.offset === 20
          },
        )

        expect(loadMoreCall).toBeTruthy()
      },
    )

    it(
      'uses correct offset after deleting files then loading more',
      async () => {
        const largeFileSet = generateFiles(45)

        fetchMock = createFetchMock(largeFileSet)
        vi.stubGlobal('$fetch', fetchMock)

        const manager = useFileManager()
        await manager.fetchFiles(true)
        await manager.loadMore()

        expect(manager.files.value).toHaveLength(40)

        await manager.deleteFile('file-5')
        await manager.deleteFile('file-10')
        await manager.deleteFile('file-15')

        expect(manager.files.value).toHaveLength(37)

        fetchMock.mockClear()
        await manager.loadMore()

        const loadMoreCall = fetchMock.mock.calls.find(
          (call: any[]) => {
            return call[0] === '/api/v1/files'
          },
        )

        expect(loadMoreCall?.[1]?.query?.offset).toBe(40)
      },
    )

    it(
      'hasMore is true when files array is empty but total is positive',
      async () => {
        const manager = useFileManager()
        await manager.fetchFiles(true)

        manager.files.value = []
        manager.pagination.total = 100

        expect(manager.hasMore.value).toBe(true)
      },
    )

    it(
      'auto-fetches after deleting all visible files '
      + 'when more exist on server',
      async () => {
        const largeFileSet = generateFiles(25)

        fetchMock = createFetchMock(largeFileSet)
        vi.stubGlobal('$fetch', fetchMock)

        const manager = useFileManager()
        await manager.fetchFiles(true)

        expect(manager.files.value).toHaveLength(20)

        const idsToDelete = manager.files.value.map(
          file => file.id,
        )

        manager.selectedIds.value = new Set(idsToDelete)
        await manager.deleteSelected()

        expect(manager.files.value).toHaveLength(5)
        expect(manager.pagination.total).toBe(5)
        expect(manager.hasMore.value).toBe(false)
      },
    )

    it(
      'shows empty state after deleting all files '
      + 'when none remain on server',
      async () => {
        const manager = useFileManager()
        await manager.fetchFiles(true)

        expect(manager.files.value).toHaveLength(3)

        manager.selectedIds.value = new Set(
          ['file-1', 'file-2', 'file-3'],
        )

        await manager.deleteSelected()

        expect(manager.files.value).toHaveLength(0)
        expect(manager.pagination.total).toBe(0)
        expect(manager.hasMore.value).toBe(false)
      },
    )

    it(
      'auto-fetches after single delete empties the list '
      + 'when more exist on server',
      async () => {
        const largeFileSet = generateFiles(21)

        fetchMock = createFetchMock(largeFileSet)
        vi.stubGlobal('$fetch', fetchMock)

        const manager = useFileManager()
        manager.pagination.limit = 1
        await manager.fetchFiles(true)

        expect(manager.files.value).toHaveLength(1)
        expect(manager.pagination.total).toBe(21)

        await manager.deleteFile('file-1')

        expect(manager.files.value.length).toBeGreaterThan(0)
        expect(manager.pagination.total).toBe(20)
      },
    )

    it(
      'does not auto-fetch after single delete '
      + 'when files remain loaded',
      async () => {
        const manager = useFileManager()
        await manager.fetchFiles(true)

        const callCountBefore = fetchMock.mock.calls.length

        await manager.deleteFile('file-1')

        const fetchCalls = fetchMock.mock.calls.filter(
          (call: any[]) => call[0] === '/api/v1/files',
        )

        expect(fetchCalls).toHaveLength(callCountBefore)
        expect(manager.files.value).toHaveLength(2)
      },
    )
  })
})
