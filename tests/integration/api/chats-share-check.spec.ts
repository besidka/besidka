import { APICallError } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JEV_SHARE_PII_CHECK } from '#shared/utils/jev-policy'
import { assertNotCrossSiteRequest } from '~~/server/utils/cross-site-guard'
import {
  createMemoryExtractionTestDb,
  minutesBefore,
  seedChat,
  seedKey,
  seedMessage,
  seedUser,
  textPart,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

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

vi.mock('evlog', () => ({
  createError: (input: { message?: string, status?: number }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/encryption', () => ({
  useDecryptText: async (value: string) => `decrypted-${value}`,
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: mocks.loggerSet }),
}))

const CUSTOMER_EMAIL = 'anna.kowalska@gmail.com'
const CUSTOMER_PHONE = '+48 601 234 567'
const CARD_NUMBER = '4111 1111 1111 1111'
const CHAT_TITLE = 'Invoice for Anna'
const POLICY = JEV_SHARE_PII_CHECK

interface DecideCall {
  state: Record<string, string>
  questions: Record<string, unknown>
  abortSignal?: AbortSignal
}

interface CheckResponse {
  warnings: Array<{ kind: string, source: string }>
  checked: boolean
}

function answerJev(probability: number) {
  mocks.decide.mockImplementation(async ({ questions }: DecideCall) => {
    return {
      answers: Object.fromEntries(Object.keys(questions).map((id) => {
        return [id, { type: 'boolean', probability }]
      })),
      usage: { inputTokens: 120 },
    }
  })
}

function apiError(statusCode: number) {
  return new APICallError({
    message: 'failed',
    url: 'https://api.typesafe.ai/v1/systemone',
    requestBodyValues: {},
    statusCode,
  })
}

function createKvStub() {
  const store = new Map<string, string>()

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }
}

function createEvent(
  slug: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return {
    body,
    params: { slug },
    context: {},
    headers,
    res: { headers: new Headers() },
  }
}

function loggedText(): string {
  return JSON.stringify(mocks.loggerSet.mock.calls)
}

function jevLog(): Record<string, any> | undefined {
  for (const [fields] of mocks.loggerSet.mock.calls.toReversed()) {
    const record = (fields as any)?.attributes?.sharePiiCheckJev

    if (record) {
      return record
    }
  }

  return undefined
}

