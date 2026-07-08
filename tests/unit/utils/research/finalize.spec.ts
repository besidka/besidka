import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchAdapterError } from '~~/server/utils/research/adapter-error'

// Walks a drizzle `SQL` expression's `queryChunks` tree collecting column
// names and literal/param values as plain tokens, without ever invoking a
// column's driver-value mapper. The `id` column uses a hashids-backed custom
// type (see server/utils/custom-db-types.ts) that throws on a non-hashid
// string like the "job-1" fixtures below, so rendering the real query text
// via a dialect is not an option here — this stays purely structural.
function collectSqlTokens(
  node: unknown,
  visited: Set<unknown> = new Set(),
): string[] {
  if (node === null || node === undefined || typeof node !== 'object') {
    return node === null || node === undefined ? [] : [String(node)]
  }

  if (visited.has(node)) {
    return []
  }

  visited.add(node)

  if (Array.isArray(node)) {
    return node.flatMap(item => collectSqlTokens(item, visited))
  }

  const record = node as Record<string, unknown>

  if (Array.isArray(record.queryChunks)) {
    return record.queryChunks.flatMap((chunk) => {
      return collectSqlTokens(chunk, visited)
    })
  }

  if (Array.isArray(record.value)) {
    return record.value.map(String)
  }

  if (typeof record.name === 'string') {
    return [record.name]
  }

  if ('value' in record) {
    return [String(record.value)]
  }

  return []
}

function renderWhereTokens(whereArg: unknown): string {
  return collectSqlTokens(whereArg).join(' ')
}

const mocks = vi.hoisted(() => ({
  getResearchAdapter: vi.fn(),
  getDecryptedProviderKey: vi.fn(async () => 'decrypted-api-key'),
  insertMessageWithPublicId: vi.fn(async () => ({
    id: 'message-db-id',
    publicId: 'assistant-public-id',
  })),
}))

vi.mock('~~/server/utils/research/adapters', () => ({
  getResearchAdapter: mocks.getResearchAdapter,
}))

vi.mock('~~/server/utils/research/keys', () => ({
  getDecryptedProviderKey: mocks.getDecryptedProviderKey,
}))

vi.mock('~~/server/utils/chats/insert-message', () => ({
  insertMessageWithPublicId: mocks.insertMessageWithPublicId,
}))

async function importFinalize() {
  return import('../../../../server/utils/research/finalize')
}

function createJob(overrides: Partial<{
  id: string
  chatId: string
  userId: number
  provider: 'openai' | 'google'
  level: 'quick' | 'thorough'
  modelId: string
  providerJobId: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  resultMessageId: string | null
  startedAt: Date | null
  createdAt: Date
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
    usage: null,
    error: null,
    userMessageId: 'user-message-1',
    startedAt: new Date(Date.now() - 5 * 60 * 1000),
    createdAt: new Date(Date.now() - 5 * 60 * 1000),
    completedAt: null,
    updatedAt: new Date(Date.now() - 5 * 60 * 1000),
    ...overrides,
  }
}

function createUpdateMock(claimedRow: { id: string } | undefined) {
  const get = vi.fn(async () => claimedRow)
  const returning = vi.fn(() => ({ get }))
  const where = vi.fn(() => ({ returning }))
  const set = vi.fn(() => ({ where }))
  const update = vi.fn(() => ({ set }))

  return { update, set, where, returning, get }
}

function createDb(input: {
  claimedRow?: { id: string }
  chatSlug?: string
} = {}) {
  const { update, set, where } = createUpdateMock(input.claimedRow)

  return {
    db: {
      update,
      query: {
        chats: {
          findFirst: vi.fn(async () => (
            input.chatSlug ? { slug: input.chatSlug } : null
          )),
        },
      },
    },
    update,
    set,
    where,
  }
}

