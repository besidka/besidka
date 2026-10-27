import { APICallError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MEMORY_JEV_MAX_QUESTIONS_PER_CALL,
  MEMORY_JEV_MODEL_ID,
  MEMORY_JEV_TIMEOUT_MS,
  assertMemoryJevAllowed,
  buildMemoryJevGroundingExcerpt,
  classifyMemoryJevFailure,
  createMemoryJevChecker,
  resolveMemoryJevChecker,
} from '~~/server/utils/memory/jev-check'
import type { MemoryJevCandidate } from '~~/server/utils/memory/jev-check'

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

const ART9_QUESTIONS = [
  'health',
  'religion-or-belief',
  'political-opinion',
  'racial-or-ethnic-origin',
  'sex-life-or-orientation',
  'trade-union',
  'genetic',
  'biometric',
]

const SAFE_ENTRY: MemoryJevCandidate = {
  title: 'Answer language',
  description: 'Prefers Polish',
  body: 'Always answer in Polish.',
}

const CARD_ENTRY: MemoryJevCandidate = {
  title: 'Card',
  description: 'Payment card',
  body: 'Card 4111 1111 1111 1111 for subscriptions.',
}

const HEALTH_ENTRY: MemoryJevCandidate = {
  title: 'Diabetes',
  description: 'Health',
  body: 'The user has type 2 diabetes and takes metformin.',
}

type Answers = Record<string, { type: 'boolean', probability: number }>

interface DecideCall {
  model: { modelId: string }
  state: unknown
  questions: Record<string, { instructions: Record<string, string> }>
  maxRetries: number
  abortSignal: AbortSignal
}

function decideCalls(): DecideCall[] {
  return mocks.decide.mock.calls.map(([options]) => options as DecideCall)
}

function sentText(): string {
  return JSON.stringify(decideCalls())
}

function answersFor(
  questions: Record<string, unknown>,
  overrides: Record<string, number> = {},
): Answers {
  return Object.fromEntries(Object.keys(questions).map((id) => {
    const question = id.split('__')[1]!
    const defaultProbability = question === 'grounded' ? 0.95 : 0.02

    return [id, {
      type: 'boolean',
      probability: overrides[id] ?? defaultProbability,
    }]
  }))
}

function answerWith(overrides: Record<string, number> = {}) {
  mocks.decide.mockImplementation(async (options: DecideCall) => {
    return { answers: answersFor(options.questions, overrides) }
  })
}

function createLogger() {
  const fields: Array<Record<string, any>> = []

  return {
    fields,
    logger: {
      set: (value: Record<string, unknown>) => {
        fields.push(value)
      },
    },
  }
}

function createChecker(logger?: { set: (value: any) => void }) {
  const checker = createMemoryJevChecker({ apiKey: 'ts-test-key', logger })

  if (!checker) {
    throw new Error('expected a checker')
  }

  return checker
}

beforeEach(() => {
  mocks.decide.mockReset()
  mocks.decrypt.mockReset().mockImplementation(async (value: string) => {
    return value.replace(/^encrypted:/, '')
  })
  answerWith()
})

describe('createMemoryJevChecker', () => {
  it('returns null for an empty key so the SDK never falls back to an env '
    + 'var', () => {
    expect(createMemoryJevChecker({ apiKey: '   ' })).toBeNull()
  })

  it('pins jev-1.14.0, disables SDK retries and bounds the call with the '
    + 'timeout budget', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')

    await createChecker().check([SAFE_ENTRY])

    const [call] = decideCalls()

    expect(call?.model.modelId).toBe(MEMORY_JEV_MODEL_ID)
    expect(MEMORY_JEV_MODEL_ID).toBe('jev-1.14.0')
    expect(call?.maxRetries).toBe(0)
    expect(call?.abortSignal).toBeInstanceOf(AbortSignal)
    expect(timeoutSpy).toHaveBeenCalledWith(MEMORY_JEV_TIMEOUT_MS)
    expect(MEMORY_JEV_TIMEOUT_MS).toBe(2500)

    timeoutSpy.mockRestore()
  })

  it('asks one question per Art. 9 category plus never-store, and a '
    + 'grounding question only when there is a source', async () => {
    await createChecker().check([
      SAFE_ENTRY,
      { ...SAFE_ENTRY, title: 'Other', source: 'Please answer in Polish.' },
    ])

    const questionIds = Object.keys(decideCalls()[0]!.questions)

    expect(questionIds.filter(id => id.startsWith('c0__')).sort())
      .toEqual([...ART9_QUESTIONS, 'never-store'].map((question) => {
        return `c0__${question}`
      }).sort())
    expect(questionIds).toContain('c1__grounded')
    expect(questionIds).not.toContain('c0__grounded')
  })
})

