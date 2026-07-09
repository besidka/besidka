import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getResearchAdapter: vi.fn(),
  mockResearchAdapter: { cancel: vi.fn(async () => undefined) },
  getDecryptedProviderKey: vi.fn(async () => 'decrypted-api-key'),
  loggerSet: vi.fn(),
}))

vi.mock('~~/server/utils/research/adapters', () => ({
  getResearchAdapter: mocks.getResearchAdapter,
}))

vi.mock('~~/server/utils/research/adapters/mock', () => ({
  mockResearchAdapter: mocks.mockResearchAdapter,
}))

vi.mock('~~/server/utils/research/keys', () => ({
  getDecryptedProviderKey: mocks.getDecryptedProviderKey,
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
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  providerJobId: string | null
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
  chat?: { id: string } | null
  job?: ReturnType<typeof createJob> | null
  updatedJob?: ReturnType<typeof createJob> | null
  refetchedJob?: ReturnType<typeof createJob>
} = {}) {
  const returningGet = vi.fn(async () => (
    input.updatedJob === undefined
      ? { ...createJob(), status: 'cancelled' as const }
      : input.updatedJob
  ))
  const where = vi.fn(() => ({
    returning: vi.fn(() => ({ get: returningGet })),
  }))
  const set = vi.fn(() => ({ where }))
  const update = vi.fn(() => ({ set }))
  const researchJobsFindFirstCalls: unknown[] = []
  const researchJobsFindFirst = vi.fn(async (query: unknown) => {
    researchJobsFindFirstCalls.push(query)

    if (researchJobsFindFirstCalls.length === 1) {
      return input.job === undefined ? createJob() : input.job
    }

    return input.refetchedJob ?? input.job ?? createJob()
  })

  return {
    db: {
      query: {
        chats: {
          findFirst: vi.fn(async () => (
            input.chat === undefined ? { id: 'chat-1' } : input.chat
          )),
        },
        researchJobs: { findFirst: researchJobsFindFirst },
      },
      update,
    },
    update,
    set,
    where,
    returningGet,
    researchJobsFindFirst,
  }
}

async function getCancelHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/research/cancel.post'
  )

  return module.default
}

describe('research cancel API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.getDecryptedProviderKey.mockResolvedValue('decrypted-api-key')

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
    useRuntimeConfig().researchMockEnabled = false
  })

  it('cancels the provider job and marks it cancelled', async () => {
    const cancel = vi.fn(async () => undefined)

    mocks.getResearchAdapter.mockReturnValue({ cancel })

    const handler = await getCancelHandler()
    const { db, set } = createDb({ job: createJob({ status: 'running' }) })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(cancel).toHaveBeenCalledWith('resp_abc123', 'decrypted-api-key')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
    }))
    expect(response.job.status).toBe('cancelled')
  })

  it('is idempotent for an already-terminal job', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      cancel: vi.fn(async () => undefined),
    })

    const handler = await getCancelHandler()
    const { db, update } = createDb({
      job: createJob({ status: 'completed' }),
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(update).not.toHaveBeenCalled()
    expect(response.job.status).toBe('completed')
  })

  it('still marks the job cancelled if the provider cancel call fails', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      cancel: vi.fn(async () => {
        throw new Error('provider unavailable')
      }),
    })

    const handler = await getCancelHandler()
    const { db, set } = createDb({ job: createJob({ status: 'pending' }) })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
    }))
    expect(response.job.status).toBe('cancelled')
  })

  it('404s when no research job exists for the chat', async () => {
    const handler = await getCancelHandler()
    const { db } = createDb({ job: null })

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)).rejects.toThrow('No research job found for this chat.')
  })

  it('404s when the chat belongs to another user', async () => {
    const handler = await getCancelHandler()
    const { db } = createDb({ chat: null })

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)).rejects.toThrow('Chat not found.')
  })

  it('routes to the mock adapter when mock mode is enabled and the job carries the mock_ sentinel', async () => {
    useRuntimeConfig().researchMockEnabled = true
    mocks.getResearchAdapter.mockReturnValue({
      cancel: vi.fn(async () => undefined),
    })

    const handler = await getCancelHandler()
    const { db } = createDb({
      job: createJob({
        status: 'running',
        providerJobId: 'mock_1234_ABCDEF',
      }),
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(mocks.mockResearchAdapter.cancel).toHaveBeenCalledWith(
      'mock_1234_ABCDEF',
      'decrypted-api-key',
    )
    expect(mocks.getResearchAdapter).not.toHaveBeenCalled()
    expect(response.job.status).toBe('cancelled')
  })

  it('does not route to the mock adapter when mock mode is disabled, even for a mock_ sentinel job id', async () => {
    useRuntimeConfig().researchMockEnabled = false
    const cancel = vi.fn(async () => undefined)

    mocks.getResearchAdapter.mockReturnValue({ cancel })

    const handler = await getCancelHandler()
    const { db } = createDb({
      job: createJob({
        status: 'running',
        providerJobId: 'mock_1234_ABCDEF',
      }),
    })

    vi.stubGlobal('useDb', () => db)

    await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(cancel).toHaveBeenCalledWith('mock_1234_ABCDEF', 'decrypted-api-key')
    expect(mocks.mockResearchAdapter.cancel).not.toHaveBeenCalled()
  })

  it('returns the re-fetched job state when the guarded cancel update is raced by a finalize', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      cancel: vi.fn(async () => undefined),
    })

    const handler = await getCancelHandler()
    const { db } = createDb({
      job: createJob({ status: 'running' }),
      updatedJob: null,
      refetchedJob: createJob({
        status: 'completed',
        resultMessageId: 'assistant-1',
      }),
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.job.status).toBe('completed')
    expect(response.job.resultMessageId).toBe('assistant-1')
  })
})
