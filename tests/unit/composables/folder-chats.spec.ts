import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
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
})
