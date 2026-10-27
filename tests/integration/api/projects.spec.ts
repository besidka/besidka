import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import {
  createProject,
  createHistoryChat,
} from '../../setup/helpers/history-fixtures'
import { createHistoryCursor } from '../../../server/utils/chats/history/cursor'
import { encodePublicId } from '~~/server/utils/custom-db-types'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  unlinkKnowledgeProjectFiles: vi.fn(),
  purgeProjectKnowledgeForProject: vi.fn(),
  invalidateStorageCache: vi.fn(),
  getEffectiveRetentionDays: vi.fn(),
}))

vi.mock('~~/server/utils/knowledge/linked-files', async (importOriginal) => {
  return {
    ...await importOriginal<Record<string, unknown>>(),
    unlinkKnowledgeProjectFiles: mocks.unlinkKnowledgeProjectFiles,
  }
})

vi.mock('~~/server/utils/knowledge/purge', () => ({
  purgeProjectKnowledgeForProject: mocks.purgeProjectKnowledgeForProject,
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

vi.mock('~~/server/utils/files/file-governance', async (importOriginal) => {
  return {
    ...await importOriginal<Record<string, unknown>>(),
    getEffectiveRetentionDays: mocks.getEffectiveRetentionDays,
  }
})

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
    mocks.unlinkKnowledgeProjectFiles.mockResolvedValue(undefined)
    mocks.purgeProjectKnowledgeForProject.mockResolvedValue({
      objectsDeleted: 3,
      batches: 1,
    })
    mocks.invalidateStorageCache.mockResolvedValue(undefined)
    mocks.getEffectiveRetentionDays.mockResolvedValue(30)
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

  describe('delete project', () => {
    const PROJECT_PUBLIC_ID = encodePublicId(7)

    function createDeleteDb(callOrder: string[] = []) {
      const chatsWhere = vi.fn(async () => {
        callOrder.push('detach-chats')
      })
      const projectsWhere = vi.fn(async () => {
        callOrder.push('delete-project')
      })
      const chatsSet = vi.fn(() => ({
        where: chatsWhere,
      }))
      const db = {
        query: {
          projects: {
            findFirst: vi.fn(async () => ({ id: PROJECT_PUBLIC_ID })),
          },
        },
        update: vi.fn(() => ({
          set: chatsSet,
        })),
        delete: vi.fn(() => ({
          where: projectsWhere,
        })),
      }

      return { db, chatsSet, chatsWhere, projectsWhere }
    }

    it('deletes projects without deleting chats', async () => {
      const handler = await getDeleteProjectHandler()
      const { db, chatsSet, chatsWhere, projectsWhere } = createDeleteDb()

      vi.stubGlobal('useDb', () => db)

      const response = await handler({
        params: { id: PROJECT_PUBLIC_ID },
      } as any)

      expect(response).toEqual({ success: true })
      expect(chatsSet).toHaveBeenCalledWith(expect.objectContaining({
        activityAt: expect.any(Date),
      }))
      expect(chatsWhere).toHaveBeenCalled()
      expect(projectsWhere).toHaveBeenCalled()
    })

    it('unlinks originals before the delete and purges R2 after it', async () => {
      const handler = await getDeleteProjectHandler()
      const callOrder: string[] = []
      const { db } = createDeleteDb(callOrder)

      mocks.unlinkKnowledgeProjectFiles.mockImplementation(async () => {
        callOrder.push('unlink')
      })
      mocks.purgeProjectKnowledgeForProject.mockImplementation(async () => {
        callOrder.push('purge')

        return { objectsDeleted: 0, batches: 0 }
      })
      mocks.invalidateStorageCache.mockImplementation(async () => {
        callOrder.push('invalidate-storage')
      })
      vi.stubGlobal('useDb', () => db)

      await handler({ params: { id: PROJECT_PUBLIC_ID } } as any)

      expect(callOrder).toEqual([
        'detach-chats',
        'unlink',
        'delete-project',
        'purge',
        'invalidate-storage',
      ])
      expect(mocks.unlinkKnowledgeProjectFiles).toHaveBeenCalledWith({
        userId: 1,
        projectId: 7,
        retentionDays: 30,
      })
      expect(mocks.purgeProjectKnowledgeForProject).toHaveBeenCalledWith(1, 7)
      expect(mocks.invalidateStorageCache).toHaveBeenCalledWith(
        1,
        expect.anything(),
      )
    })

    it('passes a null retention through for a vip tier', async () => {
      const handler = await getDeleteProjectHandler()
      const { db } = createDeleteDb()

      mocks.getEffectiveRetentionDays.mockResolvedValue(null)
      vi.stubGlobal('useDb', () => db)

      await handler({ params: { id: PROJECT_PUBLIC_ID } } as any)

      expect(mocks.unlinkKnowledgeProjectFiles).toHaveBeenCalledWith(
        expect.objectContaining({ retentionDays: null }),
      )
    })

    it('still succeeds when the R2 purge fails and leaves it to the sweeper', async () => {
      const handler = await getDeleteProjectHandler()
      const { db, projectsWhere } = createDeleteDb()

      mocks.purgeProjectKnowledgeForProject.mockRejectedValue(
        new Error('R2 unavailable'),
      )
      vi.stubGlobal('useDb', () => db)

      const response = await handler({
        params: { id: PROJECT_PUBLIC_ID },
      } as any)

      expect(response).toEqual({ success: true })
      expect(projectsWhere).toHaveBeenCalled()
      expect(mocks.invalidateStorageCache).toHaveBeenCalled()
      expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
        attributes: {
          knowledgePurge: expect.objectContaining({ failed: true }),
        },
      }))
    })

    it('keeps the project when restoring the file expiry fails', async () => {
      const handler = await getDeleteProjectHandler()
      const { db, projectsWhere } = createDeleteDb()

      mocks.unlinkKnowledgeProjectFiles.mockRejectedValue(
        new Error('D1 unavailable'),
      )
      vi.stubGlobal('useDb', () => db)

      await expect(handler({
        params: { id: PROJECT_PUBLIC_ID },
      } as any)).rejects.toThrow('D1 unavailable')

      expect(projectsWhere).not.toHaveBeenCalled()
      expect(mocks.purgeProjectKnowledgeForProject).not.toHaveBeenCalled()
    })

    it('answers 404 for a missing project before touching anything', async () => {
      const handler = await getDeleteProjectHandler()
      const { db } = createDeleteDb()

      db.query.projects.findFirst.mockResolvedValue(undefined as never)
      vi.stubGlobal('useDb', () => db)

      await expect(handler({
        params: { id: PROJECT_PUBLIC_ID },
      } as any)).rejects.toMatchObject({ status: 404 })

      expect(db.update).not.toHaveBeenCalled()
      expect(mocks.unlinkKnowledgeProjectFiles).not.toHaveBeenCalled()
      expect(mocks.purgeProjectKnowledgeForProject).not.toHaveBeenCalled()
    })

    it('answers 404 when the id does not decode to an internal id', async () => {
      const handler = await getDeleteProjectHandler()
      const { db } = createDeleteDb()

      db.query.projects.findFirst.mockResolvedValue({
        id: 'not-a-public-id!',
      } as never)
      vi.stubGlobal('useDb', () => db)

      await expect(handler({
        params: { id: 'not-a-public-id!' },
      } as any)).rejects.toMatchObject({ status: 404 })

      expect(db.delete).not.toHaveBeenCalled()
    })
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
