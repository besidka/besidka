import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { SQL } from 'drizzle-orm'

const dialect = drizzle(new Database(':memory:')).dialect

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  generateChatTitle: vi.fn(async () => 'Generated title'),
  persistUserMessage: vi.fn(async () => undefined),
  startResearchJobForChat: vi.fn(async () => ({ id: 'job-1' })),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ set: mocks.loggerSet }),
  createError: (input: { message?: string }) => {
    return Object.assign(new Error(input.message || 'Error'), input)
  },
}))

vi.mock('~~/server/utils/chats/persist-user-message', () => ({
  persistUserMessage: mocks.persistUserMessage,
}))

vi.mock('~~/server/utils/research/start', () => ({
  startResearchJobForChat: mocks.startResearchJobForChat,
}))

const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FB0'
const FLAGGED_AT = new Date(1_700_000_000_000)

function stubRouteGlobals() {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
    return event.params
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
  vi.stubGlobal('useUnauthorizedError', () => {
    throw Object.assign(new Error('Unauthorized'), { status: 401 })
  })
  vi.stubGlobal('enforceKeysRateLimit', vi.fn(async () => undefined))
}

describe('chat title in a chat that holds Google data', () => {
  function createTitleDb(googleDataAt: Date | null) {
    return {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            title: null,
            projectId: null,
            googleDataAt,
            messages: [{
              parts: [{ type: 'text', text: 'Summarize the launch plan' }],
            }],
          })),
        },
        keys: {
          findFirst: vi.fn(async () => ({ paidTierConfirmedAt: null })),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn((values: { title: string }) => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => ({
              get: vi.fn(() => ({ title: values.title })),
            })),
          })),
        })),
      })),
    }
  }

  async function title(input: {
    googleDataAt: Date | null
    model: string
    gateway?: string
  }) {
    vi.stubGlobal('useDb', () => createTitleDb(input.googleDataAt))

    const { default: handler } = await import(
      '../../../server/api/v1/chats/[slug]/title.patch'
    )

    return await handler({
      params: { slug: CHAT_SLUG },
      body: {
        model: input.model,
        ...(input.gateway ? { gateway: input.gateway } : {}),
      },
    } as any)
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubRouteGlobals()

    const builder = vi.fn(async () => ({
      generateChatTitle: mocks.generateChatTitle,
    }))

    for (const name of ['useOpenAI', 'useDeepSeek', 'useGoogle']) {
      vi.stubGlobal(name, builder)
    }

    vi.stubGlobal('useGateway', builder)
    vi.stubGlobal('useChatProvider', (modelId: string) => ({
      provider: { id: modelId.startsWith('deepseek') ? 'deepseek' : 'openai' },
      model: { id: modelId },
    }))
    useRuntimeConfig().researchMockEnabled = false
  })

  it('writes the fallback title instead of calling a refused provider',
    async () => {
      const result = await title({
        googleDataAt: FLAGGED_AT,
        model: 'deepseek-flash',
      })

      expect(result).toBe('Summarize the launch plan')
      expect(mocks.generateChatTitle).not.toHaveBeenCalled()
    })

  it('never calls a gateway for the title of a flagged chat', async () => {
    const result = await title({
      googleDataAt: FLAGGED_AT,
      model: 'anthropic/claude-opus-5',
      gateway: 'openrouter',
    })

    expect(result).toBe('Summarize the launch plan')
    expect(mocks.generateChatTitle).not.toHaveBeenCalled()
  })

  it('asks an allowed provider for the title', async () => {
    expect(await title({
      googleDataAt: FLAGGED_AT,
      model: 'gpt-6.1-sol',
    })).toBe('Generated title')
  })

  it('asks any provider in a chat without Google data', async () => {
    expect(await title({
      googleDataAt: null,
      model: 'deepseek-flash',
    })).toBe('Generated title')
  })
})

