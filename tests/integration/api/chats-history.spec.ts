import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createHistoryChat,
} from '../../setup/helpers/history-fixtures'
import { createHistoryCursor } from '../../../server/utils/chats/history/cursor'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  refreshFolderActivityAt: vi.fn(async () => undefined),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
  createError: (input: {
    message?: string
    status?: number
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, {
      status: input.status,
      why: input.why,
      message: input.message,
    })

    return exception
  },
}))

vi.mock('~~/server/utils/folders/activity', () => ({
  refreshFolderActivityAt: mocks.refreshFolderActivityAt,
}))

async function getHistoryHandler() {
  const module = await import('../../../server/api/v1/chats/history/index.get')

  return module.default
}

async function getRenameHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/rename.patch'
  )

  return module.default
}

async function getDeleteHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/index.delete'
  )

  return module.default
}

async function getPinHandler() {
  const module = await import('../../../server/api/v1/chats/history/pin.post')

  return module.default
}

async function getBulkDeleteHandler() {
  const module = await import(
    '../../../server/api/v1/chats/history/delete/bulk.post'
  )

  return module.default
}

async function getFolderMoveHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/folder.patch'
  )

  return module.default
}

async function getBulkFolderMoveHandler() {
  const module = await import(
    '../../../server/api/v1/chats/history/folder/bulk.post'
  )

  return module.default
}

function createSelectChain() {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
  }

  return chain
}

function withDateFields<T extends {
  activityAt: string
  createdAt: string
  pinnedAt: string | null
}>(chat: T) {
  return {
    ...chat,
    activityAt: new Date(chat.activityAt),
    createdAt: new Date(chat.createdAt),
    pinnedAt: chat.pinnedAt ? new Date(chat.pinnedAt) : null,
  }
}

