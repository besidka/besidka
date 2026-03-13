import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
  refreshProjectActivityAt: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: mocks.markProjectsMemoryStale,
}))

vi.mock('~~/server/utils/projects/activity', () => ({
  refreshProjectActivityAt: mocks.refreshProjectActivityAt,
}))

async function getHandler() {
  const module = await import('../../../server/api/v1/chats/branch/index.post')

  return module.default
}

describe('chat branch API', () => {
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

  it('refreshes project activity and memory when branching a project chat', async () => {
    const handler = await getHandler()
    const insertValues = vi.fn(() => ({
      returning: vi.fn(() => ({
        get: vi.fn(async () => ({
          id: 'chat-2',
          slug: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
        })),
      })),
    }))
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            title: 'Roadmap',
            projectId: 'project-1',
            messages: [
              {
                id: 'message-1',
                role: 'user',
                parts: [],
                tools: [],
                reasoning: 'off',
              },
            ],
          })),
        },
      },
      insert: vi.fn(() => ({
        values: insertValues,
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      body: {
        chatSlug: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        messageId: 'message-1',
      },
    } as never)

    expect(response).toEqual({
      slug: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
    })
    expect(mocks.refreshProjectActivityAt).toHaveBeenCalledWith(
      ['project-1'],
      1,
      db,
    )
    expect(mocks.markProjectsMemoryStale).toHaveBeenCalledWith(
      ['project-1'],
      1,
      db,
    )
  })
})
