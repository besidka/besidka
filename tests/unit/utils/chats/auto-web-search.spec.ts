import { APICallError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tools } from '#shared/types/chats.d'
import {
  JEV_AUTO_WEB_SEARCH,
  JEV_SEND_PATH_MAX_TURN_CHARS,
  JEV_SEND_PATH_TIMEOUT_MS,
} from '#shared/utils/jev-policy'
import {
  collectAutoWebSearchCandidateTools,
  hasFirstMessageAutoWebSearchDecision,
  readAutoWebSearchAnswer,
  resolveAutoWebSearch,
  shouldForceAutoWebSearch,
} from '~~/server/utils/chats/auto-web-search'
import type {
  ResolveAutoWebSearchInput,
} from '~~/server/utils/chats/auto-web-search'
import {
  buildSendPathJevState,
  readSendPathTurns,
} from '~~/server/utils/jev/send-path'

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  decrypt: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    experimental_decide: (...args: unknown[]) => mocks.decide(...args),
  }
})

vi.mock('~~/server/utils/encryption', () => ({
  useDecryptText: (value: string) => mocks.decrypt(value),
}))

const QUESTION_ID = JEV_AUTO_WEB_SEARCH.questionId
const BRAVE: Tools = ['web_search_brave']

function createDb(input: {
  hasKey?: boolean
  typesafeRoles?: Record<string, boolean> | null
} = {}) {
  const keyFindFirst = vi.fn(async () => {
    return input.hasKey === false ? undefined : { apiKey: 'encrypted:ts-key' }
  })
  const settingsFindFirst = vi.fn(async () => {
    return { typesafeRoles: input.typesafeRoles ?? null }
  })

  return {
    db: {
      query: {
        keys: { findFirst: keyFindFirst },
        userSettings: { findFirst: settingsFindFirst },
      },
    } as any,
    keyFindFirst,
  }
}

function createLogger() {
  const attributes: Record<string, any> = {}

  return {
    attributes,
    logger: {
      set: (fields: Record<string, any>) => {
        Object.assign(attributes, fields.attributes ?? {})
      },
      getContext: () => ({ attributes }),
    },
  }
}

function answer(probability: number) {
  return {
    answers: { [QUESTION_ID]: { type: 'boolean', probability } },
    usage: { inputTokens: 443 },
  }
}

function apiError(statusCode: number) {
  return new APICallError({
    message: 'failed',
    url: 'https://api.typesafe.ai/v1/systemone',
    requestBodyValues: {},
    statusCode,
  })
}

function baseInput(
  overrides: Partial<ResolveAutoWebSearchInput> = {},
): ResolveAutoWebSearchInput {
  return {
    db: createDb().db,
    userId: 7,
    mode: 'auto',
    chosenTools: BRAVE,
    defaultTools: BRAVE,
    persistedTools: null,
    messageText: 'Write a haiku about autumn leaves',
    recentTurns: [],
    ...overrides,
  }
}

beforeEach(() => {
  mocks.decide.mockReset().mockResolvedValue(answer(0.05))
  mocks.decrypt.mockReset().mockImplementation(async (value: string) => {
    return value.replace(/^encrypted:/, '')
  })
})

describe('shouldForceAutoWebSearch', () => {
  it.each([
    'Summarise https://example.com/post',
    'What does besidka.com say about keys?',
    'What is the weather in Kraków?',
    'Latest Nuxt release notes',
    'Який курс долара сьогодні?',
    'Jaki był wynik meczu?',
  ])('forces a search for %s', (text) => {
    expect(shouldForceAutoWebSearch(text)).toBe(true)
  })

  it.each([
    'Refactor index.ts and app.vue please',
    'I know the cursor moves in курсор mode',
    'Write a poem about the sea',
  ])('does not force a search for %s', (text) => {
    expect(shouldForceAutoWebSearch(text)).toBe(false)
  })
})

describe('readAutoWebSearchAnswer', () => {
  it('searches at or above the policy threshold and skips below it', () => {
    const threshold = JEV_AUTO_WEB_SEARCH.searchAtOrAbove

    expect(readAutoWebSearchAnswer({
      ok: true,
      status: 'ok',
      probabilities: { [QUESTION_ID]: threshold },
      inputTokens: 1,
      latencyMs: 1,
    })).toEqual({ outcome: 'searched', score: threshold })
    expect(readAutoWebSearchAnswer({
      ok: true,
      status: 'ok',
      probabilities: { [QUESTION_ID]: threshold - 0.01 },
      inputTokens: 1,
      latencyMs: 1,
    }).outcome).toBe('skipped')
  })

  it('falls back to a search on a failure or a missing answer', () => {
    expect(readAutoWebSearchAnswer({
      ok: false,
      status: 'timeout',
      latencyMs: 800,
    })).toEqual({ outcome: 'fallback', score: null })
    expect(readAutoWebSearchAnswer({
      ok: true,
      status: 'ok',
      probabilities: { other: 0.9 },
      inputTokens: 1,
      latencyMs: 1,
    })).toEqual({ outcome: 'fallback', score: null })
  })
})