describe('finalizeResearchJob', () => {
  let logger: { set: ReturnType<typeof vi.fn> }
  let waitUntil: ReturnType<typeof vi.fn>
  let sendPushNotificationToUser: ReturnType<typeof vi.fn>
  let isPushConfigured: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDecryptedProviderKey.mockResolvedValue('decrypted-api-key')
    mocks.insertMessageWithPublicId.mockResolvedValue({
      id: 'message-db-id',
      publicId: 'assistant-public-id',
    })
    logger = { set: vi.fn() }
    waitUntil = vi.fn((promise: Promise<unknown>) => promise)
    sendPushNotificationToUser = vi.fn(async () => undefined)
    isPushConfigured = vi.fn(() => true)
    vi.stubGlobal('sendPushNotificationToUser', sendPushNotificationToUser)
    vi.stubGlobal('isPushConfigured', isPushConfigured)
  })

  it('is a no-op when the job already completed with a result message', async () => {
    const { finalizeResearchJob } = await importFinalize()
    const { db } = createDb()
    const job = createJob({ status: 'completed', resultMessageId: 'msg-1' })

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: job as any,
      vapid: {},
      logger,
    })

    expect(outcome).toBe('already-finalized')
    expect(mocks.getDecryptedProviderKey).not.toHaveBeenCalled()
  })

  it('is a no-op when the job already terminated as failed or cancelled', async () => {
    const { finalizeResearchJob } = await importFinalize()
    const { db } = createDb()

    const failedOutcome = await finalizeResearchJob({
      db: db as any,
      job: createJob({ status: 'failed' }) as any,
      vapid: {},
      logger,
    })
    const cancelledOutcome = await finalizeResearchJob({
      db: db as any,
      job: createJob({ status: 'cancelled' }) as any,
      vapid: {},
      logger,
    })

    expect(failedOutcome).toBe('failed')
    expect(cancelledOutcome).toBe('failed')
  })

  it('marks the job failed when it has no provider job id', async () => {
    const { finalizeResearchJob } = await importFinalize()
    const { db, set } = createDb()
    const job = createJob({ providerJobId: null })

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: job as any,
      vapid: {},
      logger,
    })

    expect(outcome).toBe('failed')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({ code: 'research-start-failed' }),
    }))
  })

  it('marks the job failed when the API key is no longer available', async () => {
    mocks.getDecryptedProviderKey.mockResolvedValue(null)

    const { finalizeResearchJob } = await importFinalize()
    const { db, set } = createDb()

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: createJob() as any,
      vapid: {},
      logger,
    })

    expect(outcome).toBe('failed')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({ code: 'provider-auth' }),
    }))
  })

  it('returns still-running when the status poll fails transiently', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      status: vi.fn(async () => {
        throw new Error('network blip')
      }),
    })

    const { finalizeResearchJob } = await importFinalize()
    const { db, set } = createDb()

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: createJob() as any,
      vapid: {},
      logger,
    })

    expect(outcome).toBe('still-running')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      updatedAt: expect.any(Date),
    }))
  })

  it('marks the job failed immediately when the status poll fails with a 401', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      status: vi.fn(async () => {
        throw new ResearchAdapterError(401, { message: 'Invalid API key' })
      }),
    })

    const { finalizeResearchJob } = await importFinalize()
    const { db, set } = createDb()

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: createJob() as any,
      vapid: {},
      logger,
    })

    expect(outcome).toBe('failed')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({ code: 'provider-auth' }),
    }))
  })

  it('marks the job failed immediately when the status poll fails with a 404', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      status: vi.fn(async () => {
        throw new ResearchAdapterError(404, { message: 'Not found' })
      }),
    })

    const { finalizeResearchJob } = await importFinalize()
    const { db, set } = createDb()

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: createJob() as any,
      vapid: {},
      logger,
    })

    expect(outcome).toBe('failed')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({ code: 'provider-unavailable' }),
    }))
  })

  it('marks the job failed with a timeout when the status poll keeps failing past the overall cap', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      status: vi.fn(async () => {
        throw new Error('network blip')
      }),
    })

    const { finalizeResearchJob } = await importFinalize()
    const { db, set } = createDb()
    const job = createJob({
      startedAt: new Date(Date.now() - 91 * 60 * 1000),
    })

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: job as any,
      vapid: {},
      logger,
    })

    expect(outcome).toBe('failed')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({ code: 'research-timeout' }),
    }))
  })

  it('returns still-running while the provider job is in progress', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      status: vi.fn(async () => ({ status: 'running' })),
    })

    const { finalizeResearchJob } = await importFinalize()
    const { db, set } = createDb()

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: createJob() as any,
      vapid: {},
      logger,
    })

    expect(outcome).toBe('still-running')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      updatedAt: expect.any(Date),
    }))
  })

  it('cancels and marks the job failed once it exceeds the 90-minute cap', async () => {
    const cancel = vi.fn(async () => undefined)

    mocks.getResearchAdapter.mockReturnValue({
      status: vi.fn(async () => ({ status: 'running' })),
      cancel,
    })

    const { finalizeResearchJob } = await importFinalize()
    const { db, set } = createDb()
    const job = createJob({
      startedAt: new Date(Date.now() - 91 * 60 * 1000),
    })

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: job as any,
      vapid: {},
      logger,
    })

    expect(outcome).toBe('failed')
    expect(cancel).toHaveBeenCalledWith('resp_abc123', 'decrypted-api-key')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({ code: 'research-timeout' }),
    }))
  })

  it('marks the job cancelled when the provider reports it cancelled', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      status: vi.fn(async () => ({ status: 'cancelled' })),
    })

    const { finalizeResearchJob } = await importFinalize()
    const { db, set } = createDb()

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: createJob() as any,
      vapid: {},
      logger,
    })

    expect(outcome).toBe('failed')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      error: expect.objectContaining({ code: 'research-cancelled' }),
    }))
  })

  it('marks the job failed when the provider reports a non-completed terminal status', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      status: vi.fn(async () => ({
        status: 'failed',
        raw: { incomplete_details: { reason: 'max_tool_calls' } },
      })),
    })

    const { finalizeResearchJob } = await importFinalize()
    const { db, set } = createDb()

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: createJob() as any,
      vapid: {},
      logger,
    })

    expect(outcome).toBe('failed')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({
        code: 'provider-unavailable',
        why: 'max_tool_calls',
      }),
    }))
  })

  it('returns still-running when fetching the completed result fails transiently', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      status: vi.fn(async () => ({ status: 'completed' })),
      result: vi.fn(async () => {
        throw new Error('network blip')
      }),
    })

    const { finalizeResearchJob } = await importFinalize()
    const { db, set } = createDb()

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: createJob() as any,
      vapid: {},
      logger,
    })

    expect(outcome).toBe('still-running')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      updatedAt: expect.any(Date),
    }))
  })

  it('finalizes a completed job: persists parts, bumps chat activity, fires push once', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      status: vi.fn(async () => ({ status: 'completed' })),
      result: vi.fn(async () => ({
        reportText: 'The final report.',
        sources: [
          { sourceId: 'src-0', url: 'https://example.com/a', title: 'A' },
        ],
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      })),
    })

    const { finalizeResearchJob } = await importFinalize()
    const { db } = createDb({
      claimedRow: { id: 'job-1' },
      chatSlug: 'chat-slug-1',
    })

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: createJob() as any,
      vapid: { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.c' },
      waitUntil,
      logger,
    })

    expect(outcome).toBe('finalized')
    expect(mocks.insertMessageWithPublicId).toHaveBeenCalledTimes(1)

    const insertedValues = mocks.insertMessageWithPublicId.mock.calls[0][0]

    expect(insertedValues.values.chatId).toBe('chat-1')
    expect(insertedValues.values.role).toBe('assistant')
    expect(insertedValues.values.parts).toEqual([
      { type: 'text', text: 'The final report.' },
      {
        type: 'source-url',
        sourceId: 'src-0',
        url: 'https://example.com/a',
        title: 'A',
      },
      {
        type: 'data-research',
        data: expect.objectContaining({
          provider: 'openai',
          level: 'quick',
          modelId: 'o4-mini-deep-research',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        }),
      },
    ])
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(sendPushNotificationToUser).toHaveBeenCalledWith(
      db,
      1,
      expect.objectContaining({
        title: 'Your research is ready',
        tag: 'besidka-research-ready',
        url: '/chats/chat-slug-1',
      }),
      expect.anything(),
      waitUntil,
    )
  })

  it('reverts the completion claim when persisting the report message fails', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      status: vi.fn(async () => ({ status: 'completed' })),
      result: vi.fn(async () => ({
        reportText: 'The final report.',
        sources: [],
      })),
    })
    mocks.insertMessageWithPublicId.mockRejectedValue(
      new Error('D1 write failed'),
    )

    const { finalizeResearchJob } = await importFinalize()
    const { db, set, where } = createDb({
      claimedRow: { id: 'job-1' },
      chatSlug: 'chat-slug-1',
    })

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: createJob() as any,
      vapid: { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.c' },
      waitUntil,
      logger,
    })

    expect(outcome).toBe('still-running')
    expect(sendPushNotificationToUser).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'running',
      resultMessageId: null,
      completedAt: null,
    }))

    const renderedRevertWhere = renderWhereTokens(where.mock.calls[1][0])

    expect(renderedRevertWhere).toContain('status')
    expect(renderedRevertWhere).toContain('completed')
  })

  it('does not double-insert or double-push when the claim lock is already taken', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      status: vi.fn(async () => ({ status: 'completed' })),
      result: vi.fn(async () => ({
        reportText: 'The final report.',
        sources: [],
      })),
    })

    const { finalizeResearchJob } = await importFinalize()
    const { db } = createDb({ claimedRow: undefined })

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: createJob() as any,
      vapid: {},
      waitUntil,
      logger,
    })

    expect(outcome).toBe('already-finalized')
    expect(mocks.insertMessageWithPublicId).not.toHaveBeenCalled()
    expect(sendPushNotificationToUser).not.toHaveBeenCalled()
  })

  it('does not finalize when the completion claim is raced by a concurrent cancellation', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      status: vi.fn(async () => ({ status: 'completed' })),
      result: vi.fn(async () => ({
        reportText: 'The final report.',
        sources: [],
      })),
    })

    const { finalizeResearchJob } = await importFinalize()
    const { db, where } = createDb({ claimedRow: undefined })

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: createJob() as any,
      vapid: {},
      waitUntil,
      logger,
    })

    expect(outcome).toBe('already-finalized')
    expect(mocks.insertMessageWithPublicId).not.toHaveBeenCalled()
    expect(sendPushNotificationToUser).not.toHaveBeenCalled()
    const renderedWhere = renderWhereTokens(where.mock.calls[0][0])

    expect(renderedWhere).toContain('status')
    expect(renderedWhere).toContain('pending')
    expect(renderedWhere).toContain('running')
  })

  it('guards markJobTerminal writes so an already-terminal row cannot be overwritten', async () => {
    const { finalizeResearchJob } = await importFinalize()
    const { db, where } = createDb()
    const job = createJob({ providerJobId: null })

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: job as any,
      vapid: {},
      logger,
    })

    expect(outcome).toBe('failed')
    const renderedWhere = renderWhereTokens(where.mock.calls[0][0])

    expect(renderedWhere).toContain('status')
    expect(renderedWhere).toContain('pending')
    expect(renderedWhere).toContain('running')
  })

  it('drops non-http(s) source URLs before persisting parts', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      status: vi.fn(async () => ({ status: 'completed' })),
      result: vi.fn(async () => ({
        reportText: 'The final report.',
        sources: [
          { sourceId: 'src-0', url: 'https://example.com/a', title: 'A' },
          { sourceId: 'src-1', url: 'javascript:alert(1)', title: 'B' },
          { sourceId: 'src-2', url: 'data:text/html,<script>', title: 'C' },
        ],
      })),
    })

    const { finalizeResearchJob } = await importFinalize()
    const { db } = createDb({
      claimedRow: { id: 'job-1' },
      chatSlug: 'chat-slug-1',
    })

    const outcome = await finalizeResearchJob({
      db: db as any,
      job: createJob() as any,
      vapid: {},
      waitUntil,
      logger,
    })

    expect(outcome).toBe('finalized')

    const insertedValues = mocks.insertMessageWithPublicId.mock.calls[0][0]

    expect(insertedValues.values.parts).toEqual([
      { type: 'text', text: 'The final report.' },
      {
        type: 'source-url',
        sourceId: 'src-0',
        url: 'https://example.com/a',
        title: 'A',
      },
      {
        type: 'data-research',
        data: expect.objectContaining({ provider: 'openai' }),
      },
    ])
  })
})
