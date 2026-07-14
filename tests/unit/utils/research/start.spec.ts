import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Walks a drizzle `SQL` expression's `queryChunks` tree collecting column
// names and literal/param values as plain tokens, without ever invoking a
// column's driver-value mapper. The `id` column uses a hashids-backed custom
// type (see server/utils/custom-db-types.ts) that throws on a non-hashid
// fixture id, so this stays purely structural instead of compiling real SQL.
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
  getModel: vi.fn(() => ({
    model: { id: 'o4-mini-deep-research' },
    provider: { id: 'openai', name: 'OpenAI' },
  })),
  getModelResearch: vi.fn(() => ({
    tier: 'quick',
    assistModel: 'gpt-5.4-nano',
    costEstimate: '~$1 / task',
    timeEstimate: '5–15 min',
    maxToolCalls: 30,
  })),
  getDecryptedProviderKey: vi.fn(async () => 'decrypted-api-key'),
  buildResearchAssistModelInstance: vi.fn(async () => ({}) as any),
  rewriteResearchBrief: vi.fn(async () => 'rewritten brief'),
  getResearchAdapter: vi.fn(() => ({
    start: vi.fn(async () => ({
      providerJobId: 'resp_abc123',
      status: 'running',
    })),
  })),
  mockResearchAdapter: {
    start: vi.fn(async () => ({
      providerJobId: 'mock_1234_ABCDEF',
      status: 'running',
    })),
  },
}))

vi.mock('#shared/utils/model', () => ({
  getModel: mocks.getModel,
}))

vi.mock('#shared/utils/research', () => ({
  getModelResearch: mocks.getModelResearch,
}))

vi.mock('~~/server/utils/research/keys', () => ({
  getDecryptedProviderKey: mocks.getDecryptedProviderKey,
}))

vi.mock('~~/server/utils/research/assist-model', () => ({
  buildResearchAssistModelInstance: mocks.buildResearchAssistModelInstance,
}))

vi.mock('~~/server/utils/research/clarify', () => ({
  rewriteResearchBrief: mocks.rewriteResearchBrief,
}))

vi.mock('~~/server/utils/research/adapters', () => ({
  getResearchAdapter: mocks.getResearchAdapter,
}))

vi.mock('~~/server/utils/research/adapters/mock', () => ({
  mockResearchAdapter: mocks.mockResearchAdapter,
}))

async function importStart() {
  return import('../../../../server/utils/research/start')
}

function createDb(input: {
  activeJobCount?: number
  insertError?: unknown
  claimedJob?: { id: string }
  startUpdateReturnsUndefined?: boolean
  startUpdateError?: unknown
  currentJob?: Record<string, unknown> | null
} = {}) {
  const startUpdateGet = input.startUpdateError
    ? vi.fn(async () => {
      throw input.startUpdateError
    })
    : vi.fn(async () => (
      input.startUpdateReturnsUndefined ? undefined : { id: 'job-1' }
    ))
  const returning = vi.fn(() => ({ get: startUpdateGet }))
  const updateWhere = vi.fn(() => ({ returning }))
  const updateSet = vi.fn(() => ({ where: updateWhere }))
  const update = vi.fn(() => ({ set: updateSet }))
  const insertGet = input.insertError
    ? vi.fn(async () => {
      throw input.insertError
    })
    : vi.fn(async () => input.claimedJob ?? { id: 'job-1' })
  const insertValues = vi.fn(() => ({
    returning: vi.fn(() => ({ get: insertGet })),
  }))
  const insert = vi.fn(() => ({ values: insertValues }))
  const selectWhere = vi.fn(async () => [
    { total: input.activeJobCount ?? 0 },
  ])
  const selectFrom = vi.fn(() => ({ where: selectWhere }))
  const select = vi.fn(() => ({ from: selectFrom }))
  const researchJobsFindFirst = vi.fn(async () => (
    input.currentJob === undefined ? null : input.currentJob
  ))

  return {
    db: {
      select,
      insert,
      update,
      query: {
        researchJobs: { findFirst: researchJobsFindFirst },
      },
    },
    update,
    updateSet,
    updateWhere,
    returning,
    startUpdateGet,
    insert,
    insertValues,
    insertGet,
    select,
    selectWhere,
    researchJobsFindFirst,
  }
}

