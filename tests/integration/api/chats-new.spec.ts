import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateMessageFilePolicy: vi.fn(async () => undefined),
  loggerSet: vi.fn(),
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/files/file-governance', () => ({
  validateMessageFilePolicy: mocks.validateMessageFilePolicy,
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: mocks.markProjectsMemoryStale,
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
      statusCode: input.status,
      why: input.why,
    })

    return exception
  },
}))

async function getNewChatHandler() {
  const module = await import('../../../server/api/v1/chats/new/index.put')

  return module.default
}

describe('new chat API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.validateMessageFilePolicy.mockResolvedValue(undefined)
    mocks.loggerSet.mockReset()
    mocks.markProjectsMemoryStale.mockResolvedValue(undefined)

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
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
  })

  it('bumps project activity when creating a new chat inside a project', async () => {
    const handler = await getNewChatHandler()
    const chatsInsertValues = vi.fn(() => ({
      returning: vi.fn(() => ({
        get: vi.fn(() => ({
          id: 'chat-1',
          slug: 'chat-1',
        })),
      })),
    }))
    const messagesInsertValues = vi.fn(async () => undefined)
    const projectUpdateWhere = vi.fn(async () => undefined)
    const projectUpdateSet = vi.fn(() => ({
      where: projectUpdateWhere,
    }))
    const db = {
      query: {
        projects: {
          findFirst: vi.fn(async () => ({ id: 'project-1' })),
        },
      },
      insert: vi.fn()
        .mockReturnValueOnce({
          values: chatsInsertValues,
        })
        .mockReturnValueOnce({
          values: messagesInsertValues,
        }),
      update: vi.fn(() => ({
        set: projectUpdateSet,
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      body: {
        parts: [{ type: 'text', text: 'Hello' }],
        tools: [],
        reasoning: 'off',
        projectId: 'project-1',
      },
    } as any)

    expect(response).toEqual({ slug: 'chat-1' })
    expect(mocks.validateMessageFilePolicy).toHaveBeenCalledWith(
      1,
      [{ type: 'text', text: 'Hello' }],
    )
    expect(chatsInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      projectId: 'project-1',
      activityAt: expect.any(Date),
    }))
    expect(projectUpdateSet).toHaveBeenCalledWith({
      activityAt: expect.any(Date),
    })
    expect(projectUpdateWhere).toHaveBeenCalledTimes(1)
    expect(mocks.markProjectsMemoryStale).toHaveBeenCalledWith(
      ['project-1'],
      1,
      db,
    )
  })
})
