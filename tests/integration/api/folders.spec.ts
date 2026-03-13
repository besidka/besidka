import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFolder,
  createHistoryChat,
} from '../../setup/helpers/history-fixtures'
import { createHistoryCursor } from '../../../server/utils/chats/history/cursor'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
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

async function getFoldersHandler() {
  const module = await import('../../../server/api/v1/folders/index.get')

  return module.default
}

async function getCreateFolderHandler() {
  const module = await import('../../../server/api/v1/folders/index.put')

  return module.default
}

async function getRenameFolderHandler() {
  const module = await import('../../../server/api/v1/folders/[id]/name.patch')

  return module.default
}

async function getPinFolderHandler() {
  const module = await import('../../../server/api/v1/folders/[id]/pin.post')

  return module.default
}

async function getArchiveFolderHandler() {
  const module = await import('../../../server/api/v1/folders/[id]/archive.post')

  return module.default
}

async function getDeleteFolderHandler() {
  const module = await import('../../../server/api/v1/folders/[id]/index.delete')

  return module.default
}

async function getFolderChatsHandler() {
  const module = await import('../../../server/api/v1/folders/[id]/chats.get')

  return module.default
}

function createSelectChain() {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
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

describe('folders API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

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
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
  })

  it('lists folders with search, sort, and archive filters', async () => {
    const handler = await getFoldersHandler()
    const pinnedFolder = createFolder({
      id: 'folder-pinned',
      pinnedAt: '2026-03-11T08:00:00.000Z',
    })
    const activeFolder = createFolder({ id: 'folder-active', name: 'Alpha' })
    const db = {
      select: vi.fn(() => createSelectChain()),
      batch: vi.fn(async () => {
        return [[pinnedFolder], [activeFolder]]
      }),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      query: {
        search: 'Al',
        sortBy: 'name',
        archived: 'true',
      },
    } as any)

    expect(response).toEqual({
      pinned: [pinnedFolder],
      folders: [activeFolder],
    })
  })

  it('creates, renames, pins, and archives folders', async () => {
    const createHandler = await getCreateFolderHandler()
    const renameHandler = await getRenameFolderHandler()
    const pinHandler = await getPinFolderHandler()
    const archiveHandler = await getArchiveFolderHandler()
    const folder = createFolder({ id: 'folder-1', name: 'Inbox' })
    const updateWhere = vi.fn(async () => undefined)
    const updateSet = vi.fn(() => ({
      where: updateWhere,
    }))
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => ({
            get: vi.fn(() => folder),
          })),
        })),
      })),
      query: {
        folders: {
          findFirst: vi.fn(async () => ({
            id: 'folder-1',
            pinnedAt: null,
            archivedAt: null,
          })),
        },
      },
      update: vi.fn(() => ({
        set: updateSet,
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const createResponse = await createHandler({
      body: { name: 'Inbox' },
    } as any)
    const renameResponse = await renameHandler({
      params: { id: 'folder-1' },
      body: { name: 'Inbox renamed' },
    } as any)
    const pinResponse = await pinHandler({
      params: { id: 'folder-1' },
    } as any)
    const archiveResponse = await archiveHandler({
      params: { id: 'folder-1' },
    } as any)

    expect(createResponse).toEqual(folder)
    expect(renameResponse).toEqual({ name: 'Inbox renamed' })
    expect(pinResponse.pinnedAt).toBeInstanceOf(Date)
    expect(archiveResponse.archivedAt).toBeInstanceOf(Date)
    expect(updateSet).toHaveBeenCalled()
  })

  it('deletes folders without deleting chats', async () => {
    const handler = await getDeleteFolderHandler()
    const chatsWhere = vi.fn(async () => undefined)
    const foldersWhere = vi.fn(async () => undefined)
    const chatsSet = vi.fn(() => ({
      where: chatsWhere,
    }))
    const db = {
      query: {
        folders: {
          findFirst: vi.fn(async () => ({ id: 'folder-1' })),
        },
      },
      update: vi.fn(() => ({
        set: chatsSet,
      })),
      delete: vi.fn(() => ({
        where: foldersWhere,
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { id: 'folder-1' },
    } as any)

    expect(response).toEqual({ success: true })
    expect(chatsSet).toHaveBeenCalledWith(expect.objectContaining({
      activityAt: expect.any(Date),
    }))
    expect(chatsWhere).toHaveBeenCalled()
    expect(foldersWhere).toHaveBeenCalled()
  })

  it('returns folder chats with pinned rows and a next cursor', async () => {
    const handler = await getFolderChatsHandler()
    const folder = createFolder({ id: 'folder-1', name: 'Inbox' })
    const pinnedChat = withDateFields(createHistoryChat({
      id: 'chat-pinned',
      folderId: 'folder-1',
      pinnedAt: '2026-03-11T08:00:00.000Z',
    }))
    const firstChat = withDateFields(createHistoryChat({
      id: 'chat-1',
      folderId: 'folder-1',
      activityAt: '2026-03-11T10:00:00.000Z',
    }))
    const secondChat = withDateFields(createHistoryChat({
      id: 'chat-2',
      folderId: 'folder-1',
      activityAt: '2026-03-10T10:00:00.000Z',
    }))
    const db = {
      query: {
        folders: {
          findFirst: vi.fn(async () => folder),
        },
      },
      select: vi.fn(() => createSelectChain()),
      batch: vi.fn(async () => {
        return [[pinnedChat], [firstChat, secondChat]]
      }),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { id: 'folder-1' },
      query: { limit: '2' },
    } as any)

    expect(response.folder).toEqual(folder)
    expect(response.pinned).toEqual([pinnedChat])
    expect(response.chats).toEqual([firstChat, secondChat])
    expect(response.nextCursor).toBe(createHistoryCursor(secondChat))
  })

  it('falls back to the default limit when the folder chat limit is invalid', async () => {
    const handler = await getFolderChatsHandler()
    const folder = createFolder({ id: 'folder-1', name: 'Inbox' })
    const pinnedSelectChain = createSelectChain()
    const chatsSelectChain = createSelectChain()
    const chat = withDateFields(createHistoryChat({
      id: 'chat-1',
      folderId: 'folder-1',
    }))
    const db = {
      query: {
        folders: {
          findFirst: vi.fn(async () => folder),
        },
      },
      select: vi.fn()
        .mockReturnValueOnce(pinnedSelectChain)
        .mockReturnValueOnce(chatsSelectChain),
      batch: vi.fn(async () => {
        return [[], [chat]]
      }),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { id: 'folder-1' },
      query: { limit: 'foo' },
    } as any)

    expect(response.chats).toEqual([chat])
    expect(chatsSelectChain.limit).toHaveBeenCalledWith(30)
  })
})
