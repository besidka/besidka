import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFolders } from '../../../app/composables/folders'
import {
  createFolder,
  createFoldersResponse,
} from '../../setup/helpers/history-fixtures'
import {
  installMockNuxtState,
  resetMockNuxtState,
} from '../../setup/helpers/nuxt-state'

function flushPromises() {
  return Promise.resolve()
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return {
    promise,
    resolve,
  }
}

describe('useFolders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    vi.setSystemTime(new Date('2026-03-11T10:00:00.000Z'))
    resetMockNuxtState()
    installMockNuxtState()
    vi.stubGlobal('$fetch', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('hydrates cached folders immediately and refreshes in the background', async () => {
    const cachedFolder = createFolder({
      id: 'folder-cached',
      name: 'Cached folder',
    })
    const freshFolder = createFolder({
      id: 'folder-fresh',
      name: 'Fresh folder',
    })
    const deferred = createDeferred<ReturnType<typeof createFoldersResponse>>()
    const fetchMock = vi.fn(() => deferred.promise)
    vi.stubGlobal('$fetch', fetchMock)

    const firstFolders = useFolders()
    firstFolders.prime(createFoldersResponse({ folders: [cachedFolder] }))

    const secondFolders = useFolders()
    const refreshPromise = secondFolders.hydrateAndRefresh()

    expect(secondFolders.folders.value).toEqual([cachedFolder])
    expect(secondFolders.isRefreshing.value).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/folders', {
      query: { sortBy: 'activity' },
    })

    deferred.resolve(createFoldersResponse({ folders: [freshFolder] }))
    await refreshPromise

    expect(secondFolders.folders.value).toEqual([freshFolder])
  })

  it('creates, renames, pins, archives, and deletes folders', async () => {
    const folder = createFolder({ id: 'folder-1', name: 'Inbox' })
    const createdFolder = createFolder({ id: 'folder-2', name: 'Projects' })
    vi.stubGlobal('$fetch', vi.fn((url: string) => {
      if (url === '/api/v1/folders') {
        return Promise.resolve(createdFolder)
      }

      if (url.endsWith('/pin')) {
        return Promise.resolve({ pinnedAt: '2026-03-11T10:00:00.000Z' })
      }

      if (url.endsWith('/archive')) {
        return Promise.resolve({ archivedAt: '2026-03-11T11:00:00.000Z' })
      }

      return Promise.resolve({ success: true })
    }))

    const folders = useFolders()
    folders.prime(createFoldersResponse({ folders: [folder] }))

    const result = await folders.createFolder('Projects')

    expect(result).toEqual(createdFolder)
    expect(folders.folders.value[0]?.id).toBe('folder-2')

    await folders.renameFolder('folder-1', 'Inbox renamed')
    expect(folders.folders.value.find(folder => folder.id === 'folder-1'))
      .toMatchObject({ name: 'Inbox renamed' })

    await folders.togglePin('folder-1')
    expect(folders.pinned.value[0]?.id).toBe('folder-1')

    await folders.toggleArchive('folder-1')
    expect(folders.pinned.value).toHaveLength(0)

    await folders.deleteFolder('folder-2')
    expect(folders.folders.value.map(folder => folder.id)).toEqual([])
  })

  it('debounces search and includes sort and archive filters in requests', async () => {
    vi.useFakeTimers()

    const activeFolder = createFolder({ id: 'folder-active', name: 'Alpha' })
    const archivedFolder = createFolder({
      id: 'folder-archived',
      name: 'Archive',
      archivedAt: '2026-03-01T10:00:00.000Z',
    })
    const fetchMock = vi.fn((url: string, options?: {
      query?: {
        archived?: string
        search?: string
        sortBy?: string
      }
    }) => {
      if (options?.query?.archived === 'true') {
        return Promise.resolve(createFoldersResponse({
          folders: [archivedFolder],
        }))
      }

      if (options?.query?.search === 'Alpha') {
        return Promise.resolve(createFoldersResponse({
          folders: [activeFolder],
        }))
      }

      return Promise.resolve(createFoldersResponse({ folders: [activeFolder] }))
    })
    vi.stubGlobal('$fetch', fetchMock)

    const folders = useFolders()
    await folders.hydrateAndRefresh()

    folders.search.value = 'Alpha'
    await flushPromises()
    vi.advanceTimersByTime(180)
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/folders', {
      query: {
        search: 'Alpha',
        sortBy: 'activity',
      },
    })

    folders.sortBy.value = 'name'
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/folders', {
      query: {
        search: 'Alpha',
        sortBy: 'name',
      },
    })

    folders.showArchived.value = true
    await folders.hydrateAndRefresh()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/folders', {
      query: {
        search: 'Alpha',
        sortBy: 'name',
        archived: 'true',
      },
    })
    expect(folders.folders.value).toEqual([archivedFolder])
  })
})
