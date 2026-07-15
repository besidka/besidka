import { beforeEach, describe, expect, it, vi } from 'vitest'

function createChat(overrides: Partial<{
  id: string
  slug: string
  title: string | null
  projectId: string | null
  branchedFromShareSlug: string | null
  messages: unknown[]
}> = {}) {
  return {
    id: 'chat-1',
    slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    title: 'Test chat',
    projectId: null,
    branchedFromShareSlug: null,
    messages: [],
    ...overrides,
  }
}

function createJob(overrides: Partial<{
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  resultMessageId: string | null
  completedAt: Date | null
}> = {}) {
  return {
    id: 'job-1',
    chatId: 'chat-1',
    userId: 1,
    provider: 'openai' as const,
    level: 'quick' as const,
    modelId: 'o4-mini-deep-research',
    providerJobId: 'resp_abc123',
    status: 'running' as const,
    resultMessageId: null,
    error: null,
    usage: null,
    answers: null,
    userMessageId: 'user-message-1',
    startedAt: new Date(),
    createdAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
    ...overrides,
  }
}

function createDb(input: {
  chat?: ReturnType<typeof createChat> | null
  latestJob?: ReturnType<typeof createJob> | null
} = {}) {
  const chatsFindFirst = vi.fn(async () => (
    input.chat === undefined ? createChat() : input.chat
  ))
  const researchJobsFindFirst = vi.fn(async () => (
    input.latestJob === undefined ? null : input.latestJob
  ))

  return {
    db: {
      query: {
        chats: { findFirst: chatsFindFirst },
        researchJobs: { findFirst: researchJobsFindFirst },
      },
    },
    chatsFindFirst,
    researchJobsFindFirst,
  }
}

async function getChatHandler() {
  const module = await import('../../../server/api/v1/chats/[slug]/index.get')

  return module.default
}

describe('chat detail API — activeResearchJob visibility', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
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

  it('includes a pending job as the active research job', async () => {
    const handler = await getChatHandler()
    const { db } = createDb({
      latestJob: createJob({ status: 'pending' }),
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.activeResearchJob).toEqual(expect.objectContaining({
      publicId: 'job-1',
      status: 'pending',
    }))
  })

  it('includes a failed job completed within the last 24 hours', async () => {
    const handler = await getChatHandler()
    const { db } = createDb({
      latestJob: createJob({
        status: 'failed',
        completedAt: new Date(Date.now() - 60 * 60 * 1000),
      }),
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.activeResearchJob).toEqual(expect.objectContaining({
      publicId: 'job-1',
      status: 'failed',
    }))
  })

  it('excludes a failed job completed more than 24 hours ago', async () => {
    const handler = await getChatHandler()
    const { db } = createDb({
      latestJob: createJob({
        status: 'failed',
        completedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      }),
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.activeResearchJob).toBeNull()
  })

  it('excludes a cancelled job even when it is recent', async () => {
    const handler = await getChatHandler()
    const { db } = createDb({
      latestJob: createJob({
        status: 'cancelled',
        completedAt: new Date(),
      }),
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.activeResearchJob).toBeNull()
  })

  it('excludes a completed job since its report message already exists', async () => {
    const handler = await getChatHandler()
    const { db } = createDb({
      latestJob: createJob({
        status: 'completed',
        completedAt: new Date(),
        resultMessageId: 'assistant-1',
      }),
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.activeResearchJob).toBeNull()
  })

  it('returns null when the chat has no research jobs', async () => {
    const handler = await getChatHandler()
    const { db } = createDb({ latestJob: null })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.activeResearchJob).toBeNull()
  })
})