describe('chat history API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.refreshFolderActivityAt.mockResolvedValue(undefined)

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
      data?: unknown
    }) => {
      const exception = new Error(input.statusMessage || 'Error')

      Object.assign(exception, input)

      return exception
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw (globalThis as any).createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
      })
    })
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => unknown,
    ) => {
      return parser(event.body)
    })
    vi.stubGlobal('getValidatedRouterParams', async (
      event: { params: unknown },
      parser: (params: unknown) => unknown,
    ) => {
      return parser(event.params)
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
  })

  it('merges title and message search matches, dedupes them, and disables cursors', async () => {
    const handler = await getHistoryHandler()
    const titleMatch = withDateFields(createHistoryChat({
      id: 'chat-title',
      title: 'Roadmap',
      activityAt: '2026-03-11T11:00:00.000Z',
      pinnedAt: '2026-03-11T09:00:00.000Z',
    }))
    const sharedMatch = withDateFields(createHistoryChat({
      id: 'chat-shared',
      title: 'Shared',
      activityAt: '2026-03-10T11:00:00.000Z',
    }))
    const messageMatch = withDateFields(createHistoryChat({
      id: 'chat-message',
      title: 'Support thread',
      activityAt: '2026-03-09T11:00:00.000Z',
    }))
    const titleSelectChain = createSelectChain()
    const contentSelectChain = createSelectChain()
    const messagesSelectChain = createSelectChain()
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(titleSelectChain)
        .mockReturnValueOnce(contentSelectChain)
        .mockReturnValue(messagesSelectChain),
      batch: vi.fn(async () => {
        return [
          [titleMatch, sharedMatch],
          [sharedMatch, messageMatch],
        ]
      }),
    }

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useEvent', () => ({
      query: { search: 'map' },
    }))
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

    const response = await handler()

    expect(response.pinned.map((chat: { id: string }) => chat.id)).toEqual([
      'chat-title',
    ])
    expect(response.chats.map((chat: { id: string }) => chat.id)).toEqual([
      'chat-shared',
      'chat-message',
    ])
    expect(response.nextCursor).toBeNull()
    expect(contentSelectChain.innerJoin).not.toHaveBeenCalled()
  })

  it('returns pinned chats separately and computes the next cursor', async () => {
    const handler = await getHistoryHandler()
    const pinnedChat = withDateFields(createHistoryChat({
      id: 'chat-pinned',
      pinnedAt: '2026-03-11T08:00:00.000Z',
    }))
    const firstChat = withDateFields(createHistoryChat({
      id: 'chat-1',
      activityAt: '2026-03-11T10:00:00.000Z',
    }))
    const secondChat = withDateFields(createHistoryChat({
      id: 'chat-2',
      activityAt: '2026-03-10T10:00:00.000Z',
    }))
    const db = {
      select: vi.fn(() => createSelectChain()),
      batch: vi.fn(async () => {
        return [[pinnedChat], [firstChat, secondChat]]
      }),
    }

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useEvent', () => ({
      query: { limit: '2', cursor: '2026-03-09T00:00:00.000Z' },
    }))
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

    const response = await handler()

    expect(response.pinned).toEqual([pinnedChat])
    expect(response.chats).toEqual([firstChat, secondChat])
    expect(response.nextCursor).toBe(createHistoryCursor(secondChat))
  })

  it('renames chats and refreshes activity timestamps', async () => {
    const handler = await getRenameHandler()
    const updateWhere = vi.fn(async () => undefined)
    const updateSet = vi.fn(() => ({
      where: updateWhere,
    }))
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({ id: 'chat-1' })),
        },
      },
      update: vi.fn(() => ({
        set: updateSet,
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: { title: 'Renamed chat' },
    } as any)

    expect(response).toEqual({ title: 'Renamed chat' })
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Renamed chat',
      activityAt: expect.any(Date),
    }))
    expect(updateWhere).toHaveBeenCalled()
  })

  it('deletes chats through single and bulk endpoints', async () => {
    const singleDeleteHandler = await getDeleteHandler()
    const bulkDeleteHandler = await getBulkDeleteHandler()
    const deleteWhere = vi.fn(async () => undefined)
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({ id: 'chat-1' })),
        },
      },
      delete: vi.fn(() => ({
        where: deleteWhere,
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const singleResponse = await singleDeleteHandler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)
    const bulkResponse = await bulkDeleteHandler({
      body: { chatIds: ['chat-1', 'chat-2'] },
    } as any)

    expect(singleResponse).toEqual({ success: true })
    expect(bulkResponse).toEqual({ success: true })
    expect(deleteWhere).toHaveBeenCalledTimes(2)
  })

  it('pins chats and updates activity timestamps', async () => {
    const handler = await getPinHandler()
    const updateWhere = vi.fn(async () => undefined)
    const updateSet = vi.fn(() => ({
      where: updateWhere,
    }))
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            pinnedAt: null,
          })),
        },
      },
      update: vi.fn(() => ({
        set: updateSet,
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      body: { chatId: 'chat-1' },
    } as any)

    expect(response.pinnedAt).toBeInstanceOf(Date)
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      pinnedAt: expect.any(Date),
      activityAt: expect.any(Date),
    }))
  })

  it('moves chats into folders and refreshes source folder activity for single and bulk actions', async () => {
    const singleHandler = await getFolderMoveHandler()
    const bulkHandler = await getBulkFolderMoveHandler()
    const schema = await import('../../../server/db/schema')
    const updateWhere = vi.fn(async () => undefined)
    const folderActivityWhere = vi.fn(async () => undefined)
    const updateSet = vi.fn(() => ({
      where: updateWhere,
    }))
    const folderSet = vi.fn(() => ({
      where: folderActivityWhere,
    }))
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            folderId: 'folder-source',
          })),
          findMany: vi.fn(async () => ([
            { id: 'chat-1', folderId: 'folder-source' },
            { id: 'chat-2', folderId: 'folder-other' },
          ])),
        },
        folders: {
          findFirst: vi.fn(async () => ({ id: 'folder-1' })),
        },
      },
      update: vi.fn((table: unknown) => {
        if (table === schema.folders) {
          return {
            set: folderSet,
          }
        }

        return {
          set: updateSet,
        }
      }),
    }

    vi.stubGlobal('useDb', () => db)

    const singleResponse = await singleHandler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: { folderId: 'folder-1' },
    } as any)
    const bulkResponse = await bulkHandler({
      body: {
        chatIds: ['chat-1', 'chat-2'],
        folderId: 'folder-1',
      },
    } as any)

    expect(singleResponse).toEqual({ folderId: 'folder-1' })
    expect(bulkResponse).toEqual({ success: true })
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      folderId: 'folder-1',
      activityAt: expect.any(Date),
    }))
    expect(folderSet).toHaveBeenCalledWith(expect.objectContaining({
      activityAt: expect.any(Date),
    }))
    expect(mocks.refreshFolderActivityAt).toHaveBeenNthCalledWith(
      1,
      ['folder-source'],
      1,
      db,
    )
    expect(mocks.refreshFolderActivityAt).toHaveBeenNthCalledWith(
      2,
      ['folder-source', 'folder-other'],
      1,
      db,
    )
  })
})