describe('resolveAutoWebSearch', () => {
  it('keeps the tools unchanged and never reads the key in always mode',
    async () => {
      const { db, keyFindFirst } = createDb()

      const result = await resolveAutoWebSearch(baseInput({
        db,
        mode: 'always',
      }))

      expect(result).toEqual({ tools: BRAVE, outcome: null })
      expect(keyFindFirst).not.toHaveBeenCalled()
      expect(mocks.decide).not.toHaveBeenCalled()
    })

  it('does nothing without a chosen web-search provider', async () => {
    const { db, keyFindFirst } = createDb()

    const result = await resolveAutoWebSearch(baseInput({
      db,
      chosenTools: [],
      defaultTools: [],
    }))

    expect(result).toEqual({ tools: [], outcome: null })
    expect(keyFindFirst).not.toHaveBeenCalled()
  })

  it('behaves as today without a TypeSafe AI key', async () => {
    const { db } = createDb({ hasKey: false })
    const { attributes, logger } = createLogger()

    const result = await resolveAutoWebSearch(baseInput({ db, logger }))

    expect(result).toEqual({ tools: BRAVE, outcome: null })
    expect(mocks.decide).not.toHaveBeenCalled()
    expect(attributes.autoWebSearchJev).toBeUndefined()
  })

  it('behaves as today when the autoWebSearch role is off', async () => {
    const { db } = createDb({ typesafeRoles: { autoWebSearch: false } })

    const result = await resolveAutoWebSearch(baseInput({ db }))

    expect(result).toEqual({ tools: BRAVE, outcome: null })
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it.each([
    'Read https://example.com/changelog for me',
    'What is the news about Nuxt today?',
  ])('forces a search without a Jev call for %s', async (messageText) => {
    const { attributes, logger } = createLogger()

    const result = await resolveAutoWebSearch(baseInput({
      messageText,
      logger,
    }))

    expect(result).toEqual({ tools: BRAVE, outcome: 'forced' })
    expect(mocks.decide).not.toHaveBeenCalled()
    expect(attributes.autoWebSearchJev).toMatchObject({
      status: 'ok',
      counts: { forced: 1 },
    })
  })

  it('searches when Jev says a search is needed', async () => {
    mocks.decide.mockResolvedValueOnce(answer(0.86))

    const result = await resolveAutoWebSearch(baseInput({
      messageText: 'Who is the CEO of Intel?',
    }))

    expect(result).toEqual({ tools: BRAVE, outcome: 'searched' })
  })

  it('drops only the web-search tool when Jev says no search is needed',
    async () => {
      const { attributes, logger } = createLogger()

      const result = await resolveAutoWebSearch(baseInput({
        chosenTools: ['web_search'],
        defaultTools: ['web_search'],
        logger,
      }))

      expect(result).toEqual({ tools: [], outcome: 'skipped' })
      expect(attributes.autoWebSearchJev).toMatchObject({
        model: 'jev-1.14.0',
        status: 'ok',
        calls: 1,
        questions: 1,
        inputTokens: 443,
        counts: { skipped: 1 },
        scores: [0.05],
      })
    })

  it.each([
    ['401', () => apiError(401), 'unauthorized'],
    ['429', () => apiError(429), 'rate-limited'],
    ['timeout', () => {
      const exception = new Error('aborted')

      exception.name = 'TimeoutError'

      return exception
    }, 'timeout'],
  ])('searches on a Jev %s failure', async (_label, makeError, status) => {
    mocks.decide.mockRejectedValueOnce(makeError())

    const { attributes, logger } = createLogger()

    const result = await resolveAutoWebSearch(baseInput({ logger }))

    expect(result).toEqual({ tools: BRAVE, outcome: 'fallback' })
    expect(attributes.autoWebSearchJev).toMatchObject({
      status,
      counts: { fallback: 1 },
    })
  })

  it('sends one question with the message and recent turns, redacted, on '
    + 'the send-path timeout', async () => {
    await resolveAutoWebSearch(baseInput({
      messageText: 'My card is 4111 1111 1111 1111, is this poem good?',
      recentTurns: [
        { role: 'user', text: 'turn one' },
        { role: 'assistant', text: 'turn two' },
        { role: 'user', text: 'turn three' },
        { role: 'assistant', text: 'turn four' },
      ],
    }))

    const [options] = mocks.decide.mock.calls[0] as [Record<string, any>]

    expect(Object.keys(options.questions)).toEqual([QUESTION_ID])
    expect(options.questions[QUESTION_ID]).toEqual(JEV_AUTO_WEB_SEARCH.question)
    expect(options.state.message).not.toContain('4111')
    expect(options.state.recent_turns).toEqual([
      { role: 'assistant', text: 'turn two' },
      { role: 'user', text: 'turn three' },
      { role: 'assistant', text: 'turn four' },
    ])
    expect(options.maxRetries).toBe(0)
    expect(options.abortSignal).toBeInstanceOf(AbortSignal)
    expect(JEV_SEND_PATH_TIMEOUT_MS).toBe(JEV_AUTO_WEB_SEARCH.timeoutMs)
  })

  it.each([
    [['web_search_exa'] as Tools, 'searched'],
    [[] as Tools, 'skipped'],
  ])('reuses the tools persisted for the same message id (%j) without '
    + 'asking Jev again', async (persistedTools, outcome) => {
    const { attributes, logger } = createLogger()

    const result = await resolveAutoWebSearch(baseInput({
      chosenTools: ['web_search_exa'],
      defaultTools: ['web_search_exa'],
      persistedTools,
      logger,
    }))

    expect(result).toEqual({ tools: persistedTools, outcome })
    expect(mocks.decide).not.toHaveBeenCalled()
    expect(attributes.autoWebSearchJev).toMatchObject({
      counts: { reused: 1, [outcome]: 1 },
    })
  })

  it('reuses persisted tools even when the client sent no tools', async () => {
    const result = await resolveAutoWebSearch(baseInput({
      chosenTools: [],
      defaultTools: [],
      persistedTools: [],
    }))

    expect(result).toEqual({ tools: [], outcome: 'skipped' })
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('reuses persisted tools only while Auto is enabled', async () => {
    const { db } = createDb({ hasKey: false })

    const result = await resolveAutoWebSearch(baseInput({
      db,
      defaultTools: BRAVE,
      persistedTools: [],
    }))

    expect(result).toEqual({ tools: BRAVE, outcome: null })
  })
})

describe('send-path state', () => {
  it('keeps the last text turns, oldest first, and skips empty ones', () => {
    const turns = readSendPathTurns([
      { role: 'user', parts: [{ type: 'text', text: 'first' }] },
      { role: 'assistant', parts: [{ type: 'file' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'second' }] },
      { role: 'system', parts: [{ type: 'text', text: 'ignored' }] },
      { role: 'user', parts: [{ type: 'text', text: 'third' }] },
    ], 2)

    expect(turns).toEqual([
      { role: 'assistant', text: 'second' },
      { role: 'user', text: 'third' },
    ])
  })

  it('caps every text at the send-path limit', () => {
    const long = 'a'.repeat(JEV_SEND_PATH_MAX_TURN_CHARS + 50)

    const state = buildSendPathJevState({
      messageText: long,
      recentTurns: [{ role: 'user', text: long }],
    })

    expect(state.message).toHaveLength(JEV_SEND_PATH_MAX_TURN_CHARS)
    expect(state.recent_turns[0]?.text)
      .toHaveLength(JEV_SEND_PATH_MAX_TURN_CHARS)
  })
})

describe('Auto web search candidate tools and first-message decision', () => {
  it('validates the default tools plus the persisted tools a retry may '
    + 'reuse, only in the Auto mode', () => {
    expect(collectAutoWebSearchCandidateTools({
      mode: 'auto',
      defaultTools: ['web_search'],
      persistedTools: ['web_search_brave'],
    })).toEqual(['web_search', 'web_search_brave'])
    expect(collectAutoWebSearchCandidateTools({
      mode: 'always',
      defaultTools: ['web_search'],
      persistedTools: ['web_search_brave'],
    })).toEqual(['web_search'])
    expect(collectAutoWebSearchCandidateTools({
      mode: 'auto',
      defaultTools: ['web_search_exa'],
      persistedTools: null,
    })).toEqual(['web_search_exa'])
  })

  it('reads a KV failure as undecided', async () => {
    const store = {
      get: vi.fn(async () => {
        throw new Error('KV unavailable')
      }),
      put: vi.fn(),
    }

    await expect(hasFirstMessageAutoWebSearchDecision(store, {
      chatId: 'chat-1',
      messageId: 'message-1',
    })).resolves.toBe(false)
  })
})
