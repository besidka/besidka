import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createHistoryChat,
} from '../../setup/helpers/history-fixtures'
import { createHistoryCursor } from '../../../server/utils/chats/history/cursor'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  refreshProjectActivityAt: vi.fn(async () => undefined),
  markProjectsMemoryStale: vi.fn(async () => undefined),
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

vi.mock('~~/server/utils/projects/activity', () => ({
  refreshProjectActivityAt: mocks.refreshProjectActivityAt,
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: mocks.markProjectsMemoryStale,
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

async function getProjectMoveHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/project.patch'
  )

  return module.default
}

async function getBulkProjectMoveHandler() {
  const module = await import(
    '../../../server/api/v1/chats/history/project/bulk.post'
  )

  return module.default
}

function createSelectChain<T>(result?: T) {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => {
      if (result !== undefined) {
        return Promise.resolve(result)
      }

      return chain
    }),
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
    mocks.refreshProjectActivityAt.mockResolvedValue(undefined)

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

  it('caps pinned search matches and paginates matching chats', async () => {
    const handler = await getHistoryHandler()
    const pinnedMatch = withDateFields(createHistoryChat({
      id: 'chat-pinned',
      title: 'Roadmap pinned',
      pinnedAt: '2026-03-11T09:00:00.000Z',
    }))
    const firstMatch = withDateFields(createHistoryChat({
      id: 'chat-first',
      title: 'Roadmap beta',
      activityAt: '2026-03-10T11:00:00.000Z',
    }))
    const secondMatch = withDateFields(createHistoryChat({
      id: 'chat-second',
      title: 'Roadmap gamma',
      activityAt: '2026-03-09T11:00:00.000Z',
    }))
    const pinnedSelectChain = createSelectChain()
    const chatsSelectChain = createSelectChain()
    const contentSelectChain = createSelectChain()
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(contentSelectChain)
        .mockReturnValueOnce(chatsSelectChain)
        .mockReturnValueOnce(pinnedSelectChain)
        .mockReturnValue(contentSelectChain),
      batch: vi.fn(async () => {
        return [[pinnedMatch], [firstMatch]]
      }),
    }

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useEvent', () => ({
      query: { search: 'map', limit: '1' },
    }))
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

    const response = await handler()

    expect(response.pinned.map((chat: { id: string }) => chat.id)).toEqual([
      'chat-pinned',
    ])
    expect(response.chats.map((chat: { id: string }) => chat.id)).toEqual([
      'chat-first',
    ])
    expect(response.nextCursor).toBe(createHistoryCursor(firstMatch))
    expect(pinnedSelectChain.limit).toHaveBeenCalledWith(50)
    expect(chatsSelectChain.limit).toHaveBeenCalledWith(1)
    expect(db.batch).toHaveBeenCalledOnce()

    db.select.mockReturnValueOnce(contentSelectChain)
    db.select.mockReturnValueOnce(createSelectChain([secondMatch]))
    vi.stubGlobal('useEvent', () => ({
      query: {
        search: 'map',
        limit: '1',
        cursor: createHistoryCursor(firstMatch),
      },
    }))

    const nextPageResponse = await handler()

    expect(nextPageResponse.pinned).toEqual([])
    expect(nextPageResponse.chats).toEqual([secondMatch])
    expect(nextPageResponse.nextCursor).toBe(createHistoryCursor(secondMatch))
    expect(db.batch).toHaveBeenCalledOnce()
  })

  it('falls back to the default limit when the history limit is invalid', async () => {
    const handler = await getHistoryHandler()
    const match = withDateFields(createHistoryChat({
      id: 'chat-1',
      title: 'Roadmap alpha',
    }))
    const searchSelectChain = createSelectChain([match])
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(createSelectChain())
        .mockReturnValueOnce(searchSelectChain)
        .mockReturnValueOnce(searchSelectChain),
      batch: vi.fn(async () => {
        return [[], [match]]
      }),
    }

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useEvent', () => ({
      query: { search: 'map', limit: 'foo' },
    }))
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

    const response = await handler()

    expect(response.chats).toEqual([match])
    expect(searchSelectChain.limit).toHaveBeenCalledWith(30)
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
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            projectId: 'project-1',
          })),
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
    expect(mocks.refreshProjectActivityAt).toHaveBeenCalledWith(
      ['project-1'],
      1,
      db,
    )
  })

  it('deletes chats through single and bulk endpoints', async () => {
    const singleDeleteHandler = await getDeleteHandler()
    const bulkDeleteHandler = await getBulkDeleteHandler()
    const deleteWhere = vi.fn(async () => undefined)
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            projectId: 'project-source',
          })),
          findMany: vi.fn(async () => ([
            { projectId: 'project-source' },
            { projectId: null },
            { projectId: 'project-other' },
          ])),
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
    expect(mocks.refreshProjectActivityAt).toHaveBeenNthCalledWith(
      1,
      ['project-source'],
      1,
      db,
    )
    expect(mocks.markProjectsMemoryStale).toHaveBeenNthCalledWith(
      1,
      ['project-source'],
      1,
      db,
    )
    expect(mocks.refreshProjectActivityAt).toHaveBeenNthCalledWith(
      2,
      ['project-source', null, 'project-other'],
      1,
      db,
    )
    expect(mocks.markProjectsMemoryStale).toHaveBeenNthCalledWith(
      2,
      ['project-source', null, 'project-other'],
      1,
      db,
    )
  })

  it('pins chats, updates activity timestamps, and refreshes project activity', async () => {
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
            projectId: 'project-1',
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
    expect(mocks.refreshProjectActivityAt).toHaveBeenCalledWith(
      ['project-1'],
      1,
      db,
    )
  })

  it('moves chats into projects and refreshes source project activity for single and bulk actions', async () => {
    const singleHandler = await getProjectMoveHandler()
    const bulkHandler = await getBulkProjectMoveHandler()
    const schema = await import('../../../server/db/schema')
    const updateWhere = vi.fn(async () => undefined)
    const projectActivityWhere = vi.fn(async () => undefined)
    const updateSet = vi.fn(() => ({
      where: updateWhere,
    }))
    const projectSet = vi.fn(() => ({
      where: projectActivityWhere,
    }))
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            projectId: 'project-source',
          })),
          findMany: vi.fn(async () => ([
            { id: 'chat-1', projectId: 'project-source' },
            { id: 'chat-2', projectId: 'project-other' },
          ])),
        },
        projects: {
          findFirst: vi.fn(async () => ({ id: 'project-1' })),
        },
      },
      update: vi.fn((table: unknown) => {
        if (table === schema.projects) {
          return {
            set: projectSet,
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
      body: { projectId: 'project-1' },
    } as any)
    const bulkResponse = await bulkHandler({
      body: {
        chatIds: ['chat-1', 'chat-2'],
        projectId: 'project-1',
      },
    } as any)

    expect(singleResponse).toEqual({ projectId: 'project-1' })
    expect(bulkResponse).toEqual({ success: true })
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      activityAt: expect.any(Date),
    }))
    expect(projectSet).toHaveBeenCalledWith(expect.objectContaining({
      activityAt: expect.any(Date),
    }))
    expect(mocks.refreshProjectActivityAt).toHaveBeenNthCalledWith(
      1,
      ['project-source'],
      1,
      db,
    )
    expect(mocks.refreshProjectActivityAt).toHaveBeenNthCalledWith(
      2,
      ['project-source', 'project-other'],
      1,
      db,
    )
  })

  it('skips no-op project moves for single and bulk actions', async () => {
    const singleHandler = await getProjectMoveHandler()
    const bulkHandler = await getBulkProjectMoveHandler()
    const updateWhere = vi.fn(async () => undefined)
    const updateSet = vi.fn(() => ({
      where: updateWhere,
    }))
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            projectId: 'project-1',
          })),
          findMany: vi.fn(async () => ([
            { id: 'chat-1', projectId: 'project-1' },
            { id: 'chat-2', projectId: 'project-1' },
          ])),
        },
        projects: {
          findFirst: vi.fn(async () => ({ id: 'project-1' })),
        },
      },
      update: vi.fn(() => ({
        set: updateSet,
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const singleResponse = await singleHandler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: { projectId: 'project-1' },
    } as any)
    const bulkResponse = await bulkHandler({
      body: {
        chatIds: ['chat-1', 'chat-2'],
        projectId: 'project-1',
      },
    } as any)

    expect(singleResponse).toEqual({ projectId: 'project-1' })
    expect(bulkResponse).toEqual({ success: true })
    expect(db.query.projects.findFirst).not.toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
    expect(mocks.refreshProjectActivityAt).not.toHaveBeenCalled()
  })
})
