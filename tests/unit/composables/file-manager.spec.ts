import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useFileManager } from '../../../app/composables/file-manager'

const { fetchMock, requestPersistenceMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  requestPersistenceMock: vi.fn(),
}))

mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('requestPersistence', () => requestPersistenceMock)

const smallFileSet = [
  {
    id: 'file-1',
    storageKey: 'file-1.png',
    name: 'Screenshot 1.png',
    size: 12345,
    type: 'image/png',
    source: 'upload' as const,
    createdAt: new Date('2024-01-01').toISOString(),
  },
  {
    id: 'file-2',
    storageKey: 'file-2.pdf',
    name: 'Document.pdf',
    size: 45678,
    type: 'application/pdf',
    source: 'assistant' as const,
    createdAt: new Date('2024-01-02').toISOString(),
  },
  {
    id: 'file-3',
    storageKey: 'file-3.txt',
    name: 'Notes.txt',
    size: 890,
    type: 'text/plain',
    source: 'upload' as const,
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
    source: (index % 2 === 0 ? 'upload' : 'assistant') as
      'upload' | 'assistant',
    createdAt: new Date(2024, 0, index + 1).toISOString(),
  }))
}

const unfilteredSources = ['all', 'upload']

let activeFileSet: typeof smallFileSet
let baseFetchImpl: (url: string, options?: any) => Promise<any>

