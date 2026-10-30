import { shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useFileManagerProjectGroups } from '../../../app/composables/file-manager-project-groups'

const { fetchMock, errorMessageMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  errorMessageMock: vi.fn(),
}))

mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useErrorMessage', () => errorMessageMock)

function createFile(id: string, name = `${id}.pdf`) {
  return {
    id,
    storageKey: `${id}.pdf`,
    name,
    size: 1024,
    type: 'application/pdf',
    source: 'upload' as const,
    createdAt: new Date('2026-01-01').toISOString(),
  }
}

function createFiles(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    return createFile(`${prefix}-${index + 1}`, `${prefix} report ${index + 1}`)
  })
}

const baseProjects = [
  { id: 'project-a', name: 'Alpha', pinned: true, archived: false },
  { id: 'project-b', name: 'Beta', pinned: false, archived: false },
  { id: 'project-c', name: 'Gamma', pinned: false, archived: true },
]
const projects = [...baseProjects]

let filesByProject: Record<string, ReturnType<typeof createFile>[]>

function matchesSearch(file: { name: string }, search?: string) {
  return !search || file.name.toLowerCase().includes(search.toLowerCase())
}

function createFetchImplementation() {
  return async (url: string, options?: any) => {
    const search = options?.query?.search as string | undefined

    if (url === '/api/v1/files/projects') {
      return {
        projects: projects
          .map((project) => {
            return {
              ...project,
              fileCount: (filesByProject[project.id] ?? [])
                .filter(file => matchesSearch(file, search)).length,
            }
          })
          .filter(project => project.fileCount > 0),
      }
    }

    if (url === '/api/v1/files') {
      const matching = (filesByProject[options.query.projectId] ?? [])
        .filter(file => matchesSearch(file, search))
      const offset = options.query.offset ?? 0
      const limit = options.query.limit ?? 20

      return {
        files: matching.slice(offset, offset + limit),
        total: matching.length,
        offset,
        limit,
      }
    }

    throw new Error(`Unhandled $fetch call: ${url}`)
  }
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

function getFilesCalls() {
  return fetchMock.mock.calls.filter(([url]) => url === '/api/v1/files')
}

describe('useFileManagerProjectGroups', () => {
  let search = shallowRef<string>('')

  beforeEach(() => {
    vi.clearAllMocks()
    search = shallowRef<string>('')
    projects.splice(0, projects.length, ...baseProjects)
    filesByProject = {
      'project-a': createFiles('a', 25),
      'project-b': createFiles('b', 3),
      'project-c': createFiles('c', 2),
    }
    fetchMock.mockImplementation(createFetchImplementation())
  })

  it('loads the group list and only the first group page', async () => {
    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()

    expect(manager.groups.value.map(group => group.id)).toEqual([
      'project-a',
      'project-b',
      'project-c',
    ])
    expect(manager.groups.value.map(group => group.isOpen)).toEqual([
      true,
      false,
      false,
    ])
    expect(manager.groups.value[0]?.files).toHaveLength(20)
    expect(manager.groups.value[0]?.total).toBe(25)
    expect(manager.groups.value[0]?.hasLoaded).toBe(true)
    expect(manager.groups.value[1]?.hasLoaded).toBe(false)
    expect(manager.groups.value[1]?.fileCount).toBe(3)
    expect(getFilesCalls()).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/files', {
      query: {
        source: 'project',
        projectId: 'project-a',
        offset: 0,
        limit: 20,
      },
    })
    expect(manager.isLoading.value).toBe(false)
  })

  it('lazy-loads a group on first open and keeps it on collapse', async () => {
    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()
    await manager.toggleGroup('project-b')

    expect(manager.findGroup('project-b')?.isOpen).toBe(true)
    expect(manager.findGroup('project-b')?.files).toHaveLength(3)
    expect(getFilesCalls()).toHaveLength(2)

    await manager.toggleGroup('project-b')
    await manager.toggleGroup('project-b')

    expect(manager.findGroup('project-b')?.isOpen).toBe(true)
    expect(getFilesCalls()).toHaveLength(2)
  })

  it('loads more files for one group from its own offset', async () => {
    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()
    await manager.toggleGroup('project-b')
    await manager.loadMoreGroup('project-a')

    const groupA = manager.findGroup('project-a')

    expect(groupA?.files).toHaveLength(25)
    expect(groupA?.serverOffset).toBe(25)
    expect(manager.findGroup('project-b')?.files).toHaveLength(3)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/files', {
      query: {
        source: 'project',
        projectId: 'project-a',
        offset: 20,
        limit: 20,
      },
    })
    expect(await manager.loadMoreGroup('project-a')).toBe(false)
  })

  it('ignores a stale group list response', async () => {
    const stale = createDeferred<{ projects: unknown[] }>()
    const manager = useFileManagerProjectGroups({ search })

    fetchMock.mockImplementationOnce(() => stale.promise)

    const staleRequest = manager.fetchGroups()

    await manager.fetchGroups()
    stale.resolve({
      projects: [
        {
          id: 'project-stale',
          name: 'Stale',
          fileCount: 1,
          pinned: false,
          archived: false,
        },
      ],
    })

    expect(await staleRequest).toBe(false)
    expect(manager.groups.value.map(group => group.id)).not.toContain(
      'project-stale',
    )
  })

  it('ignores a stale group page after the list is refetched', async () => {
    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()

    const stalePage = createDeferred<unknown>()

    fetchMock.mockImplementationOnce(() => stalePage.promise)

    const loadMoreRequest = manager.loadMoreGroup('project-a')

    fetchMock.mockImplementation(createFetchImplementation())
    await manager.fetchGroups()
    stalePage.resolve({
      files: [createFile('ghost')],
      total: 99,
      offset: 20,
      limit: 20,
    })

    expect(await loadMoreRequest).toBe(false)
    expect(manager.findGroup('project-a')?.total).toBe(25)
    expect(
      manager.findGroup('project-a')?.files.some(file => file.id === 'ghost'),
    ).toBe(false)
  })

  it('keeps group requests independent of each other', async () => {
    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()

    const slowGroupA = createDeferred<unknown>()

    fetchMock.mockImplementationOnce(() => slowGroupA.promise)

    const loadMoreRequest = manager.loadMoreGroup('project-a')

    fetchMock.mockImplementation(createFetchImplementation())
    await manager.toggleGroup('project-b')
    slowGroupA.resolve({
      files: filesByProject['project-a']!.slice(20, 25),
      total: 25,
      offset: 20,
      limit: 20,
    })

    expect(await loadMoreRequest).toBe(true)
    expect(manager.findGroup('project-a')?.files).toHaveLength(25)
    expect(manager.findGroup('project-b')?.files).toHaveLength(3)
  })

  it('opens every matching group while searching', async () => {
    search.value = 'report 2'

    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups(false, true)

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/files/projects', {
      query: { search: 'report 2' },
    })
    expect(manager.groups.value.every(group => group.isOpen)).toBe(true)
    expect(manager.groups.value.map(group => group.id)).toEqual([
      'project-a',
      'project-b',
      'project-c',
    ])
    expect(manager.findGroup('project-a')?.total).toBe(
      filesByProject['project-a']!.filter((file) => {
        return file.name.includes('report 2')
      }).length,
    )
    expect(getFilesCalls().every(([, options]) => {
      return options.query.search === 'report 2'
    })).toBe(true)
  })

  it('drops groups without matches and resets open state on new search', async () => {
    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()
    await manager.toggleGroup('project-c')

    search.value = 'report 25'
    await manager.fetchGroups(false, true)

    expect(manager.groups.value.map(group => group.id)).toEqual([
      'project-a',
    ])
    expect(manager.findGroup('project-a')?.files).toHaveLength(1)

    search.value = ''
    await manager.fetchGroups()

    expect(manager.groups.value.map(group => group.isOpen)).toEqual([
      true,
      false,
      false,
    ])
  })

  it('preserves open groups when asked to', async () => {
    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()
    await manager.toggleGroup('project-b')
    await manager.toggleGroup('project-a')
    await manager.fetchGroups(true)

    expect(manager.groups.value.map(group => group.isOpen)).toEqual([
      false,
      true,
      false,
    ])
    expect(manager.findGroup('project-b')?.hasLoaded).toBe(true)
  })

  it('renames every copy of a file across groups', async () => {
    const shared = createFile('shared', 'Shared.pdf')

    filesByProject['project-a'] = [shared]
    filesByProject['project-b'] = [{ ...shared }]

    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()
    await manager.toggleGroup('project-b')
    manager.renameFile('shared', 'Renamed.pdf')

    expect(manager.findGroup('project-a')?.files[0]?.name).toBe(
      'Renamed.pdf',
    )
    expect(manager.findGroup('project-b')?.files[0]?.name).toBe(
      'Renamed.pdf',
    )
  })

  it('removes a deleted file from every group and drops emptied groups', async () => {
    const shared = createFile('shared', 'Shared.pdf')

    filesByProject['project-a'] = [shared, createFile('only-a')]
    filesByProject['project-b'] = [{ ...shared }]

    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()
    await manager.toggleGroup('project-b')
    manager.removeFiles(['shared'])

    const groupA = manager.findGroup('project-a')

    expect(groupA?.files.map(file => file.id)).toEqual(['only-a'])
    expect(groupA?.total).toBe(1)
    expect(groupA?.serverOffset).toBe(1)
    expect(manager.findGroup('project-b')).toBeUndefined()
  })

  it('dedupes loaded files that live in more than one project', async () => {
    const shared = createFile('shared', 'Shared.pdf')

    filesByProject['project-a'] = [shared]
    filesByProject['project-b'] = [{ ...shared }, createFile('only-b')]

    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()
    await manager.toggleGroup('project-b')

    expect(manager.loadedFiles.value.map(file => file.id)).toEqual([
      'shared',
      'only-b',
    ])
  })

  it('reports a failed group page and allows a retry', async () => {
    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()
    fetchMock.mockRejectedValueOnce(new Error('boom'))

    expect(await manager.toggleGroup('project-b')).toBeUndefined()

    const failedGroup = manager.findGroup('project-b')

    expect(errorMessageMock).toHaveBeenCalled()
    expect(failedGroup?.hasLoaded).toBe(false)
    expect(failedGroup?.isLoading).toBe(false)

    await manager.loadMoreGroup('project-b')

    expect(manager.findGroup('project-b')?.files).toHaveLength(3)
  })

  it('clears every group when invalidated and cleared', async () => {
    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()
    manager.clear()

    expect(manager.groups.value).toEqual([])
    expect(manager.loadedFiles.value).toEqual([])
  })

  it('flags a failed first page and clears the flag on retry', async () => {
    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    await manager.toggleGroup('project-b')

    expect(manager.findGroup('project-b')?.hasError).toBe(true)

    await manager.loadMoreGroup('project-b')

    expect(manager.findGroup('project-b')?.hasError).toBe(false)
    expect(manager.findGroup('project-b')?.hasLoaded).toBe(true)
  })

  it('does not flag an error when a group is only invalidated', async () => {
    const stalled = createDeferred<unknown>()
    const manager = useFileManagerProjectGroups({ search })

    fetchMock.mockImplementation(async (url: string, options?: any) => {
      if (url === '/api/v1/files' && options.query.projectId === 'project-a') {
        return stalled.promise
      }

      return createFetchImplementation()(url, options)
    })

    const pending = manager.fetchGroups()

    await vi.waitFor(() => {
      expect(manager.findGroup('project-a')?.isLoading).toBe(true)
    })
    manager.invalidate()

    const group = manager.findGroup('project-a')

    expect(group?.isLoading).toBe(false)
    expect(group?.hasLoaded).toBe(false)
    expect(group?.hasError).toBe(false)

    stalled.resolve({ files: [], total: 0, offset: 0, limit: 20 })
    await pending
  })

  it('auto-opens at most five groups while searching', async () => {
    projects.length = 0

    for (let index = 1; index <= 7; index++) {
      projects.push({
        id: `project-${index}`,
        name: `Project ${index}`,
        pinned: false,
        archived: false,
      })
      filesByProject[`project-${index}`] = createFiles(`p${index}`, 2)
    }

    search.value = 'report'

    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups(false, true)

    expect(manager.groups.value).toHaveLength(7)
    expect(manager.groups.value.map(group => group.isOpen)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ])
    expect(getFilesCalls()).toHaveLength(5)

    await manager.toggleGroup('project-6')

    expect(manager.findGroup('project-6')?.files).toHaveLength(2)
    expect(getFilesCalls()).toHaveLength(6)
  })

  it('keeps the search indicator until the auto-opened pages finish', async () => {
    vi.useFakeTimers()

    const slowPage = createDeferred<unknown>()
    const manager = useFileManagerProjectGroups({ search })

    search.value = 'report'
    fetchMock.mockImplementation(async (url: string, options?: any) => {
      if (url === '/api/v1/files') {
        return slowPage.promise
      }

      return createFetchImplementation()(url, options)
    })

    const pending = manager.fetchGroups(false, true)

    await vi.advanceTimersByTimeAsync(400)

    expect(manager.isLoading.value).toBe(false)
    expect(manager.isSearching.value).toBe(true)

    slowPage.resolve({
      files: filesByProject['project-a']!.slice(0, 20),
      total: 25,
      offset: 0,
      limit: 20,
    })
    await pending

    expect(manager.isSearching.value).toBe(false)
    vi.useRealTimers()
  })

  it('syncs open groups to their loaded depth and keeps collapsed state', async () => {
    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()
    await manager.loadMoreGroup('project-a')
    await manager.toggleGroup('project-b')
    await manager.toggleGroup('project-b')

    filesByProject['project-a'] = filesByProject['project-a']!.slice(1)
    fetchMock.mockClear()

    expect(await manager.syncGroups()).toBe(true)

    const groupA = manager.findGroup('project-a')
    const groupB = manager.findGroup('project-b')

    expect(groupA?.isOpen).toBe(true)
    expect(groupA?.files).toHaveLength(24)
    expect(groupA?.total).toBe(24)
    expect(groupA?.serverOffset).toBe(24)
    expect(groupB?.isOpen).toBe(false)
    expect(groupB?.hasLoaded).toBe(true)
    expect(groupB?.files).toHaveLength(3)
    expect(manager.findGroup('project-c')?.hasLoaded).toBe(false)
    expect(getFilesCalls().every(([, options]) => {
      return options.query.projectId === 'project-a'
        && options.query.limit <= 100
    })).toBe(true)
  })

  it('refetches the first page of an open group emptied by deletes', async () => {
    filesByProject['project-a'] = createFiles('a', 22)

    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()

    const loadedIds = manager.findGroup('project-a')!.files.map(file => file.id)

    filesByProject['project-a'] = filesByProject['project-a']!.filter((file) => {
      return !loadedIds.includes(file.id)
    })
    manager.removeFiles(loadedIds)

    expect(manager.findGroup('project-a')?.files).toHaveLength(0)
    expect(manager.findGroup('project-a')?.total).toBe(2)

    await manager.refillEmptyGroups()

    expect(manager.findGroup('project-a')?.files).toHaveLength(2)
  })

  it('marks a collapsed emptied group to reload on open', async () => {
    filesByProject['project-b'] = createFiles('b', 22)

    const manager = useFileManagerProjectGroups({ search })

    await manager.fetchGroups()
    await manager.toggleGroup('project-b')
    await manager.toggleGroup('project-b')

    const loadedIds = manager.findGroup('project-b')!.files.map(file => file.id)

    filesByProject['project-b'] = filesByProject['project-b']!.filter((file) => {
      return !loadedIds.includes(file.id)
    })
    manager.removeFiles(loadedIds)
    fetchMock.mockClear()
    await manager.refillEmptyGroups()

    expect(getFilesCalls()).toHaveLength(0)
    expect(manager.findGroup('project-b')?.hasLoaded).toBe(false)

    await manager.toggleGroup('project-b')

    expect(manager.findGroup('project-b')?.files).toHaveLength(2)
  })
})
