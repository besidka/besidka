import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useFolderChats } from '../../../app/composables/folder-chats'
import { useFolders } from '../../../app/composables/folders'
import { useHistory } from '../../../app/composables/history'
import {
  createFolder,
  createFolderChatsResponse,
  createFoldersResponse,
  createHistoryChat,
  createHistoryResponse,
} from '../../setup/helpers/history-fixtures'
import {
  installMockNuxtState,
  resetMockNuxtState,
} from '../../setup/helpers/nuxt-state'

describe('history navigation cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockNuxtState()
    installMockNuxtState()
    vi.stubGlobal('$fetch', vi.fn((url: string, options?: {
      query?: {
        search?: string
        archived?: string
        sortBy?: string
      }
    }) => {
      if (url === '/api/v1/chats/history') {
        if (options?.query?.search === 'invoice') {
          return Promise.resolve(createHistoryResponse({
            chats: [createHistoryChat({ id: 'chat-search', title: 'Search' })],
          }))
        }

        return Promise.resolve(createHistoryResponse({
          chats: [createHistoryChat({ id: 'chat-default', title: 'Default' })],
        }))
      }

      if (url === '/api/v1/folders') {
        if (options?.query?.archived === 'true') {
          return Promise.resolve(createFoldersResponse({
            folders: [
              createFolder({
                id: 'folder-archived',
                name: 'Archived',
                archivedAt: '2026-03-01T10:00:00.000Z',
              }),
            ],
          }))
        }

        return Promise.resolve(createFoldersResponse({
          folders: [createFolder({ id: 'folder-active', name: 'Active' })],
        }))
      }

      return Promise.resolve(createFolderChatsResponse({
        folder: createFolder({ id: 'folder-active', name: 'Active' }),
        chats: [createHistoryChat({ id: 'chat-1', folderId: 'folder-active' })],
      }))
    }))
  })

  it('preserves history results across remounts and search keys', async () => {
    const defaultChat = createHistoryChat({ id: 'chat-default', title: 'Default' })
    const searchChat = createHistoryChat({ id: 'chat-search', title: 'Search' })

    const firstHistory = useHistory()
    firstHistory.prime(createHistoryResponse({ chats: [defaultChat] }))
    firstHistory.search.value = 'invoice'
    firstHistory.prime(createHistoryResponse({ chats: [searchChat] }))

    const secondHistory = useHistory()

    secondHistory.search.value = 'invoice'
    await secondHistory.hydrateAndRefresh()
    expect(secondHistory.hasCachedData.value).toBe(true)
    expect(secondHistory.chats.value).toEqual([searchChat])

    secondHistory.search.value = ''
    await secondHistory.hydrateAndRefresh()
    expect(secondHistory.hasCachedData.value).toBe(true)
    expect(secondHistory.chats.value).toEqual([defaultChat])
  })

  it('preserves folders and folder detail caches across remounts', async () => {
    const activeFolder = createFolder({ id: 'folder-active', name: 'Active' })
    const archivedFolder = createFolder({
      id: 'folder-archived',
      name: 'Archived',
      archivedAt: '2026-03-01T10:00:00.000Z',
    })
    const folderChat = createHistoryChat({ id: 'chat-1', folderId: 'folder-active' })
    const folderId = ref('folder-active')

    const firstFolders = useFolders()
    firstFolders.prime(createFoldersResponse({ folders: [activeFolder] }))
    firstFolders.showArchived.value = true
    firstFolders.prime(createFoldersResponse({ folders: [archivedFolder] }))

    const firstFolderChats = useFolderChats(folderId)
    firstFolderChats.prime(createFolderChatsResponse({
      folder: activeFolder,
      chats: [folderChat],
    }))

    const secondFolders = useFolders()
    secondFolders.showArchived.value = true
    await secondFolders.hydrateAndRefresh()
    expect(secondFolders.hasCachedData.value).toBe(true)
    expect(secondFolders.folders.value).toEqual([archivedFolder])

    secondFolders.showArchived.value = false
    await secondFolders.hydrateAndRefresh()
    expect(secondFolders.folders.value).toEqual([activeFolder])

    const secondFolderChats = useFolderChats(folderId)
    expect(secondFolderChats.hasCachedData.value).toBe(true)
    expect(secondFolderChats.folder.value).toEqual(activeFolder)
    expect(secondFolderChats.chats.value).toEqual([folderChat])
  })
})