describe('deep research started from a chat that holds Google data', () => {
  async function startResearch(input: {
    googleDataAt: Date | null
    model: string
    paidTierConfirmedAt?: Date | null
  }) {
    vi.stubGlobal('useDb', () => ({
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            slug: CHAT_SLUG,
            projectId: null,
            googleDataAt: input.googleDataAt,
            messages: [],
          })),
        },
        keys: {
          findFirst: vi.fn(async () => ({
            paidTierConfirmedAt: input.paidTierConfirmedAt ?? null,
          })),
        },
      },
    }))

    const { default: handler } = await import(
      '../../../server/api/v1/chats/[slug]/research/index.post'
    )

    try {
      await handler({
        params: { slug: CHAT_SLUG },
        body: {
          model: input.model,
          userMessage: {
            id: 'user-1',
            role: 'user',
            parts: [{ type: 'text', text: 'Research the market' }],
          },
        },
      } as any)

      return null
    } catch (exception) {
      return exception
    }
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubRouteGlobals()
    vi.stubGlobal('validateMessageFilePolicy', vi.fn(async () => undefined))
    vi.stubGlobal('getRequestURL', () => new URL('http://localhost/'))
  })

  it('stops Gemini research until the paid tier is confirmed', async () => {
    const error = await startResearch({
      googleDataAt: FLAGGED_AT,
      model: 'deep-research-preview-04-2026',
    })

    expect(error).toMatchObject({ status: 403 })
    expect(mocks.persistUserMessage).not.toHaveBeenCalled()
    expect(mocks.startResearchJobForChat).not.toHaveBeenCalled()
  })

  it('starts Gemini research once the paid tier is confirmed', async () => {
    await startResearch({
      googleDataAt: FLAGGED_AT,
      model: 'deep-research-preview-04-2026',
      paidTierConfirmedAt: new Date(1_000),
    })

    expect(mocks.startResearchJobForChat).toHaveBeenCalled()
  })

  it('starts OpenAI research in a flagged chat', async () => {
    await startResearch({
      googleDataAt: FLAGGED_AT,
      model: 'o3-deep-research',
    })

    expect(mocks.startResearchJobForChat).toHaveBeenCalled()
  })
})

describe('Gemini paid-tier route', () => {
  function createKeysDb(key: { provider: string } | null) {
    const where = vi.fn(async (_condition: unknown) => undefined)
    const set = vi.fn(() => ({ where }))

    return {
      db: {
        query: { keys: { findFirst: vi.fn(async () => key ?? undefined) } },
        update: vi.fn(() => ({ set })),
      },
      set,
      where,
    }
  }

  async function post(
    body: unknown,
    key: { provider: string } | null = { provider: 'google' },
  ) {
    const created = createKeysDb(key)

    vi.stubGlobal('useDb', () => created.db)

    const { default: handler } = await import(
      '../../../server/api/v1/profiles/keys/google/paid-tier.post'
    )
    let error: unknown = null
    let response: unknown = null

    try {
      response = await handler({ body } as any)
    } catch (exception) {
      error = exception
    }

    return { ...created, error, response }
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubRouteGlobals()
  })

  it('needs a signed-in user', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    const result = await post({ confirmed: true })

    expect(result.error).toMatchObject({ status: 401 })
    expect(result.db.update).not.toHaveBeenCalled()
  })

  it('answers 404 without a saved Gemini key of this user', async () => {
    const result = await post({ confirmed: true }, null)

    expect(result.error).toMatchObject({ status: 404 })
    expect(result.db.query.keys.findFirst).toHaveBeenCalledWith({
      where: { userId: 1, provider: 'google' },
      columns: { provider: true },
    })
    expect(result.db.update).not.toHaveBeenCalled()
  })

  it('confirms once, keeping the first time on a repeat', async () => {
    const result = await post({ confirmed: true })

    expect(result.response).toEqual({ paidTierConfirmed: true })
    expect(result.set).toHaveBeenCalledWith({
      paidTierConfirmedAt: expect.any(Date),
    })

    const condition = dialect.sqlToQuery(
      result.where.mock.calls[0]?.[0] as SQL,
    )

    expect(condition.sql).toContain('"keys"."user_id" = ?')
    expect(condition.sql).toContain('"keys"."paid_tier_confirmed_at" is null')
    expect(condition.params).toEqual([1, 'google'])
  })

  it('withdraws the confirmation', async () => {
    const result = await post({ confirmed: false })

    expect(result.response).toEqual({ paidTierConfirmed: false })
    expect(result.set).toHaveBeenCalledWith({ paidTierConfirmedAt: null })
  })

  it('rejects a body without a boolean', async () => {
    const result = await post({ confirmed: 'yes' })

    expect(result.error).toMatchObject({ status: 400 })
  })

  it('clears the confirmation when the Gemini key is replaced', async () => {
    const created = createKeysDb({ provider: 'google' })

    vi.stubGlobal('useDb', () => created.db)
    vi.stubGlobal('useEncryptText', vi.fn(async () => 'encrypted'))
    vi.stubGlobal('setResponseStatus', vi.fn())
    vi.stubGlobal('useEvent', () => ({ context: {} }))

    const { default: handler } = await import(
      '../../../server/api/v1/profiles/keys/google/index.post'
    )

    await handler({ body: { apiKey: 'new-key' } } as any)

    expect(created.set).toHaveBeenCalledWith({
      apiKey: 'encrypted',
      paidTierConfirmedAt: null,
    })
  })
})