describe('POST /api/v1/chats/[slug]/share/check', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let chatSlug: string
  let session: { user: { id: string } } | null

  beforeEach(async () => {
    vi.resetModules()
    mocks.decide.mockReset()
    mocks.loggerSet.mockReset()
    answerJev(0.02)

    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, { memoryEnabled: true })
    session = { user: { id: String(userId) } }

    const chat = await seedChat(testDb.db, userId, { title: CHAT_TITLE })

    chatSlug = chat.slug

    await seedMessage(
      testDb.db,
      chat.id,
      'user',
      [textPart(`Email her at ${CUSTOMER_EMAIL} or call ${CUSTOMER_PHONE}.`)],
      minutesBefore(30),
    )
    await seedMessage(
      testDb.db,
      chat.id,
      'assistant',
      [
        textPart(`Charged card ${CARD_NUMBER}.`),
        {
          type: 'tool-web_search',
          toolCallId: 'call-1',
          state: 'output-available',
          input: { query: 'secret.person@private.org' },
          output: [],
        },
      ],
      minutesBefore(29),
    )

    const kv = createKvStub()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('assertNotCrossSiteRequest', assertNotCrossSiteRequest)
    vi.stubGlobal(
      'getRequestHeader',
      (event: { headers?: Record<string, string> }, name: string) => {
        return event.headers?.[name.toLowerCase()]
      },
    )
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
    vi.stubGlobal(
      'readValidatedBody',
      async (event: { body: unknown }, parser: (body: unknown) => unknown) => {
        return parser(event.body)
      },
    )
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useUserSession', vi.fn(async () => session))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  async function check(
    body: Record<string, unknown> = {},
    slug = chatSlug,
    headers: Record<string, string> = {},
  ): Promise<CheckResponse> {
    const module = await import(
      '../../../server/api/v1/chats/[slug]/share/check.post'
    )
    const handler = module.default as (event: unknown) => Promise<any>

    return await handler(createEvent(slug, {
      showFiles: true,
      showMetadata: true,
      ...body,
    }, headers))
  }

  async function saveTypesafeKey() {
    await seedKey(testDb.db, userId, 'typesafe')
  }

  function sentToJev(): string {
    return JSON.stringify(mocks.decide.mock.calls)
  }

  describe('ownership and validation', () => {
    it('rejects a request without a session', async () => {
      session = null

      await expect(check()).rejects.toThrow('Unauthorized')
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('answers 404 for a chat the user does not own and never calls Jev',
      async () => {
        await saveTypesafeKey()

        const otherUserId = await seedUser(testDb.db, {})

        session = { user: { id: String(otherUserId) } }

        await expect(check()).rejects.toMatchObject({
          message: 'Chat not found',
          status: 404,
        })
        expect(mocks.decide).not.toHaveBeenCalled()
      })

    it('rejects a cross-site request and never calls Jev', async () => {
      await saveTypesafeKey()

      await expect(check({}, chatSlug, { 'sec-fetch-site': 'cross-site' }))
        .rejects.toMatchObject({ status: 403 })
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('answers 400 for a malformed body', async () => {
      await expect(check({ showFiles: 'yes' })).rejects.toMatchObject({
        status: 400,
      })
    })
  })

  describe('without a TypeSafe AI key', () => {
    it('returns the deterministic warnings only and never calls Jev',
      async () => {
        const response = await check()

        expect(mocks.decide).not.toHaveBeenCalled()
        expect(response.checked).toBe(false)
        expect(response.warnings).toEqual([
          { kind: 'email', source: 'detector' },
          { kind: 'phone', source: 'detector' },
          { kind: 'payment-card', source: 'detector' },
        ])
      })

    it('returns no warnings for a chat without personal data', async () => {
      const clean = await seedChat(testDb.db, userId, { title: 'Recipes' })

      await seedMessage(
        testDb.db,
        clean.id,
        'user',
        [textPart('How long do I boil an egg?')],
        minutesBefore(10),
      )

      const response = await check({}, clean.slug)

      expect(response).toEqual({ warnings: [], checked: false })
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('reads only what the share exposes: no tool parts, and file names '
      + 'only when files are shown', async () => {
      const filesChat = await seedChat(testDb.db, userId, { title: 'Scans' })

      await seedMessage(
        testDb.db,
        filesChat.id,
        'user',
        [
          textPart('Here is the scan.'),
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'passport-of-jan.nowak@wp.pl.png',
            url: 'https://example.test/file.png',
          },
        ],
        minutesBefore(10),
      )

      const shown = await check({ showFiles: true }, filesChat.slug)
      const hidden = await check({ showFiles: false }, filesChat.slug)

      expect(shown.warnings).toEqual([{ kind: 'email', source: 'detector' }])
      expect(hidden.warnings).toEqual([])

      const toolsChat = await seedChat(testDb.db, userId, { title: 'Tools' })

      await seedMessage(
        testDb.db,
        toolsChat.id,
        'assistant',
        [{
          type: 'tool-web_search',
          toolCallId: 'call-2',
          state: 'output-available',
          input: { query: 'secret.person@private.org' },
          output: [],
        }],
        minutesBefore(10),
      )

      const toolsOnly = await check({}, toolsChat.slug)

      expect(toolsOnly.warnings).toEqual([])
    })
  })

  describe('with a TypeSafe AI key', () => {
    beforeEach(async () => {
      await saveTypesafeKey()
    })

    it('adds a typesafe warning when Jev scores at or above the threshold',
      async () => {
        answerJev(POLICY.warnAtOrAbove)

        const response = await check()

        expect(mocks.decide).toHaveBeenCalledTimes(1)
        expect(response.checked).toBe(true)
        expect(response.warnings).toContainEqual({
          kind: 'personal-data',
          source: 'typesafe',
        })
        expect(response.warnings).toContainEqual({
          kind: 'email',
          source: 'detector',
        })
      })

    it('adds no typesafe warning below the threshold', async () => {
      answerJev(POLICY.warnAtOrAbove - 0.01)

      const response = await check()

      expect(response.checked).toBe(true)
      expect(response.warnings.map(warning => warning.source))
        .not.toContain('typesafe')
    })

    it('asks the pinned question about the redacted chat under the share '
      + 'timeout', async () => {
      await check()

      const [call] = mocks.decide.mock.calls[0] as [DecideCall]

      expect(Object.keys(call.questions)).toEqual([POLICY.questionId])
      expect(Object.keys(call.state)).toEqual([POLICY.stateKey])
      expect(call.state[POLICY.stateKey]).toContain('[redacted]')
      expect(call.state[POLICY.stateKey]).toContain(CHAT_TITLE)
      expect(call.abortSignal).toBeInstanceOf(AbortSignal)
    })

    it('never sends the matched values or tool-part text to Jev', async () => {
      await check()

      const sent = sentToJev()

      expect(sent).not.toContain(CUSTOMER_EMAIL)
      expect(sent).not.toContain('601 234 567')
      expect(sent).not.toContain('4111')
      expect(sent).not.toContain('secret.person')
    })

    it('stops at the first flagged chunk and asks again for each clean one',
      async () => {
        const longChat = await seedChat(testDb.db, userId, { title: 'Long' })
        const filler = 'The quick brown fox jumps over the lazy dog. '
          .repeat(2_500)

        for (let index = 0; index < 5; index++) {
          await seedMessage(
            testDb.db,
            longChat.id,
            'user',
            [textPart(filler)],
            minutesBefore(50 - index),
          )
        }

        answerJev(0.02)

        const clean = await check({}, longChat.slug)
        const chunkCount = mocks.decide.mock.calls.length

        expect(chunkCount).toBeGreaterThan(1)
        expect(clean.checked).toBe(true)

        mocks.decide.mockReset()
        answerJev(0.9)

        const flagged = await check({}, longChat.slug)

        expect(mocks.decide).toHaveBeenCalledTimes(1)
        expect(flagged.warnings).toContainEqual({
          kind: 'personal-data',
          source: 'typesafe',
        })
      })

    it.each([
      ['a 401 answer', () => apiError(401), 'unauthorized'],
      ['a 429 answer', () => apiError(429), 'rate-limited'],
      ['a 529 answer', () => apiError(529), 'rate-limited'],
      ['a timeout', () => {
        return Object.assign(new Error('timed out'), { name: 'TimeoutError' })
      }, 'timeout'],
      ['a network failure', () => new TypeError('fetch failed'), 'network'],
    ])('keeps the detector warnings and reports unchecked after %s',
      async (_label, createFailure, status) => {
        mocks.decide.mockRejectedValue(createFailure())

        const response = await check()

        expect(response.checked).toBe(false)
        expect(response.warnings).toEqual([
          { kind: 'email', source: 'detector' },
          { kind: 'phone', source: 'detector' },
          { kind: 'payment-card', source: 'detector' },
        ])
        expect(jevLog()).toMatchObject({ status })
      })

    it('does not call Jev when the user switched the role off', async () => {
      await testDb.sqlite
        .prepare('UPDATE user_settings SET typesafe_roles = ? WHERE user_id = ?')
        .run(JSON.stringify({ sharePiiCheck: false }), userId)

      const response = await check()

      expect(mocks.decide).not.toHaveBeenCalled()
      expect(response.checked).toBe(false)
      expect(response.warnings).toHaveLength(3)
    })

    it('does not call Jev without current legal consent', async () => {
      await testDb.sqlite
        .prepare(
          'UPDATE user_settings SET sensitive_content_consent_withdrawn_at = ? '
          + 'WHERE user_id = ?',
        )
        .run(Date.now() + 60_000, userId)

      const response = await check()

      expect(mocks.decide).not.toHaveBeenCalled()
      expect(response.checked).toBe(false)
      expect(response.warnings).toHaveLength(3)
    })

    it('skips Jev for a chat with no shareable text', async () => {
      const empty = await seedChat(testDb.db, userId, { title: '' })

      const response = await check({}, empty.slug)

      expect(mocks.decide).not.toHaveBeenCalled()
      expect(response).toEqual({ warnings: [], checked: true })
    })
  })

  describe('privacy', () => {
    it('never puts chat text in the response or the logs', async () => {
      await saveTypesafeKey()
      answerJev(0.9)

      const response = await check()
      const returned = JSON.stringify(response)
      const logged = loggedText()

      for (const secret of [
        CUSTOMER_EMAIL,
        '601 234 567',
        '4111',
        CHAT_TITLE,
        'Charged card',
      ]) {
        expect(returned).not.toContain(secret)
        expect(logged).not.toContain(secret)
      }

      expect(Object.keys(response).sort()).toEqual(['checked', 'warnings'])
    })

    it('logs only counts, scores and a status under attributes.sharePiiCheckJev',
      async () => {
        await saveTypesafeKey()
        answerJev(0.5)

        await check()

        expect(jevLog()).toMatchObject({
          model: 'jev-1.14.0',
          status: 'ok',
          calls: 1,
          questions: 1,
          inputTokens: 120,
          scores: [0.5],
          counts: { chunks: 1, detectorWarnings: 3, flagged: 1 },
        })

        const topLevelKeys = mocks.loggerSet.mock.calls
          .flatMap(([fields]) => Object.keys(fields as object))

        expect(new Set(topLevelKeys)).toEqual(
          new Set(['userId', 'chatSlug', 'attributes']),
        )
      })
  })
})
