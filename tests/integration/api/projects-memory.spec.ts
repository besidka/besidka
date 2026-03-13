import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: vi.fn(),
  }),
  createError: (input: {
    message?: string
    status?: number
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  refreshProjectMemory: vi.fn(async (projectId: string) => ({
    memoryStatus: 'ready',
    memory: `Memory for ${projectId}`,
    memoryProvider: 'google',
    memoryModel: 'gemini-2.5-flash-lite',
  })),
}))

async function getRefreshProjectMemoryHandler() {
  const module = await import(
    '../../../server/api/v1/projects/[id]/memory/refresh.post'
  )

  return module.default
}

async function getRefreshChatProjectContextHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/project-context/refresh.post'
  )

  return module.default
}

describe('project memory API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
      message?: string
      status?: number
      why?: string
    }) => {
      const exception = new Error(
        input.message || input.statusMessage || 'Error',
      )

      Object.assign(exception, input)

      return exception
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw (globalThis as any).createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
      })
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

  it('refreshes project memory for a project', async () => {
    const handler = await getRefreshProjectMemoryHandler()

    const response = await handler({
      params: { id: 'project-1' },
    } as never)

    expect(response).toEqual({
      memoryStatus: 'ready',
      memory: 'Memory for project-1',
      memoryProvider: 'google',
      memoryModel: 'gemini-2.5-flash-lite',
    })
  })

  it('skips chat project-context refresh when chat has no project', async () => {
    const handler = await getRefreshChatProjectContextHandler()
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            projectId: null,
          })),
        },
      },
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as never)

    expect(response).toEqual({
      memoryStatus: 'idle',
      memory: null,
      memoryProvider: null,
      memoryModel: null,
    })
  })

  it('refreshes project-context memory using the current chat project', async () => {
    const handler = await getRefreshChatProjectContextHandler()
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            projectId: 'project-2',
          })),
        },
      },
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as never)

    expect(response).toEqual({
      memoryStatus: 'ready',
      memory: 'Memory for project-2',
      memoryProvider: 'google',
      memoryModel: 'gemini-2.5-flash-lite',
    })
  })
})
