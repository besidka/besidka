import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JEV_AUTO_WEB_SEARCH } from '#shared/utils/jev-policy'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  loggerSet: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    experimental_decide: (...args: unknown[]) => mocks.decide(...args),
  }
})

vi.mock('~~/server/utils/encryption', () => ({
  useDecryptText: async (value: string) => `decrypted-${value}`,
}))

vi.mock('~~/server/utils/files/file-governance', () => ({
  validateMessageFilePolicy: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/research/start', () => ({
  resolveResearchStartContext: vi.fn(async () => ({})),
  startResearchJobForChat: vi.fn(async () => ({})),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
    getContext: () => ({}),
  }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  createError: (input: { message?: string }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

function createDb(hasTypesafeKey: boolean) {
  const messagesInsertValues = vi.fn(() => ({
    returning: vi.fn(() => ({
      get: vi.fn(async () => ({
        id: 'message-db-id',
        publicId: 'message-public-id',
      })),
    })),
  }))
  const keysFindFirst = vi.fn(async () => {
    return hasTypesafeKey ? { apiKey: 'typesafe-key' } : undefined
  })

  return {
    db: {
      query: {
        keys: { findFirst: keysFindFirst },
        userSettings: {
          findFirst: vi.fn(async () => ({ typesafeRoles: null })),
        },
        projects: { findFirst: vi.fn(async () => undefined) },
      },
      insert: vi.fn()
        .mockReturnValueOnce({
          values: vi.fn(() => ({
            returning: vi.fn(() => ({
              get: vi.fn(() => ({ id: 'chat-1', slug: 'chat-1' })),
            })),
          })),
        })
        .mockReturnValueOnce({ values: messagesInsertValues }),
      update: vi.fn(),
    },
    messagesInsertValues,
    keysFindFirst,
  }
}

async function createChat(input: {
  hasTypesafeKey: boolean
  tools: string[]
  webSearchMode?: 'auto' | 'always'
  text?: string
  research?: boolean
}) {
  const module = await import('../../../server/api/v1/chats/new/index.put')
  const created = createDb(input.hasTypesafeKey)

  vi.stubGlobal('useDb', () => created.db)

  await module.default({
    body: {
      parts: [{ type: 'text', text: input.text ?? 'Write a haiku' }],
      tools: input.tools,
      reasoning: 'off',
      ...(input.webSearchMode ? { webSearchMode: input.webSearchMode } : {}),
      ...(input.research
        ? { model: 'o4-mini-deep-research', research: { answers: [] } }
        : {}),
    },
  } as any)

  const [persisted] = created.messagesInsertValues.mock.calls[0] as unknown as [
    { tools: string[] },
  ]

  return { persistedTools: persisted.tools }
}

function jevAnswer(probability: number) {
  return {
    answers: {
      [JEV_AUTO_WEB_SEARCH.questionId]: { type: 'boolean', probability },
    },
    usage: { inputTokens: 300 },
  }
}

describe('new chat Auto web search', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.decide.mockReset().mockResolvedValue(jevAnswer(0.05))

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
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

  it('persists the chosen tools unchanged without a TypeSafe AI key',
    async () => {
      const { persistedTools } = await createChat({
        hasTypesafeKey: false,
        tools: ['web_search_exa'],
        webSearchMode: 'auto',
      })

      expect(persistedTools).toEqual(['web_search_exa'])
      expect(mocks.decide).not.toHaveBeenCalled()
    })

  it('persists the chosen tools unchanged in the always mode', async () => {
    const { persistedTools } = await createChat({
      hasTypesafeKey: true,
      tools: ['web_search_exa'],
    })

    expect(persistedTools).toEqual(['web_search_exa'])
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('persists the resolved tools for a first message Jev skips', async () => {
    const { persistedTools } = await createChat({
      hasTypesafeKey: true,
      tools: ['web_search_exa'],
      webSearchMode: 'auto',
    })

    expect(persistedTools).toEqual([])
    expect(mocks.decide).toHaveBeenCalledTimes(1)

    const [options] = mocks.decide.mock.calls[0] as [Record<string, any>]

    expect(options.state).toEqual({
      message: 'Write a haiku',
      recent_turns: [],
    })
  })

  it('keeps the search when Jev times out', async () => {
    const exception = new Error('The operation timed out')

    exception.name = 'TimeoutError'
    mocks.decide.mockRejectedValue(exception)

    const { persistedTools } = await createChat({
      hasTypesafeKey: true,
      tools: ['web_search_exa'],
      webSearchMode: 'auto',
    })

    expect(persistedTools).toEqual(['web_search_exa'])
  })

  it('keeps the search for a recency phrase without calling Jev', async () => {
    const { persistedTools } = await createChat({
      hasTypesafeKey: true,
      tools: ['web_search'],
      webSearchMode: 'auto',
      text: 'What is the weather in Lviv?',
    })

    expect(persistedTools).toEqual(['web_search'])
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('never decides for a deep research start', async () => {
    const { persistedTools } = await createChat({
      hasTypesafeKey: true,
      tools: ['web_search'],
      webSearchMode: 'auto',
      research: true,
    })

    expect(persistedTools).toEqual(['web_search'])
    expect(mocks.decide).not.toHaveBeenCalled()
  })
})