function createRequestEvent(host = 'app.besidka.com') {
  return {
    node: {
      req: {
        headers: {
          host,
          'x-forwarded-proto': 'https',
        },
        originalUrl: '/api/v1/chats/chat-slug-1/research',
      },
    },
  } as any
}

function createInput(overrides: Partial<{
  db: ReturnType<typeof createDb>['db']
  event: any
  answers: { id: string, question: string, answer: string }[]
}> = {}) {
  return {
    db: overrides.db ?? createDb().db,
    event: overrides.event ?? createRequestEvent(),
    logger: { set: vi.fn() },
    userId: 1,
    chat: {
      id: 'chat-1',
      slug: 'chat-slug-1',
      projectId: null,
    },
    userMessage: {
      id: 'user-message-1',
      parts: [{ type: 'text', text: 'Research this' }] as UIMessage['parts'],
    },
    model: 'o4-mini-deep-research',
    answers: overrides.answers,
  }
}

describe('startResearchJobForChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getModel.mockReturnValue({
      model: { id: 'o4-mini-deep-research' } as any,
      provider: { id: 'openai', name: 'OpenAI' } as any,
    })
    mocks.getModelResearch.mockReturnValue({
      tier: 'quick',
      assistModel: 'gpt-5.4-nano',
      costEstimate: '~$1 / task',
      timeEstimate: '5–15 min',
      maxToolCalls: 30,
    } as any)
    mocks.getDecryptedProviderKey.mockResolvedValue('decrypted-api-key')
    mocks.buildResearchAssistModelInstance.mockResolvedValue({} as any)
    mocks.rewriteResearchBrief.mockResolvedValue('rewritten brief')
    mocks.getResearchAdapter.mockReturnValue({
      start: vi.fn(async () => ({
        providerJobId: 'resp_abc123',
        status: 'running',
      })),
    } as any)
    mocks.mockResearchAdapter.start.mockResolvedValue({
      providerJobId: 'mock_1234_ABCDEF',
      status: 'running',
    } as any)
    useRuntimeConfig().researchMockEnabled = false
  })

  it('claims the job, rewrites the brief, and starts the provider job', async () => {
    const { db, insertValues, updateSet } = createDb()
    const { startResearchJobForChat } = await importStart()

    const result = await startResearchJobForChat(createInput({ db }))

    expect(result).toEqual({
      job: expect.objectContaining({
        publicId: 'job-1',
        status: 'running',
        provider: 'openai',
        level: 'quick',
        modelId: 'o4-mini-deep-research',
        error: null,
        resultMessageId: null,
      }),
    })
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-1',
      userId: 1,
      provider: 'openai',
      level: 'quick',
      modelId: 'o4-mini-deep-research',
      status: 'pending',
      origin: 'https://app.besidka.com',
    }))
    expect(mocks.rewriteResearchBrief).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'Research this' }),
    )
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      providerJobId: 'resp_abc123',
      status: 'running',
    }))
  })

  it('persists the submitted clarify answers on the claim insert and returns them on the job', async () => {
    const { db, insertValues } = createDb()
    const { startResearchJobForChat } = await importStart()
    const answers = [
      { id: 'q1', question: 'What is your budget?', answer: 'Under $500' },
      { id: 'q2', question: 'Preferred brand?', answer: 'No preference' },
    ]

    const result = await startResearchJobForChat(createInput({
      db,
      answers,
    }))

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      answers,
    }))
    expect(result.job.answers).toEqual(answers)
  })

  it('stores null answers when no clarify answers are submitted', async () => {
    const { db, insertValues } = createDb()
    const { startResearchJobForChat } = await importStart()

    const result = await startResearchJobForChat(createInput({ db }))

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      answers: null,
    }))
    expect(result.job.answers).toBeNull()
  })

  it('filters out empty-string answers before persisting and rewriting the brief', async () => {
    const { db, insertValues } = createDb()
    const { startResearchJobForChat } = await importStart()
    const answers = [
      { id: 'q1', question: 'What is your budget?', answer: 'Under $500' },
      { id: 'q2', question: 'Preferred brand?', answer: '   ' },
    ]

    const result = await startResearchJobForChat(createInput({
      db,
      answers,
    }))

    const expectedAnswers = [
      { id: 'q1', question: 'What is your budget?', answer: 'Under $500' },
    ]

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      answers: expectedAnswers,
    }))
    expect(result.job.answers).toEqual(expectedAnswers)
    expect(mocks.rewriteResearchBrief).toHaveBeenCalledWith(
      expect.objectContaining({ answers: expectedAnswers }),
    )
  })

  it('stores null answers when every submitted answer is blank', async () => {
    const { db, insertValues } = createDb()
    const { startResearchJobForChat } = await importStart()
    const answers = [
      { id: 'q1', question: 'What is your budget?', answer: '' },
      { id: 'q2', question: 'Preferred brand?', answer: '   ' },
    ]

    const result = await startResearchJobForChat(createInput({
      db,
      answers,
    }))

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      answers: null,
    }))
    expect(result.job.answers).toBeNull()
  })

  it('logs a deep-research feature discriminator at the start of the run', async () => {
    const { db } = createDb()
    const { startResearchJobForChat } = await importStart()
    const input = createInput({ db })

    await startResearchJobForChat(input)

    expect(input.logger.set).toHaveBeenCalledWith({
      feature: 'deep-research',
    })
  })

  it('claims the job with an undefined origin when the request URL cannot be derived', async () => {
    const { db, insertValues } = createDb()
    const { startResearchJobForChat } = await importStart()

    await startResearchJobForChat(createInput({ db, event: {} as any }))

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      origin: undefined,
    }))
  })

  it('classifies a unique-constraint insert failure as a 409 conflict', async () => {
    const { db } = createDb({
      insertError: new Error(
        'UNIQUE constraint failed: uq_research_jobs_chat_active on'
        + ' research_jobs',
      ),
    })
    const { startResearchJobForChat } = await importStart()

    await expect(startResearchJobForChat(createInput({ db })))
      .rejects.toMatchObject({ status: 409 })

    expect(mocks.rewriteResearchBrief).not.toHaveBeenCalled()
    expect(mocks.buildResearchAssistModelInstance).not.toHaveBeenCalled()
  })

  it('normalizes a non-conflict DB error into a generic 500', async () => {
    const { db } = createDb({
      insertError: new Error('D1_ERROR: no such column: foo'),
    })
    const { startResearchJobForChat } = await importStart()
    let caughtError: any

    try {
      await startResearchJobForChat(createInput({ db }))
    } catch (exception) {
      caughtError = exception
    }

    expect(caughtError.status).toBe(500)
    expect(caughtError.message).not.toContain('D1_ERROR')
    expect(caughtError.message).not.toContain('no such column')
  })

  it('marks the claimed job failed with a status-guarded update when the adapter rejects', async () => {
    mocks.getResearchAdapter.mockReturnValue({
      start: vi.fn(async () => {
        throw new Error('provider unavailable')
      }),
    } as any)

    const { db, updateWhere } = createDb({ claimedJob: { id: 'job-99' } })
    const { startResearchJobForChat } = await importStart()

    await expect(startResearchJobForChat(createInput({ db })))
      .rejects.toMatchObject({ status: 500 })

    expect(updateWhere).toHaveBeenCalledTimes(1)

    const renderedWhere = renderWhereTokens(updateWhere.mock.calls[0][0])

    expect(renderedWhere).toContain('status')
    expect(renderedWhere).toContain('pending')
    expect(renderedWhere).toContain('running')
  })

  it('returns the job\'s real state and cancels the provider job when it was cancelled during start', async () => {
    const cancel = vi.fn(async () => undefined)

    mocks.getResearchAdapter.mockReturnValue({
      start: vi.fn(async () => ({
        providerJobId: 'resp_abc123',
        status: 'running',
      })),
      cancel,
    })

    const { db, researchJobsFindFirst } = createDb({
      startUpdateReturnsUndefined: true,
      currentJob: {
        id: 'job-1',
        status: 'cancelled',
        provider: 'openai',
        level: 'quick',
        modelId: 'o4-mini-deep-research',
        startedAt: null,
        error: null,
        resultMessageId: null,
      },
    })
    const { startResearchJobForChat } = await importStart()

    const result = await startResearchJobForChat(createInput({ db }))

    expect(result).toEqual({
      job: expect.objectContaining({
        publicId: 'job-1',
        status: 'cancelled',
      }),
    })
    expect(cancel).toHaveBeenCalledWith('resp_abc123', 'decrypted-api-key')
    expect(researchJobsFindFirst).toHaveBeenCalledTimes(1)
  })

  it('cancels the provider job and marks the row failed when storing the provider job id throws', async () => {
    const cancel = vi.fn(async () => undefined)

    mocks.getResearchAdapter.mockReturnValue({
      start: vi.fn(async () => ({
        providerJobId: 'resp_abc123',
        status: 'running',
      })),
      cancel,
    })

    const { db, updateWhere } = createDb({
      startUpdateError: new Error('D1_ERROR: write failed'),
    })
    const { startResearchJobForChat } = await importStart()

    await expect(startResearchJobForChat(createInput({ db })))
      .rejects.toMatchObject({ status: 500 })

    expect(cancel).toHaveBeenCalledWith('resp_abc123', 'decrypted-api-key')
    expect(updateWhere).toHaveBeenCalledTimes(2)

    const renderedFailureWhere = renderWhereTokens(
      updateWhere.mock.calls[1][0],
    )

    expect(renderedFailureWhere).toContain('status')
    expect(renderedFailureWhere).toContain('pending')
    expect(renderedFailureWhere).toContain('running')
  })

  it('rejects with 429 when the user already has 3 active research jobs', async () => {
    const { db, insert } = createDb({ activeJobCount: 3 })
    const { startResearchJobForChat } = await importStart()

    await expect(startResearchJobForChat(createInput({ db })))
      .rejects.toMatchObject({ status: 429 })

    expect(insert).not.toHaveBeenCalled()
    expect(mocks.rewriteResearchBrief).not.toHaveBeenCalled()
  })

  it('does not call rewriteResearchBrief when claiming the job throws a 409', async () => {
    const { db } = createDb({
      insertError: new Error(
        'UNIQUE constraint failed: uq_research_jobs_chat_active on'
        + ' research_jobs',
      ),
    })
    const { startResearchJobForChat } = await importStart()

    await expect(startResearchJobForChat(createInput({ db })))
      .rejects.toMatchObject({ status: 409 })

    expect(mocks.rewriteResearchBrief).not.toHaveBeenCalled()
  })

  it('routes to the mock adapter when mock mode is enabled and the topic is prefixed with mock:', async () => {
    useRuntimeConfig().researchMockEnabled = true

    const { db } = createDb()
    const { startResearchJobForChat } = await importStart()
    const input = {
      ...createInput({ db }),
      userMessage: {
        id: 'user-message-1',
        parts: [
          { type: 'text', text: 'mock: best espresso machines' },
        ] as UIMessage['parts'],
      },
    }

    const result = await startResearchJobForChat(input)

    expect(result.job.status).toBe('running')
    expect(mocks.mockResearchAdapter.start).toHaveBeenCalledTimes(1)
    expect(mocks.getResearchAdapter).not.toHaveBeenCalled()
  })

  it('skips the assist-model brief rewrite and uses the raw topic as the brief in mock mode', async () => {
    useRuntimeConfig().researchMockEnabled = true

    const { db } = createDb()
    const { startResearchJobForChat } = await importStart()
    const input = {
      ...createInput({ db }),
      userMessage: {
        id: 'user-message-1',
        parts: [
          { type: 'text', text: 'mock: best espresso machines' },
        ] as UIMessage['parts'],
      },
    }

    await startResearchJobForChat(input)

    expect(mocks.mockResearchAdapter.start).toHaveBeenCalledWith(
      expect.objectContaining({ brief: 'mock: best espresso machines' }),
    )
    expect(mocks.buildResearchAssistModelInstance).not.toHaveBeenCalled()
    expect(mocks.rewriteResearchBrief).not.toHaveBeenCalled()
  })

  it('does not route to the mock adapter when the topic has no mock: prefix, even with mock mode enabled', async () => {
    useRuntimeConfig().researchMockEnabled = true

    const { db } = createDb()
    const { startResearchJobForChat } = await importStart()

    await startResearchJobForChat(createInput({ db }))

    expect(mocks.mockResearchAdapter.start).not.toHaveBeenCalled()
    expect(mocks.getResearchAdapter).toHaveBeenCalledWith('openai')
  })

  it('does not route to the mock adapter when mock mode is disabled, even with a mock: prefixed topic', async () => {
    useRuntimeConfig().researchMockEnabled = false

    const { db } = createDb()
    const { startResearchJobForChat } = await importStart()
    const input = {
      ...createInput({ db }),
      userMessage: {
        id: 'user-message-1',
        parts: [
          { type: 'text', text: 'mock: best espresso machines' },
        ] as UIMessage['parts'],
      },
    }

    await startResearchJobForChat(input)

    expect(mocks.mockResearchAdapter.start).not.toHaveBeenCalled()
    expect(mocks.getResearchAdapter).toHaveBeenCalledWith('openai')
  })
})