describe('gate-first ordering', () => {
  it('never sends a candidate the deterministic gate refuses as never-store',
    async () => {
      const verdicts = await createChecker().check([CARD_ENTRY, SAFE_ENTRY])

      expect(sentText()).not.toContain('4111')
      expect(sentText()).toContain('Always answer in Polish.')
      expect(verdicts[0]).toEqual({ kind: 'clear' })
    })

  it('never sends a candidate the deterministic gate refuses as sensitive',
    async () => {
      await createChecker().check([HEALTH_ENTRY, SAFE_ENTRY])

      expect(sentText()).not.toContain('diabetes')
    })

  it('makes no call at all when the gate refuses every candidate',
    async () => {
      const verdicts = await createChecker().check([CARD_ENTRY, HEALTH_ENTRY])

      expect(mocks.decide).not.toHaveBeenCalled()
      expect(verdicts).toEqual([{ kind: 'clear' }, { kind: 'clear' }])
    })

  it('redacts never-store values out of the source excerpt', async () => {
    await createChecker().check([{
      ...SAFE_ENTRY,
      source: 'Answer in Polish. My card is 4111 1111 1111 1111.',
    }])

    expect(sentText()).not.toContain('4111')
    expect(Object.keys(decideCalls()[0]!.questions)).toContain('c0__grounded')
  })

  it('drops a source excerpt the gate flags as sensitive and skips '
    + 'grounding for that candidate', async () => {
    await createChecker().check([{
      ...SAFE_ENTRY,
      source: 'Answer in Polish. I have type 2 diabetes.',
    }])

    expect(sentText()).not.toContain('diabetes')
    expect(Object.keys(decideCalls()[0]!.questions))
      .not.toContain('c0__grounded')
  })
})

describe('verdicts and thresholds', () => {
  it('blocks a sensitive category at exactly the threshold', async () => {
    answerWith({ 'c0__racial-or-ethnic-origin': 0.5 })

    const [verdict] = await createChecker().check([SAFE_ENTRY])

    expect(verdict).toEqual({
      kind: 'sensitive-topic',
      categories: ['racial-or-ethnic-origin'],
    })
  })

  it('keeps a candidate just below the sensitivity threshold', async () => {
    answerWith({ c0__health: 0.49 })

    const [verdict] = await createChecker().check([SAFE_ENTRY])

    expect(verdict).toEqual({ kind: 'clear' })
  })

  it('reports never-store ahead of a sensitive category', async () => {
    answerWith({ 'c0__never-store': 0.9, 'c0__health': 0.9 })

    const [verdict] = await createChecker().check([SAFE_ENTRY])

    expect(verdict).toEqual({ kind: 'never-store' })
  })

  it('rejects a candidate scored below the grounding threshold', async () => {
    answerWith({ c0__grounded: 0.49 })

    const [verdict] = await createChecker().check([{
      ...SAFE_ENTRY,
      source: 'We use Vue 3 and Nuxt.',
    }])

    expect(verdict).toEqual({ kind: 'ungrounded' })
  })

  it('keeps a candidate scored exactly at the grounding threshold',
    async () => {
      answerWith({ c0__grounded: 0.5 })

      const [verdict] = await createChecker().check([{
        ...SAFE_ENTRY,
        source: 'Please always answer in Polish.',
      }])

      expect(verdict).toEqual({ kind: 'clear' })
    })

  it('treats a missing answer as clear', async () => {
    mocks.decide.mockResolvedValue({ answers: {} })

    const [verdict] = await createChecker().check([{
      ...SAFE_ENTRY,
      source: 'Please always answer in Polish.',
    }])

    expect(verdict).toEqual({ kind: 'clear' })
  })

  it('keeps verdicts aligned with the input order around gate-refused '
    + 'candidates', async () => {
    answerWith({ c1__health: 0.9 })

    const verdicts = await createChecker().check([
      CARD_ENTRY,
      SAFE_ENTRY,
      { ...SAFE_ENTRY, title: 'Second' },
    ])

    expect(verdicts).toEqual([
      { kind: 'clear' },
      { kind: 'sensitive-topic', categories: ['health'] },
      { kind: 'clear' },
    ])
  })
})

