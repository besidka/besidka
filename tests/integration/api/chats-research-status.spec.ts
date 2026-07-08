import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  finalizeResearchJob: vi.fn(async () => 'still-running'),
  loggerSet: vi.fn(),
}))

vi.mock('~~/server/utils/research/finalize', () => ({
  finalizeResearchJob: mocks.finalizeResearchJob,
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ set: mocks.loggerSet }),
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

function createJob(overrides: Partial<{
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  resultMessageId: string | null
  userId: number
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
    userMessageId: 'user-message-1',
    startedAt: new Date(),
    createdAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
    ...overrides,
  }
}

function createDb(input: {
  chat?: { id: string, slug: string } | null
  job?: ReturnType<typeof createJob> | null
  refreshedJob?: ReturnType<typeof createJob>
  message?: Record<string, unknown> | null
} = {}) {
  const chatsFindFirst = vi.fn(async () => (
    input.chat === undefined
      ? { id: 'chat-1', slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }
      : input.chat
  ))
  const findFirstCalls: unknown[] = []
  const researchJobsFindFirst = vi.fn(async (query: unknown) => {
    findFirstCalls.push(query)

    if (findFirstCalls.length === 1) {
      return input.job === undefined ? createJob() : input.job
    }

    return input.refreshedJob ?? input.job ?? createJob()
  })
  const messagesFindFirst = vi.fn(async () => input.message ?? null)

  return {
    db: {
      query: {
        chats: { findFirst: chatsFindFirst },
        researchJobs: { findFirst: researchJobsFindFirst },
        messages: { findFirst: messagesFindFirst },
      },
    },
    chatsFindFirst,
    researchJobsFindFirst,
    messagesFindFirst,
  }
}

async function getStatusHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/research/index.get'
  )

  return module.default
}

describe('research status API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.finalizeResearchJob.mockResolvedValue('still-running')

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
    vi.stubGlobal('useRuntimeConfig', () => ({
      vapidSubject: '',
      vapidPrivateKey: '',
      public: { vapidPublicKey: '' },
    }))
    vi.stubGlobal('buildVapidSubject', () => undefined)
  })

  it('returns the running status without finalizing an already-terminal job', async () => {
    const handler = await getStatusHandler()
    const { db, researchJobsFindFirst } = createDb({
      job: createJob({ status: 'running' }),
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(mocks.finalizeResearchJob).toHaveBeenCalledTimes(1)
    expect(researchJobsFindFirst).toHaveBeenCalledTimes(2)
    expect(response.job).toEqual(expect.objectContaining({
      publicId: 'job-1',
      status: 'running',
    }))
    expect(response.message).toBeUndefined()
  })

  it('returns immediately for an already-completed job without calling finalize', async () => {
    const handler = await getStatusHandler()
    const { db } = createDb({
      job: createJob({ status: 'completed', resultMessageId: 'assistant-1' }),
      message: {
        id: 'db-id',
        publicId: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Report' }],
        tools: [],
        reasoning: 'off',
        createdAt: new Date(),
        usage: null,
      },
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(mocks.finalizeResearchJob).not.toHaveBeenCalled()
    expect(response.job.status).toBe('completed')
    expect(response.message).toEqual(expect.objectContaining({
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Report' }],
    }))
  })

  it('includes the assistant message once finalize completes the job', async () => {
    mocks.finalizeResearchJob.mockResolvedValue('finalized')

    const handler = await getStatusHandler()
    const { db } = createDb({
      job: createJob({ status: 'running' }),
      refreshedJob: createJob({
        status: 'completed',
        resultMessageId: 'assistant-1',
      }),
      message: {
        id: 'db-id',
        publicId: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Report' }],
        tools: [],
        reasoning: 'off',
        createdAt: new Date(),
        usage: null,
      },
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.job.status).toBe('completed')
    expect(response.message).toEqual(expect.objectContaining({
      id: 'assistant-1',
    }))
  })

  it('is idempotent on a second GET after the job is already finalized', async () => {
    const handler = await getStatusHandler()
    const { db } = createDb({
      job: createJob({ status: 'completed', resultMessageId: 'assistant-1' }),
      message: {
        id: 'db-id',
        publicId: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Report' }],
        tools: [],
        reasoning: 'off',
        createdAt: new Date(),
        usage: null,
      },
    })

    vi.stubGlobal('useDb', () => db)

    const firstResponse = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)
    const secondResponse = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(mocks.finalizeResearchJob).not.toHaveBeenCalled()
    expect(firstResponse).toEqual(secondResponse)
  })

  it('404s when no research job exists for the chat', async () => {
    const handler = await getStatusHandler()
    const { db } = createDb({ job: null })

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)).rejects.toThrow('No research job found for this chat.')
  })

  it('404s when the chat belongs to another user', async () => {
    const handler = await getStatusHandler()
    const { db } = createDb({ chat: null })

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)).rejects.toThrow('Chat not found.')
  })

  it('does not throw when finalize errors, and returns the last known job', async () => {
    mocks.finalizeResearchJob.mockRejectedValue(new Error('network blip'))

    const handler = await getStatusHandler()
    const { db } = createDb({ job: createJob({ status: 'running' }) })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.job.status).toBe('running')
  })
})
