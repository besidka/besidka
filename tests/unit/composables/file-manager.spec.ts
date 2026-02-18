import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useFileManager } from '../../../app/composables/file-manager'

const allFiles = [
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

let fetchMock: ReturnType<typeof vi.fn>

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useFileManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn(async (url: string, options?: any) => {
      if (url === '/api/v1/files') {
        const search = options?.query?.search?.toLowerCase() || ''
        const offset = options?.query?.offset || 0
        const limit = options?.query?.limit || 20
        const filteredFiles = search
          ? allFiles.filter((file) => {
            return file.name.toLowerCase().includes(search)
          })
          : allFiles

        return {
          files: filteredFiles.slice(offset, offset + limit),
          total: filteredFiles.length,
          offset,
          limit,
        }
      }

      if (url === '/api/v1/files/delete/bulk') {
        return { success: true }
      }

      if (url.startsWith('/api/v1/files/') && url.endsWith('/name')) {
        return {
          id: 'file-1',
          name: options?.body?.name,
        }
      }

      if (url.startsWith('/api/v1/files/') && options?.method === 'DELETE') {
        return { success: true }
      }

      throw new Error(`Unhandled $fetch call: ${url}`)
    })
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
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/files/delete/bulk', {
      method: 'POST',
      body: { ids: ['file-1', 'file-2'] },
    })
    expect(manager.files.value).toHaveLength(1)
    expect(manager.files.value[0]?.id).toBe('file-3')
  })

  it('deletes file via single-file endpoint', async () => {
    const manager = useFileManager()
    await manager.fetchFiles(true)

    const result = await manager.deleteFile('file-1')

    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/files/file-1', {
      method: 'DELETE',
    })
    expect(manager.files.value.find(file => file.id === 'file-1')).toBeFalsy()
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

    fetchMock.mockImplementation(async (url: string, options?: any) => {
      if (url === '/api/v1/files') {
        const offset = options?.query?.offset || 0
        const limit = options?.query?.limit || 20

        return {
          files: allFiles.slice(offset, offset + limit),
          total: allFiles.length,
          offset,
          limit,
        }
      }

      if (url.startsWith('/api/v1/files/') && url.endsWith('/name')) {
        throw {
          statusCode: 400,
          statusMessage: 'Invalid file name',
        }
      }

      throw new Error(`Unhandled $fetch call: ${url}`)
    })

    const result = await manager.renameFile('file-1', '')

    expect(result).toBe(false)
  })

  it('returns false when delete request fails', async () => {
    const manager = useFileManager()
    await manager.fetchFiles(true)

    fetchMock.mockImplementation(async (url: string, options?: any) => {
      if (url === '/api/v1/files') {
        const offset = options?.query?.offset || 0
        const limit = options?.query?.limit || 20

        return {
          files: allFiles.slice(offset, offset + limit),
          total: allFiles.length,
          offset,
          limit,
        }
      }

      if (url === '/api/v1/files/file-1' && options?.method === 'DELETE') {
        throw {
          statusCode: 409,
          statusMessage: 'Failed to delete file from storage',
        }
      }

      throw new Error(`Unhandled $fetch call: ${url}`)
    })

    const result = await manager.deleteFile('file-1')

    expect(result).toBe(false)
    expect(manager.files.value.find(file => file.id === 'file-1')).toBeTruthy()
  })
})