describe('batching', () => {
  it('asks about several candidates in one call', async () => {
    await createChecker().check([
      SAFE_ENTRY,
      { ...SAFE_ENTRY, title: 'Two' },
      { ...SAFE_ENTRY, title: 'Three' },
    ])

    expect(mocks.decide).toHaveBeenCalledTimes(1)
    expect(Object.keys(decideCalls()[0]!.questions)).toHaveLength(27)
  })

  it('splits candidates across calls at the question cap', async () => {
    const candidates = Array.from({ length: 12 }, (_value, index) => {
      return {
        ...SAFE_ENTRY,
        title: `Entry ${index}`,
        source: 'Please always answer in Polish.',
      }
    })

    await createChecker().check(candidates)

    expect(mocks.decide).toHaveBeenCalledTimes(2)

    for (const call of decideCalls()) {
      expect(Object.keys(call.questions).length)
        .toBeLessThanOrEqual(MEMORY_JEV_MAX_QUESTIONS_PER_CALL)
    }
  })
})

describe('fail-open', () => {
  function apiError(statusCode: number | undefined) {
    return new APICallError({
      message: 'failed',
      url: 'https://api.typesafe.ai/v1/systemone',
      requestBodyValues: {},
      statusCode,
    })
  }

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'rate-limited'],
    [529, 'rate-limited'],
    [500, 'error'],
  ])('lets every candidate through on a %i and logs %s',
    async (statusCode, status) => {
      mocks.decide.mockRejectedValue(apiError(statusCode))

      const { fields, logger } = createLogger()
      const verdicts = await createChecker(logger).check([SAFE_ENTRY])

      expect(verdicts).toEqual([{ kind: 'clear' }])
      expect(fields.at(-1)?.attributes.memoryJev.status).toBe(status)
    })

  it('lets every candidate through on a timeout', async () => {
    mocks.decide.mockRejectedValue(
      new DOMException('The operation timed out.', 'TimeoutError'),
    )

    const { fields, logger } = createLogger()
    const verdicts = await createChecker(logger).check([SAFE_ENTRY])

    expect(verdicts).toEqual([{ kind: 'clear' }])
    expect(fields.at(-1)?.attributes.memoryJev.status).toBe('timeout')
  })

  it('lets every candidate through on a network error', async () => {
    mocks.decide.mockRejectedValue(new TypeError('fetch failed'))

    const verdicts = await createChecker().check([SAFE_ENTRY])

    expect(verdicts).toEqual([{ kind: 'clear' }])
    expect(classifyMemoryJevFailure(new TypeError('fetch failed')))
      .toBe('network')
    expect(classifyMemoryJevFailure(apiError(undefined))).toBe('network')
  })

  it('keeps verdicts from a call that succeeded before a later one failed',
    async () => {
      let call = 0

      mocks.decide.mockImplementation(async (options: DecideCall) => {
        call += 1

        if (call > 1) {
          throw apiError(429)
        }

        return {
          answers: answersFor(options.questions, { c0__health: 0.9 }),
        }
      })

      const candidates = Array.from({ length: 12 }, (_value, index) => {
        return {
          ...SAFE_ENTRY,
          title: `Entry ${index}`,
          source: 'Please always answer in Polish.',
        }
      })
      const verdicts = await createChecker().check(candidates)

      expect(verdicts[0]).toEqual({
        kind: 'sensitive-topic',
        categories: ['health'],
      })
      expect(verdicts.at(-1)).toEqual({ kind: 'clear' })
      expect(mocks.decide).toHaveBeenCalledTimes(2)
    })
})

describe('logging', () => {
  it('logs counts under attributes.memoryJev and never any text', async () => {
    answerWith({ 'c0__political-opinion': 0.8, 'c1__grounded': 0.1 })

    const { fields, logger } = createLogger()

    await createChecker(logger).check([
      { ...SAFE_ENTRY, body: 'Plays chess on Sundays.' },
      { ...SAFE_ENTRY, title: 'Stack', source: 'We use Vue 3.' },
    ])

    expect(fields).toHaveLength(1)
    expect(Object.keys(fields[0]!)).toEqual(['attributes'])
    expect(fields[0]!.attributes.memoryJev).toEqual({
      model: 'jev-1.14.0',
      questions: 19,
      blocked: 1,
      groundingRejected: 1,
      gateDisagreements: { 'political-opinion': 1 },
      latencyMs: expect.any(Number),
      status: 'ok',
    })
    expect(JSON.stringify(fields)).not.toContain('chess')
    expect(JSON.stringify(fields)).not.toContain('Vue')
  })

  it('adds to the tally already logged in the same request', async () => {
    answerWith({ c0__health: 0.8 })

    const fields: Array<Record<string, any>> = []
    const logger = {
      set: (value: Record<string, any>) => {
        fields.push(value)
      },
      getContext: () => fields.at(-1) ?? {},
    }
    const checker = createChecker(logger)

    await checker.check([SAFE_ENTRY])
    await checker.check([SAFE_ENTRY])

    expect(fields.at(-1)?.attributes.memoryJev).toMatchObject({
      questions: 18,
      blocked: 2,
      gateDisagreements: { health: 2 },
    })
  })
})

