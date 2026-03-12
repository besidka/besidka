import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { useFolderChats } from '../../../app/composables/folder-chats'
import {
  createFolder,
  createFolderChatsResponse,
  createHistoryChat,
} from '../../setup/helpers/history-fixtures'
import {
  installMockNuxtState,
  resetMockNuxtState,
} from '../../setup/helpers/nuxt-state'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return {
    promise,
    resolve,
    reject,
  }
}

const scopes: EffectScope[] = []

function createFolderChatsComposable(folderId: ReturnType<typeof ref<string>>) {
  const scope = effectScope()
  const folderChats = scope.run(() => useFolderChats(folderId))

  scopes.push(scope)

  if (!folderChats) {
    throw new Error('Failed to create folder chats composable')
  }

  return folderChats
}

describe('useFolderChats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    vi.setSystemTime(new Date('2026-03-11T10:00:00.000Z'))
    resetMockNuxtState()
    installMockNuxtState()
    vi.stubGlobal('$fetch', vi.fn())
  })

  afterEach(() => {
    scopes.splice(0).forEach((scope) => {
      scope.stop()
    })
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('hydrates folder chats cache and loads more pages', async () => {
    const folderId = ref('folder-1')
    const folder = createFolder({ id: 'folder-1', name: 'Folder one' })
    const cachedChat = createHistoryChat({ id: 'chat-1', title: 'Cached chat' })
    const nextChat = createHistoryChat({ id: 'chat-2', title: 'Next chat' })
    const fetchMock = vi.fn(() => {
      return Promise.resolve(createFolderChatsResponse({
        folder,
        chats: [nextChat],
        nextCursor: null,
      }))
    })
    vi.stubGlobal('$fetch', fetchMock)

    const firstFolderChats = useFolderChats(folderId)
    firstFolderChats.prime(createFolderChatsResponse({
      folder,
      chats: [cachedChat],
      nextCursor: '2026-03-10T10:00:00.000Z',
    }))

    const secondFolderChats = useFolderChats(folderId)
    await secondFolderChats.loadMore()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/folders/folder-1/chats', {
      query: { cursor: '2026-03-10T10:00:00.000Z' },
    })
    expect(secondFolderChats.chats.value).toEqual([cachedChat, nextChat])
    expect(secondFolderChats.hasMore.value).toBe(false)
  })

  it('renames, removes, and moves chats based on folder membership', () => {
    const folderId = ref('folder-1')
    const folder = createFolder({ id: 'folder-1' })
    const firstChat = createHistoryChat({ id: 'chat-1', folderId: 'folder-1' })
    const secondChat = createHistoryChat({
      id: 'chat-2',
      folderId: 'folder-1',
      activityAt: '2026-03-11T09:00:00.000Z',
    })

    const folderChats = useFolderChats(folderId)
    folderChats.prime(createFolderChatsResponse({
      folder,
      chats: [secondChat, firstChat],
    }))

    folderChats.renameChat('chat-1', 'Renamed chat')
    expect(folderChats.chats.value[0]?.id).toBe('chat-1')
    expect(folderChats.chats.value[0]?.title).toBe('Renamed chat')

    folderChats.moveChat('chat-1', null)
    expect(folderChats.chats.value.map(chat => chat.id)).toEqual(['chat-2'])

    folderChats.removeChat('chat-2')
    expect(folderChats.chats.value).toEqual([])
  })

  it('re-buckets pinned chats and updates folder metadata', () => {
    const folderId = ref('folder-1')
    const folder = createFolder({ id: 'folder-1', name: 'Inbox' })
    const chat = createHistoryChat({ id: 'chat-1', folderId: 'folder-1' })

    const folderChats = useFolderChats(folderId)
    folderChats.prime(createFolderChatsResponse({
      folder,
      chats: [chat],
    }))

    folderChats.togglePin('chat-1', '2026-03-11T10:00:00.000Z')
    expect(folderChats.pinned.value[0]?.id).toBe('chat-1')
    expect(folderChats.chats.value).toEqual([])

    folderChats.togglePin('chat-1', null)
    expect(folderChats.chats.value[0]?.id).toBe('chat-1')
    expect(folderChats.pinned.value).toEqual([])

    folderChats.updateFolder({
      ...folder,
      name: 'Inbox renamed',
    })
    expect(folderChats.folder.value?.name).toBe('Inbox renamed')
  })

  it('uses separate cache entries per folder id', async () => {
    const firstFolder = createFolder({ id: 'folder-1', name: 'Folder one' })
    const secondFolder = createFolder({ id: 'folder-2', name: 'Folder two' })
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/folders/folder-2/chats') {
        return Promise.resolve(createFolderChatsResponse({
          folder: secondFolder,
          chats: [createHistoryChat({ id: 'chat-2', folderId: 'folder-2' })],
        }))
      }

      return Promise.resolve(createFolderChatsResponse({
        folder: firstFolder,
        chats: [createHistoryChat({ id: 'chat-1', folderId: 'folder-1' })],
      }))
    })
    vi.stubGlobal('$fetch', fetchMock)

    const firstFolderId = ref('folder-1')
    const firstFolderChats = useFolderChats(firstFolderId)
    firstFolderChats.prime(createFolderChatsResponse({
      folder: firstFolder,
      chats: [createHistoryChat({ id: 'chat-1', folderId: 'folder-1' })],
    }))

    const secondFolderId = ref('folder-2')
    const secondFolderChats = useFolderChats(secondFolderId)
    await secondFolderChats.hydrateAndRefresh()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/folders/folder-2/chats', {
      query: undefined,
    })
    expect(secondFolderChats.folder.value?.id).toBe('folder-2')

    const remountedFirstFolderChats = useFolderChats(firstFolderId)
    await remountedFirstFolderChats.hydrateAndRefresh()

    expect(remountedFirstFolderChats.folder.value?.id).toBe('folder-1')
  })

  it('queues the active folder refresh after navigating away mid-request', async () => {
    const folderA = createFolder({ id: 'folder-a', name: 'Folder A' })
    const folderB = createFolder({ id: 'folder-b', name: 'Folder B' })
    const folderARequest = createDeferred<
      ReturnType<typeof createFolderChatsResponse>
    >()
    const folderBRequest = createDeferred<
      ReturnType<typeof createFolderChatsResponse>
    >()
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/folders/folder-a/chats') {
        return folderARequest.promise
      }

      if (url === '/api/v1/folders/folder-b/chats') {
        return folderBRequest.promise
      }

      throw new Error(`Unexpected request: ${url}`)
    })
    const folderId = ref('folder-a')

    vi.stubGlobal('$fetch', fetchMock)

    const folderChats = useFolderChats(folderId)
    const firstRequest = folderChats.hydrateAndRefresh()

    folderId.value = 'folder-b'
    await nextTick()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(folderChats.folder.value).toBeNull()

    folderARequest.resolve(createFolderChatsResponse({
      folder: folderA,
      chats: [createHistoryChat({ id: 'chat-a', folderId: 'folder-a' })],
    }))
    await Promise.resolve()
    await nextTick()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/folders/folder-b/chats', {
      query: undefined,
    })

    folderBRequest.resolve(createFolderChatsResponse({
      folder: folderB,
      chats: [createHistoryChat({ id: 'chat-b', folderId: 'folder-b' })],
    }))
    await firstRequest
    await Promise.resolve()
    await nextTick()

    expect(folderChats.folder.value?.id).toBe('folder-b')
    expect(folderChats.chats.value.map(chat => chat.id)).toEqual(['chat-b'])

    folderId.value = 'folder-a'
    await nextTick()

    expect(folderChats.hasCachedData.value).toBe(true)
    expect(folderChats.folder.value?.id).toBe('folder-a')
    expect(folderChats.chats.value.map(chat => chat.id)).toEqual(['chat-a'])
  })

  it('blocks load-more while a cached refresh is already in flight', async () => {
    const folderId = ref('folder-1')
    const folder = createFolder({ id: 'folder-1', name: 'Folder one' })
    const refreshDeferred = createDeferred<
      ReturnType<typeof createFolderChatsResponse>
    >()
    const fetchMock = vi.fn(() => refreshDeferred.promise)

    vi.stubGlobal('$fetch', fetchMock)

    const folderChats = createFolderChatsComposable(folderId)
    folderChats.prime(createFolderChatsResponse({
      folder,
      chats: [createHistoryChat({ id: 'chat-cached' })],
      nextCursor: '2026-03-10T10:00:00.000Z',
    }))

    const refreshRequest = folderChats.hydrateAndRefresh()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    await folderChats.loadMore()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    refreshDeferred.resolve(createFolderChatsResponse({
      folder,
      chats: [createHistoryChat({ id: 'chat-fresh' })],
      nextCursor: null,
    }))
    await refreshRequest

    expect(folderChats.chats.value.map(chat => chat.id)).toEqual([
      'chat-fresh',
    ])
    expect(folderChats.nextCursor.value).toBeNull()
  })
})