describe('resolveResearchStartContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getModel.mockReturnValue({
      model: { id: 'o4-mini-deep-research' } as any,
      provider: { id: 'openai', name: 'OpenAI' } as any,
    })
    mocks.getModelResearch.mockReturnValue({
      tier: 'quick',
      assistModel: 'gpt-5.4-nano',
      costEstimate: '~$1 / task',
      timeEstimate: '5–15 min',
      maxToolCalls: 30,
    } as any)
    mocks.getDecryptedProviderKey.mockResolvedValue('decrypted-api-key')
  })

  it('rejects with 400 when the model is not found', async () => {
    mocks.getModel.mockReturnValue({
      model: null as any,
      provider: null as any,
    })

    const { resolveResearchStartContext } = await importStart()

    await expect(resolveResearchStartContext({
      userId: 1,
      model: 'not-a-real-model',
    })).rejects.toMatchObject({ status: 400 })
  })

  it('rejects with 400 when the model has no research capability', async () => {
    mocks.getModelResearch.mockReturnValue(null)

    const { resolveResearchStartContext } = await importStart()

    await expect(resolveResearchStartContext({
      userId: 1,
      model: 'gpt-5.4',
    })).rejects.toMatchObject({ status: 400 })
  })

  it('rejects with 401 when no API key is saved for the provider', async () => {
    mocks.getDecryptedProviderKey.mockResolvedValue(null)

    const { resolveResearchStartContext } = await importStart()

    await expect(resolveResearchStartContext({
      userId: 1,
      model: 'o4-mini-deep-research',
    })).rejects.toMatchObject({ status: 401 })
  })

  it('resolves the provider, model, research config, and API key', async () => {
    const { resolveResearchStartContext } = await importStart()

    const context = await resolveResearchStartContext({
      userId: 1,
      model: 'o4-mini-deep-research',
    })

    expect(context.supportedProviderId).toBe('openai')
    expect(context.apiKey).toBe('decrypted-api-key')
    expect(context.model.id).toBe('o4-mini-deep-research')
    expect(context.research.tier).toBe('quick')
    expect(context.research.assistModel).toBe('gpt-5.4-nano')
  })
})