describe('resolveMemoryJevChecker', () => {
  function dbWithKey(
    row: { apiKey: string } | undefined | Error,
    typesafeRoles: Record<string, boolean> | null = null,
  ) {
    const findFirst = vi.fn(async () => {
      if (row instanceof Error) {
        throw row
      }

      return row
    })
    const settingsFindFirst = vi.fn(async () => ({ typesafeRoles }))

    return {
      db: {
        query: {
          keys: { findFirst },
          userSettings: { findFirst: settingsFindFirst },
        },
      } as any,
      findFirst,
      settingsFindFirst,
    }
  }

  it('returns null without a saved TypeSafe AI key', async () => {
    const { db, findFirst } = dbWithKey(undefined)

    expect(await resolveMemoryJevChecker({ db, userId: 7 })).toBeNull()
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 7, provider: 'typesafe' },
    }))
  })

  it('decrypts the saved key and builds a checker', async () => {
    const { db } = dbWithKey({ apiKey: 'encrypted:ts-user-key' })
    const checker = await resolveMemoryJevChecker({ db, userId: 7 })

    expect(mocks.decrypt).toHaveBeenCalledWith('encrypted:ts-user-key')
    expect(checker).not.toBeNull()
  })

  it('logs key-error and returns null when the key cannot be read',
    async () => {
      const { db } = dbWithKey(new Error('D1 down'))
      const { fields, logger } = createLogger()

      expect(await resolveMemoryJevChecker({ db, userId: 7, logger }))
        .toBeNull()
      expect(fields[0]?.attributes.memoryJev.status).toBe('key-error')
    })

  it('returns null without reading settings when there is no key',
    async () => {
      const { db, settingsFindFirst } = dbWithKey(undefined)

      expect(await resolveMemoryJevChecker({ db, userId: 7 })).toBeNull()
      expect(settingsFindFirst).not.toHaveBeenCalled()
    })

  it('returns null when the user switched memory checks off', async () => {
    const { db, settingsFindFirst } = dbWithKey(
      { apiKey: 'encrypted:ts-user-key' },
      { memoryChecks: false },
    )

    expect(await resolveMemoryJevChecker({ db, userId: 7 })).toBeNull()
    expect(settingsFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 7 },
    }))
  })

  it('keeps memory checks on when only other roles are switched off',
    async () => {
      const { db } = dbWithKey(
        { apiKey: 'encrypted:ts-user-key' },
        { autoWebSearch: false, rerank: false },
      )

      expect(await resolveMemoryJevChecker({ db, userId: 7 })).not.toBeNull()
    })

  it('returns null when decryption fails', async () => {
    const { db } = dbWithKey({ apiKey: 'garbage' })

    mocks.decrypt.mockRejectedValue(new Error('bad cipher'))

    expect(await resolveMemoryJevChecker({ db, userId: 7 })).toBeNull()
  })
})

describe('assertMemoryJevAllowed', () => {
  it('does nothing without a checker', async () => {
    await expect(assertMemoryJevAllowed(null, SAFE_ENTRY)).resolves
      .toBeUndefined()
  })

  it('throws the same 422 as the gate, marked as the extra check',
    async () => {
      answerWith({ 'c0__sex-life-or-orientation': 0.9 })

      await expect(
        assertMemoryJevAllowed(createChecker(), SAFE_ENTRY),
      ).rejects.toMatchObject({
        status: 422,
        message: 'Sensitive topics (health, religion, politics…) are not '
          + 'saved to memory.',
        why: expect.stringContaining('TypeSafe AI'),
        data: { kind: 'extra-check', reason: 'sensitive-topic' },
      })
    })

  it('lets the entry through when Jev is unavailable', async () => {
    mocks.decide.mockRejectedValue(new TypeError('fetch failed'))

    await expect(assertMemoryJevAllowed(createChecker(), SAFE_ENTRY))
      .resolves.toBeUndefined()
  })
})

describe('buildMemoryJevGroundingExcerpt', () => {
  it('cuts a window around the evidence quote', () => {
    const text = `${'a'.repeat(500)} i write rust on weekends ${'b'.repeat(500)}`
    const excerpt = buildMemoryJevGroundingExcerpt(
      'I write Rust on weekends',
      [text],
    )

    expect(excerpt).toContain('i write rust on weekends')
    expect(excerpt.length).toBeLessThan(text.length)
    expect(excerpt.length).toBeGreaterThan('i write rust on weekends'.length)
  })

  it('falls back to the quote when it is not found verbatim', () => {
    expect(buildMemoryJevGroundingExcerpt('Likes tea', ['nothing here']))
      .toBe('likes tea')
  })
})