function createFetchMock(fileSet: typeof smallFileSet) {
  return async (url: string, options?: any) => {
    if (url === '/api/v1/files') {
      const search = options?.query?.search?.toLowerCase() || ''
      const source = options?.query?.source || 'all'
      const offset = options?.query?.offset || 0
      const limit = options?.query?.limit || 20
      const sourceFiles = unfilteredSources.includes(source)
        ? fileSet
        : fileSet.filter(file => file.source === source)
      const filteredFiles = search
        ? sourceFiles.filter((file) => {
          return file.name.toLowerCase().includes(search)
        })
        : sourceFiles

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
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

function createDeferred<T>() {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve: resolvePromise,
  }
}

describe('useFileManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeFileSet = [...smallFileSet]
    baseFetchImpl = createFetchMock(activeFileSet)
    fetchMock.mockImplementation(baseFetchImpl)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('asks to remember preferences only when the view mode is set', () => {
    const { viewMode } = useFileManager()

    expect(viewMode.value).toBeDefined()
    expect(requestPersistenceMock).not.toHaveBeenCalled()

    viewMode.value = 'list'

    expect(requestPersistenceMock).toHaveBeenCalledTimes(1)
  })

  it('fetches files with pagination', async () => {
    const manager = useFileManager()

    await manager.fetchFiles(true)

    expect(manager.files.value).toHaveLength(3)
    expect(manager.pagination.total).toBe(3)
    expect(manager.hasMore.value).toBe(false)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/files', {
      query: {
        offset: 0,
        limit: 20,
        source: 'upload',
      },
    })
  })

  it('starts on the uploaded source', () => {
    const manager = useFileManager()

    expect(manager.source.value).toBe('upload')
  })

  it('filters by source and resets pagination and selection', async () => {
    const manager = useFileManager()

    await manager.fetchFiles(true)
    manager.selectedIds.value = new Set(['file-1'])
    manager.pagination.offset = 20
    manager.source.value = 'assistant'

    await vi.waitFor(() => {
      expect(manager.files.value).toHaveLength(1)
    })

    expect(manager.files.value[0]?.id).toBe('file-2')
    expect(manager.selectedIds.value.size).toBe(0)
    expect(manager.pagination.offset).toBe(0)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/files', {
      query: {
        offset: 0,
        limit: 20,
        source: 'assistant',
      },
    })
  })

  describe('Projects source', () => {
    const sharedFile = {
      id: 'file-shared',
      storageKey: 'file-shared.pdf',
      name: 'Shared.pdf',
      size: 2048,
      type: 'application/pdf',
      source: 'upload' as const,
      createdAt: new Date('2024-01-04').toISOString(),
    }
    let projectFiles: Record<string, typeof smallFileSet>

    beforeEach(() => {
      projectFiles = {
        'project-a': [
          { ...sharedFile },
          { ...smallFileSet[0]!, id: 'a-1', name: 'A one.png' },
          { ...smallFileSet[0]!, id: 'a-2', name: 'A two.png' },
          { ...smallFileSet[0]!, id: 'a-3', name: 'A three.png' },
        ],
        'project-b': [
          { ...sharedFile },
          { ...smallFileSet[0]!, id: 'b-1', name: 'B one.png' },
        ],
      }
      fetchMock.mockImplementation(async (url: string, options?: any) => {
        if (url === '/api/v1/files/projects') {
          return {
            projects: [
              {
                id: 'project-a',
                name: 'Alpha',
                fileCount: projectFiles['project-a']!.length,
                pinned: true,
                archived: false,
              },
              {
                id: 'project-b',
                name: 'Beta',
                fileCount: projectFiles['project-b']!.length,
                pinned: false,
                archived: false,
              },
            ].filter(project => project.fileCount > 0),
          }
        }

        if (url === '/api/v1/files') {
          const groupFiles = projectFiles[options.query.projectId] ?? []

          return {
            files: groupFiles.slice(
              options.query.offset,
              options.query.offset + options.query.limit,
            ),
            total: groupFiles.length,
            offset: options.query.offset,
            limit: options.query.limit,
          }
        }

        if (url === '/api/v1/files/file-shared/name') {
          return { id: 'file-shared', name: options.body.name }
        }

        if (
          url === '/api/v1/files/delete/bulk'
          || options?.method === 'DELETE'
        ) {
          const ids: string[] = options.body?.ids
            ?? [url.replace('/api/v1/files/', '')]

          for (const key of Object.keys(projectFiles)) {
            projectFiles[key] = projectFiles[key]!.filter((file) => {
              return !ids.includes(file.id)
            })
          }

          return { success: true }
        }

        throw new Error(`Unhandled $fetch call: ${url}`)
      })
    })

    async function openProjectsSource() {
      const manager = useFileManager()

      manager.source.value = 'project'

      await vi.waitFor(() => {
        expect(manager.projectGroups.value).toHaveLength(2)
      })
      await manager.toggleProjectGroup('project-a')

      return manager
    }

    it('loads project groups instead of a flat list', async () => {
      const manager = await openProjectsSource()

      expect(manager.files.value).toEqual([])
      expect(manager.projectGroups.value.map(group => group.id)).toEqual([
        'project-a',
        'project-b',
      ])
      expect(manager.projectGroups.value[0]?.files).toHaveLength(4)
      expect(manager.projectGroups.value[1]?.hasLoaded).toBe(false)
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/files', {
        query: {
          source: 'project',
          projectId: 'project-a',
          offset: 0,
          limit: 20,
        },
      })
    })

    it('debounces search into a group refetch', async () => {
      const manager = await openProjectsSource()

      vi.useFakeTimers()
      manager.search.value = 'one'
      await vi.advanceTimersByTimeAsync(300)
      vi.useRealTimers()

      await vi.waitFor(() => {
        expect(manager.projectGroups.value.every(group => group.isOpen))
          .toBe(true)
      })

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/files/projects', {
        query: { search: 'one' },
      })
    })

    it('shows a file selected in every project that holds it', async () => {
      const manager = await openProjectsSource()

      await manager.toggleProjectGroup('project-b')
      manager.handleProjectGroupSelect('project-a', 'file-shared', 0, false)

      expect(manager.selectedIds.value.has('file-shared')).toBe(true)
      expect(manager.projectGroups.value[1]?.files[0]?.id).toBe(
        'file-shared',
      )
      expect(manager.selectedCount.value).toBe(1)
    })

    it('attaches each selected file once', async () => {
      const manager = await openProjectsSource()

      await manager.toggleProjectGroup('project-b')
      manager.handleProjectGroupSelect('project-a', 'file-shared', 0, false)
      manager.handleProjectGroupSelect('project-b', 'b-1', 1, false)

      const attached = manager.getSelectedForAttach()

      expect(attached.map(file => file.id).sort()).toEqual([
        'b-1',
        'file-shared',
      ])
      expect(manager.selectedCount.value).toBe(0)
    })

    it('selects a shift range only inside one group', async () => {
      const manager = await openProjectsSource()

      await manager.toggleProjectGroup('project-b')
      manager.handleProjectGroupSelect('project-a', 'file-shared', 0, false)
      manager.handleProjectGroupSelect('project-a', 'a-2', 2, true)

      expect(Array.from(manager.selectedIds.value).sort()).toEqual([
        'a-1',
        'a-2',
        'file-shared',
      ])

      manager.handleProjectGroupSelect('project-b', 'b-1', 1, true)

      expect(manager.selectedIds.value.has('b-1')).toBe(true)
      expect(manager.selectedCount.value).toBe(4)
    })

    it('selects and clears one group with select all', async () => {
      const manager = await openProjectsSource()

      manager.toggleProjectGroupSelectAll('project-a')

      expect(manager.selectedCount.value).toBe(4)

      manager.toggleProjectGroupSelectAll('project-a')

      expect(manager.selectedCount.value).toBe(0)
    })

    it('renames every copy of a file', async () => {
      const manager = await openProjectsSource()

      await manager.toggleProjectGroup('project-b')
      await manager.renameFile('file-shared', 'Renamed.pdf')

      expect(manager.projectGroups.value[0]?.files[0]?.name).toBe(
        'Renamed.pdf',
      )
      expect(manager.projectGroups.value[1]?.files[0]?.name).toBe(
        'Renamed.pdf',
      )
    })

    it('prunes a deleted file from every group and keeps totals right', async () => {
      const manager = await openProjectsSource()

      await manager.toggleProjectGroup('project-b')
      manager.selectedIds.value = new Set(['file-shared'])

      expect(await manager.deleteFile('file-shared')).toBe(true)

      expect(manager.projectGroups.value[0]?.files).toHaveLength(3)
      expect(manager.projectGroups.value[0]?.total).toBe(3)
      expect(manager.projectGroups.value[1]?.files.map(file => file.id))
        .toEqual(['b-1'])
      expect(manager.projectGroups.value[1]?.total).toBe(1)
      expect(manager.selectedIds.value.size).toBe(0)
    })

    it('bulk deletes across groups and drops emptied groups', async () => {
      projectFiles['project-b'] = [{ ...sharedFile }]

      const manager = await openProjectsSource()

      await manager.toggleProjectGroup('project-b')
      manager.selectedIds.value = new Set(['file-shared'])

      expect(await manager.deleteSelected()).toBe(true)
      expect(manager.projectGroups.value.map(group => group.id)).toEqual([
        'project-a',
      ])
    })

    it('refills a group emptied by a bulk delete while more files remain', async () => {
      projectFiles['project-a'] = Array.from({ length: 22 }, (_, index) => {
        return {
          ...smallFileSet[0]!,
          id: `a-${index + 1}`,
          name: `A ${index + 1}.png`,
        }
      })

      const manager = await openProjectsSource()
      const loadedIds = manager.projectGroups.value[0]!.files.map((file) => {
        return file.id
      })

      expect(loadedIds).toHaveLength(20)

      manager.selectedIds.value = new Set(loadedIds)

      expect(await manager.deleteSelected()).toBe(true)

      await vi.waitFor(() => {
        expect(manager.projectGroups.value[0]?.files).toHaveLength(2)
      })

      expect(manager.projectGroups.value[0]?.total).toBe(2)
    })

    it('syncs groups to their loaded depth after a stale delete', async () => {
      const deleteResponse = createDeferred<void>()
      const baseImplementation = fetchMock.getMockImplementation()!

      fetchMock.mockImplementation(async (url: string, options?: any) => {
        if (options?.method === 'DELETE') {
          await deleteResponse.promise
        }

        return baseImplementation(url, options)
      })

      const manager = await openProjectsSource()

      await manager.toggleProjectGroup('project-b')
      await manager.toggleProjectGroup('project-b')
      manager.selectedIds.value = new Set(['a-1', 'b-1'])

      const deletion = manager.deleteFile('a-1')

      manager.search.value = 'ignored'
      deleteResponse.resolve()

      expect(await deletion).toBe(true)

      await vi.waitFor(() => {
        expect(
          manager.projectGroups.value[0]?.files.map(file => file.id),
        ).not.toContain('a-1')
      })

      expect(manager.projectGroups.value[0]?.isOpen).toBe(true)
      expect(manager.projectGroups.value[1]?.isOpen).toBe(false)
      expect(manager.projectGroups.value[1]?.hasLoaded).toBe(true)
      expect(Array.from(manager.selectedIds.value)).toEqual(['b-1'])

      manager.reset()
    })

    it('clears groups when switching back to a flat source', async () => {
      const manager = await openProjectsSource()

      manager.source.value = 'upload'
      await vi.waitFor(() => {
        expect(manager.projectGroups.value).toEqual([])
      })
    })

    it('refetches the groups on a files refresh', async () => {
      const manager = await openProjectsSource()

      fetchMock.mockClear()
      await manager.fetchFiles(true)

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/files/projects', {
        query: {},
      })
      expect(manager.projectGroups.value.map(group => group.isOpen)).toEqual([
        false,
        false,
      ])
    })
  })

  it('ignores an older All response after switching source', async () => {
    const allResponse = createDeferred<{
      files: typeof smallFileSet
      total: number
      offset: number
      limit: number
    }>()
    const assistantResponse = createDeferred<{
      files: typeof smallFileSet
      total: number
      offset: number
      limit: number
    }>()
    const raceFetchMock = vi.fn(
      async (_url: string, options?: any) => {
        if (options?.query?.source === 'assistant') {
          return assistantResponse.promise
        }

        return allResponse.promise
      },
    )

    fetchMock.mockImplementation(raceFetchMock)

    const manager = useFileManager()
    const initialRequest = manager.fetchFiles(true)

    manager.source.value = 'assistant'
    assistantResponse.resolve({
      files: [smallFileSet[1]!],
      total: 1,
      offset: 0,
      limit: 20,
    })

    await vi.waitFor(() => {
      expect(manager.files.value[0]?.id).toBe('file-2')
    })

    allResponse.resolve({
      files: smallFileSet,
      total: smallFileSet.length,
      offset: 0,
      limit: 20,
    })
    await initialRequest

    expect(manager.files.value.map(file => file.id)).toEqual(['file-2'])
    expect(manager.pagination.total).toBe(1)
    expect(manager.isLoading.value).toBe(false)
  })

  it('does not repopulate files after reset closes the view', async () => {
    const pendingResponse = createDeferred<{
      files: typeof smallFileSet
      total: number
      offset: number
      limit: number
    }>()

    fetchMock.mockImplementation(async () => pendingResponse.promise)

    const manager = useFileManager()
    const pendingRequest = manager.fetchFiles(true)

    manager.reset()
    pendingResponse.resolve({
      files: smallFileSet,
      total: smallFileSet.length,
      offset: 0,
      limit: 20,
    })
    await pendingRequest

    expect(manager.files.value).toEqual([])
    expect(manager.pagination.total).toBe(0)
    expect(manager.isLoading.value).toBe(false)
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

  it('uses the selection snapshot when bulk delete resolves', async () => {
    const deleteResponse = createDeferred<void>()
    const raceFetchMock = vi.fn(
      async (url: string, options?: any) => {
        if (url === '/api/v1/files/delete/bulk') {
          await deleteResponse.promise

          return { success: true }
        }

        return baseFetchImpl(url, options)
      },
    )

    fetchMock.mockImplementation(raceFetchMock)

    const manager = useFileManager()

    await manager.fetchFiles(true)
    manager.selectedIds.value = new Set(['file-1', 'file-2'])

    const deletePromise = manager.deleteSelected()

    manager.selectedIds.value = new Set(['file-3'])
    deleteResponse.resolve()

    expect(await deletePromise).toBe(true)
    expect(raceFetchMock).toHaveBeenCalledWith(
      '/api/v1/files/delete/bulk',
      {
        method: 'POST',
        body: { ids: ['file-1', 'file-2'] },
      },
    )
    expect(manager.files.value.map(file => file.id)).toEqual(['file-3'])
    expect([...manager.selectedIds.value]).toEqual(['file-3'])
    expect(manager.pagination.total).toBe(1)
  })

  it('reconciles a delete after the source filter changes', async () => {
    const deleteResponse = createDeferred<void>()
    let hasDeletedAssistantFile = false
    const raceFetchMock = vi.fn(
      async (url: string, options?: any) => {
        if (
          url === '/api/v1/files/file-2'
          && options?.method === 'DELETE'
        ) {
          await deleteResponse.promise
          hasDeletedAssistantFile = true

          return { success: true }
        }

        if (url === '/api/v1/files') {
          let responseFiles = smallFileSet

          if (options?.query?.source === 'assistant') {
            responseFiles = hasDeletedAssistantFile
              ? []
              : [smallFileSet[1]!]
          }

          return {
            files: responseFiles,
            total: responseFiles.length,
            offset: 0,
            limit: 20,
          }
        }

        throw new Error(`Unhandled $fetch call: ${url}`)
      },
    )

    fetchMock.mockImplementation(raceFetchMock)

    const manager = useFileManager()

    await manager.fetchFiles(true)

    const deletePromise = manager.deleteFile('file-2')

    manager.source.value = 'assistant'

    await vi.waitFor(() => {
      expect(manager.files.value.map(file => file.id)).toEqual(['file-2'])
    })

    deleteResponse.resolve()

    expect(await deletePromise).toBe(true)
    expect(manager.files.value).toEqual([])
    expect(manager.pagination.total).toBe(0)

    const assistantFetches = raceFetchMock.mock.calls.filter((call) => {
      return call[0] === '/api/v1/files'
        && call[1]?.query?.source === 'assistant'
    })

    expect(assistantFetches).toHaveLength(2)
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
    fetchMock.mockImplementation(async () => {
      throw {
        statusCode: 500,
        statusMessage: 'Failed to load files',
      }
    })

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

      fetchMock.mockImplementation(createFetchMock(largeFileSet))

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

        fetchMock.mockImplementation(createFetchMock(largeFileSet))

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

        fetchMock.mockImplementation(createFetchMock(largeFileSet))

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

        fetchMock.mockImplementation(createFetchMock(largeFileSet))

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

        fetchMock.mockImplementation(createFetchMock(largeFileSet))

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
