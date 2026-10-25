import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import {
  createProject,
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
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
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

async function getProjectsHandler() {
  const module = await import('../../../server/api/v1/projects/index.get')

  return module.default
}

async function getCreateProjectHandler() {
  const module = await import('../../../server/api/v1/projects/index.put')

  return module.default
}

async function getRenameProjectHandler() {
  const module = await import('../../../server/api/v1/projects/[id]/name.patch')

  return module.default
}

async function getProjectHandler() {
  const module = await import('../../../server/api/v1/projects/[id]/index.get')

  return module.default
}

async function getUpdateProjectInstructionsHandler() {
  const module = await import(
    '../../../server/api/v1/projects/[id]/instructions.patch'
  )

  return module.default
}

async function getRefreshProjectMemoryHandler() {
  const module = await import(
    '../../../server/api/v1/projects/[id]/memory/refresh.post'
  )

  return module.default
}

async function getPinProjectHandler() {
  const module = await import('../../../server/api/v1/projects/[id]/pin.post')

  return module.default
}

async function getArchiveProjectHandler() {
  const module = await import('../../../server/api/v1/projects/[id]/archive.post')

  return module.default
}

async function getDeleteProjectHandler() {
  const module = await import('../../../server/api/v1/projects/[id]/index.delete')

  return module.default
}

async function getProjectChatsHandler() {
  const module = await import('../../../server/api/v1/projects/[id]/chats.get')

  return module.default
}

const sqlDialect = drizzle(new Database(':memory:')).dialect

function getCompiledWhereParams(chain: {
  where: { mock: { calls: unknown[][] } }
}) {
  const [condition] = chain.where.mock.calls[0] as [never]

  return sqlDialect.sqlToQuery(condition).params
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

describe('projects API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('assertNotCrossSiteRequest', vi.fn())
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
    vi.stubGlobal('getRouterParams', (
      event: { params: unknown },
    ) => {
      return event.params
    })
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
  })

  it('lists projects with search, sort, and archive filters', async () => {
    const handler = await getProjectsHandler()
    const pinnedProject = createProject({
      id: 'project-pinned',
      pinnedAt: '2026-03-11T08:00:00.000Z',
    })
    const activeProject = createProject({ id: 'project-active', name: 'Alpha' })
    const db = {
      select: vi.fn(() => createSelectChain()),
      batch: vi.fn(async () => {
        return [[pinnedProject], [activeProject]]
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
      pinned: [pinnedProject],
      projects: [activeProject],
      nextCursor: null,
    })
  })

  it.each([
    ['ножі', ['%ножі%', '%НОЖІ%', '%Ножі%']],
    ['польщі', ['%польщі%', '%ПОЛЬЩІ%', '%Польщі%']],
    ['н', ['%н%', '%Н%']],
  ])('matches Cyrillic project search %s in any letter case', async (
    search,
    expectedParams,
  ) => {
    const handler = await getProjectsHandler()
    const project = createProject({ id: 'project-cyrillic', name: 'Ножі' })
    const projectsChain = createSelectChain()
    const pinnedChain = createSelectChain()
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(projectsChain)
        .mockReturnValueOnce(pinnedChain),
      batch: vi.fn(async () => [[], [project]]),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({ query: { search } } as any)

    expect(response.projects).toEqual([project])
    expect(getCompiledWhereParams(projectsChain)).toEqual(
      expect.arrayContaining(expectedParams),
    )
    expect(getCompiledWhereParams(pinnedChain)).toEqual(
      expect.arrayContaining(expectedParams),
    )
  })

  it('creates, renames, pins, and archives projects', async () => {
    const createHandler = await getCreateProjectHandler()
    const renameHandler = await getRenameProjectHandler()
    const pinHandler = await getPinProjectHandler()
    const archiveHandler = await getArchiveProjectHandler()
    const project = createProject({ id: 'project-1', name: 'Inbox' })
    const updateWhere = vi.fn(async () => undefined)
    const updateSet = vi.fn(() => ({
      where: updateWhere,
    }))
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => ({
            get: vi.fn(() => project),
          })),
        })),
      })),
      query: {
        projects: {
          findFirst: vi.fn(async () => ({
            id: 'project-1',
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
      params: { id: 'project-1' },
      body: { name: 'Inbox renamed' },
    } as any)
    const pinResponse = await pinHandler({
      params: { id: 'project-1' },
    } as any)
    const archiveResponse = await archiveHandler({
      params: { id: 'project-1' },
    } as any)

    expect(createResponse).toEqual(project)
    expect(renameResponse).toEqual({ name: 'Inbox renamed' })
    expect(pinResponse.pinnedAt).toBeInstanceOf(Date)
    expect(archiveResponse.archivedAt).toBeInstanceOf(Date)
    expect(updateSet).toHaveBeenCalled()
  })

  it('returns a project with instructions and updates them', async () => {
    const getHandler = await getProjectHandler()
    const updateInstructionsHandler
      = await getUpdateProjectInstructionsHandler()
    const project = createProject({
      id: 'project-1',
      instructions: 'Stay focused on roadmap tasks',
    })
    const updateWhere = vi.fn(async () => undefined)
    const updateSet = vi.fn(() => ({
      where: updateWhere,
    }))
    const db = {
      query: {
        projects: {
          findFirst: vi.fn()
            .mockResolvedValueOnce(project)
            .mockResolvedValueOnce({ id: 'project-1' }),
        },
      },
      update: vi.fn(() => ({
        set: updateSet,
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const getResponse = await getHandler({
      params: { id: 'project-1' },
    } as any)
    const updateResponse = await updateInstructionsHandler({
      params: { id: 'project-1' },
      body: { instructions: 'Keep answers concise' },
    } as any)

    expect(getResponse).toEqual(project)
    expect(updateResponse).toEqual({
      instructions: 'Keep answers concise',
    })
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      instructions: 'Keep answers concise',
      updatedAt: expect.any(Date),
    }))
    expect(updateWhere).toHaveBeenCalled()
  })

  it.each([
    ['without a live lease', null, 'stale'],
    ['with a live lease', '1', 'refreshing'],
  ])('reports a refreshing project %s as %s', async (
    _label,
    leaseValue,
    expectedStatus,
  ) => {
    const getHandler = await getProjectHandler()
    const project = createProject({
      id: 'project-1',
      memoryStatus: 'refreshing',
    })
    const kv = { get: vi.fn(async () => leaseValue) }
    const db = {
      query: {
        projects: {
          findFirst: vi.fn().mockResolvedValue(project),
        },
      },
    }

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useKV', () => kv)

    const response = await getHandler({
      params: { id: 'project-1' },
    } as any)

    expect(kv.get).toHaveBeenCalledWith(
      'project-memory-refreshing:project-1',
    )
    expect(response).toEqual({ ...project, memoryStatus: expectedStatus })
  })

  it('does not read the lease for a project that is not refreshing', async () => {
    const getHandler = await getProjectHandler()
    const project = createProject({ id: 'project-1', memoryStatus: 'ready' })
    const kv = { get: vi.fn(async () => null) }
    const db = {
      query: {
        projects: {
          findFirst: vi.fn().mockResolvedValue(project),
        },
      },
    }

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useKV', () => kv)

    const response = await getHandler({
      params: { id: 'project-1' },
    } as any)

    expect(kv.get).not.toHaveBeenCalled()
    expect(response).toEqual(project)
  })

  it('refreshes project memory through the refresh endpoint', async () => {
    const refreshProjectMemoryFromChats = vi.fn(async () => ({
      projectId: 'project-1',
      memoryStatus: 'ready',
      memoryUpdatedAt: '2026-03-13T09:00:00.000Z',
      memoryDirtyAt: null,
      memoryProvider: 'google',
      memoryModel: 'gemini-2.5-flash-lite',
      memoryError: null,
      usesEntries: true,
      legacyMemory: null,
      total: 0,
      groups: [],
    }))

    vi.doMock('../../../server/utils/projects/memory-refresh', () => ({
      refreshProjectMemoryFromChats,
    }))

    const handler = await getRefreshProjectMemoryHandler()
    const response = await handler({
      params: { id: 'project-1' },
    } as any)

    expect(refreshProjectMemoryFromChats).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 1,
      logger: expect.objectContaining({ set: expect.any(Function) }),
    })
    expect(response).toMatchObject({
      memoryStatus: 'ready',
      memoryProvider: 'google',
      memoryModel: 'gemini-2.5-flash-lite',
    })
  })

  it('deletes projects without deleting chats', async () => {
    const handler = await getDeleteProjectHandler()
    const chatsWhere = vi.fn(async () => undefined)
    const projectsWhere = vi.fn(async () => undefined)
    const chatsSet = vi.fn(() => ({
      where: chatsWhere,
    }))
    const db = {
      query: {
        projects: {
          findFirst: vi.fn(async () => ({ id: 'project-1' })),
        },
      },
      update: vi.fn(() => ({
        set: chatsSet,
      })),
      delete: vi.fn(() => ({
        where: projectsWhere,
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { id: 'project-1' },
    } as any)

    expect(response).toEqual({ success: true })
    expect(chatsSet).toHaveBeenCalledWith(expect.objectContaining({
      activityAt: expect.any(Date),
    }))
    expect(chatsWhere).toHaveBeenCalled()
    expect(projectsWhere).toHaveBeenCalled()
  })

  it('returns project chats with pinned rows and a next cursor', async () => {
    const handler = await getProjectChatsHandler()
    const project = createProject({ id: 'project-1', name: 'Inbox' })
    const pinnedChat = withDateFields(createHistoryChat({
      id: 'chat-pinned',
      projectId: 'project-1',
      pinnedAt: '2026-03-11T08:00:00.000Z',
    }))
    const firstChat = withDateFields(createHistoryChat({
      id: 'chat-1',
      projectId: 'project-1',
      activityAt: '2026-03-11T10:00:00.000Z',
    }))
    const secondChat = withDateFields(createHistoryChat({
      id: 'chat-2',
      projectId: 'project-1',
      activityAt: '2026-03-10T10:00:00.000Z',
    }))
    const db = {
      query: {
        projects: {
          findFirst: vi.fn(async () => project),
        },
      },
      select: vi.fn(() => createSelectChain()),
      batch: vi.fn(async () => {
        return [[pinnedChat], [firstChat, secondChat]]
      }),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { id: 'project-1' },
      query: { limit: '2' },
    } as any)

    expect(response.project).toEqual(project)
    expect(response.pinned).toEqual([pinnedChat])
    expect(response.chats).toEqual([firstChat, secondChat])
    expect(response.nextCursor).toBe(createHistoryCursor(secondChat))
  })

  it('falls back to the default limit when the project chat limit is invalid', async () => {
    const handler = await getProjectChatsHandler()
    const project = createProject({ id: 'project-1', name: 'Inbox' })
    const pinnedSelectChain = createSelectChain()
    const chatsSelectChain = createSelectChain()
    const chat = withDateFields(createHistoryChat({
      id: 'chat-1',
      projectId: 'project-1',
    }))
    const db = {
      query: {
        projects: {
          findFirst: vi.fn(async () => project),
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
      params: { id: 'project-1' },
      query: { limit: 'foo' },
    } as any)

    expect(response.chats).toEqual([chat])
    expect(chatsSelectChain.limit).toHaveBeenCalledWith(30)
  })
})
