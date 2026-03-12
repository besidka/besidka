import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHistory } from '../../../app/composables/history'
import {
  createHistoryChat,
  createHistoryResponse,
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

describe('useHistory', () => {
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

  it('hydrates cached history immediately and refreshes in the background', async () => {
    const cachedChat = createHistoryChat({ id: 'chat-cached', title: 'Cached chat' })
    const freshChat = createHistoryChat({ id: 'chat-fresh', title: 'Fresh chat' })
    const deferred = createDeferred<ReturnType<typeof createHistoryResponse>>()
    const fetchMock = vi.fn(() => deferred.promise)
    vi.stubGlobal('$fetch', fetchMock)

    const firstHistory = useHistory()
    firstHistory.prime(createHistoryResponse({
      chats: [cachedChat],
      nextCursor: '2026-03-10T10:00:00.000Z',
    }))

    const secondHistory = useHistory()
    const refreshPromise = secondHistory.hydrateAndRefresh()

    expect(secondHistory.chats.value).toEqual([cachedChat])
    expect(secondHistory.isRefreshing.value).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/history', {
      query: {},
    })

    deferred.resolve(createHistoryResponse({ chats: [freshChat] }))
    await refreshPromise

    expect(secondHistory.chats.value).toEqual([freshChat])
    expect(secondHistory.isRefreshing.value).toBe(false)
    expect(secondHistory.hasCachedData.value).toBe(true)
  })

  it('debounces search and caches by normalized search key', async () => {
    vi.useFakeTimers()

    const defaultChat = createHistoryChat({ id: 'chat-default', title: 'Default chat' })
    const searchChat = createHistoryChat({ id: 'chat-search', title: 'Search chat' })
    const fetchMock = vi.fn((url: string, options?: {
      query?: {
        search?: string
      }
    }) => {
      if (options?.query?.search === 'Report') {
        return Promise.resolve(createHistoryResponse({ chats: [searchChat] }))
      }

      return Promise.resolve(createHistoryResponse({ chats: [defaultChat] }))
    })
    vi.stubGlobal('$fetch', fetchMock)

    const history = useHistory()
    await history.hydrateAndRefresh()

    history.search.value = 'Report'
    await flushPromises()
    vi.advanceTimersByTime(180)
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/chats/history', {
      query: { search: 'Report' },
    })
    expect(history.chats.value).toEqual([searchChat])

    history.search.value = ''
    await flushPromises()
    vi.advanceTimersByTime(180)
    await flushPromises()

    expect(history.chats.value).toEqual([defaultChat])
    expect(history.hasCachedData.value).toBe(true)
  })

  it('loads more chats using the cursor and appends the next page', async () => {
    const firstChat = createHistoryChat({ id: 'chat-1', title: 'Chat 1' })
    const secondChat = createHistoryChat({ id: 'chat-2', title: 'Chat 2' })
    const fetchMock = vi.fn(() => {
      return Promise.resolve(createHistoryResponse({
        chats: [secondChat],
        nextCursor: null,
      }))
    })
    vi.stubGlobal('$fetch', fetchMock)

    const history = useHistory()
    history.prime(createHistoryResponse({
      chats: [firstChat],
      nextCursor: '2026-03-09T10:00:00.000Z',
    }))

    await history.loadMore()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/history', {
      query: { cursor: '2026-03-09T10:00:00.000Z' },
    })
    expect(history.chats.value).toEqual([firstChat, secondChat])
    expect(history.hasMore.value).toBe(false)
  })

  it('toggles pin state and re-buckets chats', async () => {
    const chat = createHistoryChat({ id: 'chat-1', title: 'Chat 1' })
    vi.stubGlobal('$fetch', vi.fn(() => {
      return Promise.resolve({
        pinnedAt: '2026-03-11T10:00:00.000Z',
      })
    }))

    const history = useHistory()
    history.prime(createHistoryResponse({ chats: [chat] }))

    await history.togglePin(chat.id)

    expect(history.pinned.value).toHaveLength(1)
    expect(history.pinned.value[0]?.id).toBe(chat.id)
    expect(history.chats.value).toHaveLength(0)
  })

  it('supports range selection and bulk delete chunking', async () => {
    const chats = Array.from({ length: 91 }, (_, index) => {
      return createHistoryChat({
        id: `chat-${index + 1}`,
        slug: `chat-${index + 1}`,
        title: `Chat ${index + 1}`,
      })
    })
    const fetchMock = vi.fn(() => {
      return Promise.resolve({ success: true })
    })
    vi.stubGlobal('$fetch', fetchMock)

    const history = useHistory()
    history.prime(createHistoryResponse({ chats }))

    history.enterSelectionMode('chat-1', 0)
    history.handleSelect('chat-91', 90, true)

    expect(history.selectedCount.value).toBe(91)

    await history.deleteSelected()

    const deleteCalls = fetchMock.mock.calls.filter(([url]) => {
      return url === '/api/v1/chats/history/delete/bulk'
    })

    expect(deleteCalls).toHaveLength(2)
    expect(deleteCalls[0]?.[1]).toEqual({
      method: 'POST',
      body: {
        chatIds: Array.from({ length: 90 }, (_, index) => `chat-${index + 1}`),
      },
    })
    expect(deleteCalls[1]?.[1]).toEqual({
      method: 'POST',
      body: {
        chatIds: ['chat-91'],
      },
    })
    expect(history.chats.value).toHaveLength(0)
    expect(history.isSelectionMode.value).toBe(false)
  })

  it('uses the original selection snapshot when bulk delete resolves', async () => {
    const chatOne = createHistoryChat({ id: 'chat-1', title: 'Chat 1' })
    const chatTwo = createHistoryChat({ id: 'chat-2', title: 'Chat 2' })
    const chatThree = createHistoryChat({ id: 'chat-3', title: 'Chat 3' })
    const deferred = createDeferred<{ success: boolean }>()
    const fetchMock = vi.fn(() => deferred.promise)
    vi.stubGlobal('$fetch', fetchMock)

    const history = useHistory()
    history.prime(createHistoryResponse({
      chats: [chatOne, chatTwo, chatThree],
    }))
    history.enterSelectionMode(chatOne.id, 0)
    history.handleSelect(chatTwo.id, 1, false)

    const deletePromise = history.deleteSelected()
    await flushPromises()

    history.deselectAll()
    history.enterSelectionMode(chatThree.id, 2)

    deferred.resolve({ success: true })
    await deletePromise

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/history/delete/bulk', {
      method: 'POST',
      body: {
        chatIds: ['chat-1', 'chat-2'],
      },
    })
    expect(history.chats.value.map(chat => chat.id)).toEqual(['chat-3'])
    expect(Array.from(history.selectedIds.value)).toEqual(['chat-3'])
    expect(history.isSelectionMode.value).toBe(true)
  })

  it('clears selection when the search key changes', async () => {
    const chatOne = createHistoryChat({ id: 'chat-1', title: 'Chat 1' })
    const chatTwo = createHistoryChat({ id: 'chat-2', title: 'Chat 2' })

    const history = useHistory()
    history.prime(createHistoryResponse({ chats: [chatOne, chatTwo] }))
    history.enterSelectionMode(chatOne.id, 0)
    history.handleSelect(chatTwo.id, 1, false)

    history.search.value = 'Reports'
    await flushPromises()

    expect(history.selectedCount.value).toBe(0)
    expect(history.isSelectionMode.value).toBe(false)
  })

  it('moves selected chats to a folder and clears selection', async () => {
    const chatOne = createHistoryChat({ id: 'chat-1', title: 'Chat 1' })
    const chatTwo = createHistoryChat({ id: 'chat-2', title: 'Chat 2' })
    const fetchMock = vi.fn(() => {
      return Promise.resolve({ success: true })
    })
    vi.stubGlobal('$fetch', fetchMock)

    const history = useHistory()
    history.prime(createHistoryResponse({ chats: [chatOne, chatTwo] }))
    history.enterSelectionMode(chatOne.id, 0)
    history.handleSelect(chatTwo.id, 1, false)

    await history.moveSelectedToFolder('folder-9', 'Projects')

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/history/folder/bulk', {
      method: 'POST',
      body: {
        chatIds: ['chat-1', 'chat-2'],
        folderId: 'folder-9',
      },
    })
    expect(history.chats.value.map(chat => chat.folderName)).toEqual([
      'Projects',
      'Projects',
    ])
    expect(history.selectedCount.value).toBe(0)
  })

  it('uses the original selection snapshot when bulk move resolves', async () => {
    const chatOne = createHistoryChat({ id: 'chat-1', title: 'Chat 1' })
    const chatTwo = createHistoryChat({ id: 'chat-2', title: 'Chat 2' })
    const chatThree = createHistoryChat({ id: 'chat-3', title: 'Chat 3' })
    const deferred = createDeferred<{ success: boolean }>()
    const fetchMock = vi.fn(() => deferred.promise)
    vi.stubGlobal('$fetch', fetchMock)

    const history = useHistory()
    history.prime(createHistoryResponse({
      chats: [chatOne, chatTwo, chatThree],
    }))
    history.enterSelectionMode(chatOne.id, 0)
    history.handleSelect(chatTwo.id, 1, false)

    const movePromise = history.moveSelectedToFolder('folder-9', 'Projects')
    await flushPromises()

    history.deselectAll()
    history.enterSelectionMode(chatThree.id, 2)

    deferred.resolve({ success: true })
    await movePromise

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/history/folder/bulk', {
      method: 'POST',
      body: {
        chatIds: ['chat-1', 'chat-2'],
        folderId: 'folder-9',
      },
    })
    expect(history.chats.value).toMatchObject([
      { id: 'chat-1', folderId: 'folder-9', folderName: 'Projects' },
      { id: 'chat-2', folderId: 'folder-9', folderName: 'Projects' },
      { id: 'chat-3', folderId: null, folderName: null },
    ])
    expect(Array.from(history.selectedIds.value)).toEqual(['chat-3'])
    expect(history.isSelectionMode.value).toBe(true)
  })

  it('renames and deletes a single chat', async () => {
    const olderChat = createHistoryChat({
      id: 'chat-1',
      slug: 'chat-1',
      title: 'Older chat',
      activityAt: '2026-03-10T08:00:00.000Z',
    })
    const newerChat = createHistoryChat({
      id: 'chat-2',
      slug: 'chat-2',
      title: 'Newer chat',
      activityAt: '2026-03-11T09:00:00.000Z',
    })
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/rename')) {
        return Promise.resolve({ title: 'Renamed chat' })
      }

      return Promise.resolve({ success: true })
    })
    vi.stubGlobal('$fetch', fetchMock)

    const history = useHistory()
    history.prime(createHistoryResponse({ chats: [newerChat, olderChat] }))

    await history.renameChat('chat-1', 'chat-1', 'Renamed chat')

    expect(history.chats.value[0]?.title).toBe('Renamed chat')

    history.enterSelectionMode('chat-2', 0)
    await history.deleteChat('chat-2', 'chat-2')

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/chat-2', {
      method: 'DELETE',
    })
    expect(history.chats.value.map(chat => chat.id)).toEqual(['chat-1'])
    expect(history.selectedIds.value.has('chat-2')).toBe(false)
  })

  it('moves a single chat into and out of a folder', async () => {
    const chat = createHistoryChat({ id: 'chat-1', slug: 'chat-1' })
    const fetchMock = vi.fn(() => {
      return Promise.resolve({ folderId: 'folder-2' })
    })
    vi.stubGlobal('$fetch', fetchMock)

    const history = useHistory()
    history.prime(createHistoryResponse({ chats: [chat] }))

    await history.moveChatToFolder('chat-1', 'chat-1', 'folder-2', 'Inbox')

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/chat-1/folder', {
      method: 'PATCH',
      body: { folderId: 'folder-2' },
    })
    expect(history.chats.value[0]).toMatchObject({
      folderId: 'folder-2',
      folderName: 'Inbox',
    })

    await history.moveChatToFolder('chat-1', 'chat-1', null, null)

    expect(history.chats.value[0]).toMatchObject({
      folderId: null,
      folderName: null,
    })
  })
})
