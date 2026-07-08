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
  useChatProvider: vi.fn(() => ({
    provider: { id: 'openai', name: 'OpenAI' },
  })),
  getProviderResearch: vi.fn(() => ({
    assistModel: 'gpt-5.4-nano',
    levels: {
      quick: { modelId: 'o4-mini-deep-research' },
      thorough: { modelId: 'o4-mini-deep-research' },
    },
  })),
  resolveResearchModel: vi.fn(() => ({
    modelId: 'o4-mini-deep-research',
    label: 'Quick',
    costEstimate: '$',
    timeEstimate: '5m',
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
}))

vi.mock('~~/server/utils/chats/provider', () => ({
  useChatProvider: mocks.useChatProvider,
}))

vi.mock('#shared/utils/research', () => ({
  getProviderResearch: mocks.getProviderResearch,
  resolveResearchModel: mocks.resolveResearchModel,
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

async function importStart() {
  return import('../../../../server/utils/research/start')
}

function createDb(input: {
  activeJobCount?: number
  insertError?: unknown
  claimedJob?: { id: string }
} = {}) {
  const updateWhere = vi.fn(async () => undefined)
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

  return {
    db: { select, insert, update },
    update,
    updateSet,
    updateWhere,
    insert,
    insertValues,
    insertGet,
    select,
    selectWhere,
  }
}

function createInput(overrides: Partial<{
  db: ReturnType<typeof createDb>['db']
}> = {}) {
  return {
    db: overrides.db ?? createDb().db,
    event: {} as any,
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
    model: 'gpt-5.4-nano',
    level: 'quick' as const,
  }
}

describe('startResearchJobForChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useChatProvider.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' } as any,
    })
    mocks.getProviderResearch.mockReturnValue({
      assistModel: 'gpt-5.4-nano',
      levels: {
        quick: { modelId: 'o4-mini-deep-research' },
        thorough: { modelId: 'o4-mini-deep-research' },
      },
    } as any)
    mocks.resolveResearchModel.mockReturnValue({
      modelId: 'o4-mini-deep-research',
      label: 'Quick',
      costEstimate: '$',
      timeEstimate: '5m',
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
  })

  it('claims the job, rewrites the brief, and starts the provider job', async () => {
    const { db, insertValues, updateSet } = createDb()
    const { startResearchJobForChat } = await importStart()

    const result = await startResearchJobForChat(createInput({ db }))

    expect(result).toEqual({ jobId: 'job-1', status: 'running' })
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-1',
      userId: 1,
      provider: 'openai',
      level: 'quick',
      status: 'pending',
    }))
    expect(mocks.rewriteResearchBrief).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'Research this' }),
    )
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      providerJobId: 'resp_abc123',
      status: 'running',
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
})

describe('resolveResearchStartContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useChatProvider.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' } as any,
    })
    mocks.getProviderResearch.mockReturnValue({
      assistModel: 'gpt-5.4-nano',
      levels: {
        quick: { modelId: 'o4-mini-deep-research' },
        thorough: { modelId: 'o4-mini-deep-research' },
      },
    } as any)
    mocks.resolveResearchModel.mockReturnValue({
      modelId: 'o4-mini-deep-research',
      label: 'Quick',
      costEstimate: '$',
      timeEstimate: '5m',
    } as any)
    mocks.getDecryptedProviderKey.mockResolvedValue('decrypted-api-key')
  })

  it('rejects with 400 when the provider has no research capability', async () => {
    mocks.getProviderResearch.mockReturnValue(null)

    const { resolveResearchStartContext } = await importStart()

    await expect(resolveResearchStartContext({
      userId: 1,
      model: 'gpt-5.4-nano',
      level: 'quick',
    })).rejects.toMatchObject({ status: 400 })
  })

  it('rejects with 401 when no API key is saved for the provider', async () => {
    mocks.getDecryptedProviderKey.mockResolvedValue(null)

    const { resolveResearchStartContext } = await importStart()

    await expect(resolveResearchStartContext({
      userId: 1,
      model: 'gpt-5.4-nano',
      level: 'quick',
    })).rejects.toMatchObject({ status: 401 })
  })

  it('resolves the provider, research, level config, and API key', async () => {
    const { resolveResearchStartContext } = await importStart()

    const context = await resolveResearchStartContext({
      userId: 1,
      model: 'gpt-5.4-nano',
      level: 'quick',
    })

    expect(context.supportedProviderId).toBe('openai')
    expect(context.apiKey).toBe('decrypted-api-key')
    expect(context.levelConfig.modelId).toBe('o4-mini-deep-research')
  })
})
