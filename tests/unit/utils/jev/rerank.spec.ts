import { APICallError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JEV_RERANK } from '#shared/utils/jev-policy'
import {
  countKnowledgeChars,
  estimateKnowledgeTextTokens,
} from '#shared/utils/project-knowledge-budget'
import { createJevDecisionModel } from '~~/server/utils/jev/client'
import {
  createJevRerankModelResolver,
  orderByRelevance,
  rerankWithJev,
} from '~~/server/utils/jev/rerank'

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

const CARD_NUMBER = '4111 1111 1111 1111'

function testModel() {
  const model = createJevDecisionModel('ts-test-key')

  if (!model) {
    throw new Error('expected a model')
  }

  return model
}

function apiError(statusCode: number) {
  return new APICallError({
    message: 'failed',
    url: 'https://api.typesafe.ai/v1/systemone',
    requestBodyValues: {},
    statusCode,
  })
}

function answerWith(scores: number[]) {
  mocks.decide.mockResolvedValue({
    answers: Object.fromEntries(scores.map((score, index) => {
      return [`c${index}`, { type: 'boolean', probability: score }]
    })),
    usage: { inputTokens: 321 },
  })
}

function createLogger() {
  const calls: Array<Record<string, any>> = []
  let context: Record<string, any> = {}

  return {
    calls,
    logger: {
      set: (fields: Record<string, any>) => {
        calls.push(fields)
        context = { ...context, ...fields }
      },
      getContext: () => context,
    },
    read: () => context.attributes?.rerankJev as Record<string, any>,
  }
}

function rerank(input: {
  candidates: string[]
  keepAtLeast?: number
  query?: string
  model?: ReturnType<typeof testModel> | null
  logger?: ReturnType<typeof createLogger>['logger']
}) {
  return rerankWithJev({
    model: input.model === undefined ? testModel() : input.model,
    query: input.query ?? 'launch plan',
    candidates: input.candidates,
    passageOf: candidate => candidate,
    keepAtLeast: input.keepAtLeast ?? 3,
    logger: input.logger,
  })
}

beforeEach(() => {
  mocks.decide.mockReset()
  mocks.decrypt.mockReset().mockImplementation(async (value: string) => value)
})

describe('orderByRelevance', () => {
  it('sorts by descending score and keeps the original order on ties', () => {
    expect(orderByRelevance([0.6, 0.9, 0.6, 0.95], 4).order)
      .toEqual([3, 1, 0, 2])
  })

  it('drops candidates below the cut when enough stay above it', () => {
    const { order, dropped } = orderByRelevance([0.9, 0.1, 0.8, 0.7, 0.2], 2)

    expect(order).toEqual([0, 2, 3])
    expect(dropped).toBe(2)
  })

  it('keeps the whole sorted list when fewer than keepAtLeast stay above',
    () => {
      const { order, dropped } = orderByRelevance([0.9, 0.1, 0.2, 0.3], 3)

      expect(order).toEqual([0, 3, 2, 1])
      expect(dropped).toBe(0)
    })

  it('never returns fewer than min(keepAtLeast, count) candidates', () => {
    let seed = 7

    function random() {
      seed = (seed * 1664525 + 1013904223) % 4294967296

      return seed / 4294967296
    }

    for (let round = 0; round < 200; round++) {
      const count = 1 + Math.floor(random() * JEV_RERANK.maxCandidates)
      const keepAtLeast = 1 + Math.floor(random() * 8)
      const scores = Array.from({ length: count }, () => random())
      const { order } = orderByRelevance(scores, keepAtLeast)

      expect(order.length).toBeGreaterThanOrEqual(
        Math.min(keepAtLeast, count),
      )
    }
  })
})

describe('rerankWithJev', () => {
  it('re-orders the candidates by the Jev probabilities', async () => {
    answerWith([0.2, 0.95, 0.7, 0.6])

    const ordered = await rerank({
      candidates: ['a', 'b', 'c', 'd'],
      keepAtLeast: 4,
    })

    expect(ordered).toEqual(['b', 'c', 'd', 'a'])
  })

  it('puts the query in the state and each passage in its own question',
    async () => {
      answerWith([0.9, 0.8])

      await rerank({ candidates: ['first passage', 'second passage'] })

      const [options] = mocks.decide.mock.calls[0]!

      expect(options.state).toEqual({ query: 'launch plan' })
      expect(Object.keys(options.questions)).toEqual(['c0', 'c1'])
      expect(options.questions.c0).toMatchObject({
        type: 'boolean',
        instructions: {
          task: JEV_RERANK.task,
          passage: 'first passage',
        },
        criteria: JEV_RERANK.criteria,
      })
      expect(options.questions.c1.instructions.passage)
        .toBe('second passage')
      expect(options.maxRetries).toBe(0)
    })

  it('applies the cut only when at least keepAtLeast remain above it',
    async () => {
      answerWith([0.9, 0.1, 0.8, 0.2])

      expect(await rerank({
        candidates: ['a', 'b', 'c', 'd'],
        keepAtLeast: 2,
      })).toEqual(['a', 'c'])

      answerWith([0.9, 0.1, 0.8, 0.2])

      expect(await rerank({
        candidates: ['a', 'b', 'c', 'd'],
        keepAtLeast: 3,
      })).toEqual(['a', 'c', 'd', 'b'])
    })

  it('returns the candidates unchanged without a model', async () => {
    const candidates = ['a', 'b', 'c']

    const ordered = await rerank({ candidates, model: null })

    expect(ordered).toBe(candidates)
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('does not call Jev for fewer than two candidates', async () => {
    const candidates = ['only']

    expect(await rerank({ candidates })).toBe(candidates)
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it.each([
    ['unauthorized', apiError(401)],
    ['rate-limited', apiError(429)],
    ['timeout', Object.assign(new Error('timed out'), {
      name: 'TimeoutError',
    })],
    ['network', new TypeError('fetch failed')],
  ])('keeps the BM25 order and logs %s on failure', async (status, failure) => {
    const { logger, read } = createLogger()

    mocks.decide.mockRejectedValue(failure)

    const candidates = ['a', 'b', 'c']
    const ordered = await rerank({ candidates, logger })

    expect(ordered).toBe(candidates)
    expect(read()).toMatchObject({ status, calls: 1, questions: 3 })
    expect(read().counts).toBeUndefined()
  })

  it('keeps the BM25 order when an answer is missing', async () => {
    const { logger, read } = createLogger()

    mocks.decide.mockResolvedValue({
      answers: {
        c0: { type: 'boolean', probability: 0.9 },
        c2: { type: 'boolean', probability: 0.95 },
      },
      usage: { inputTokens: 10 },
    })

    const candidates = ['a', 'b', 'c']

    expect(await rerank({ candidates, logger })).toBe(candidates)
    expect(read()).toMatchObject({ status: 'error' })
  })

  it('keeps the BM25 order when building the request throws', async () => {
    const { logger, read } = createLogger()
    const candidates = ['a', 'b']

    const ordered = await rerankWithJev({
      model: testModel(),
      query: 'q',
      candidates,
      passageOf: () => {
        throw new Error('boom')
      },
      keepAtLeast: 2,
      logger,
    })

    expect(ordered).toBe(candidates)
    expect(read()).toMatchObject({ status: 'error' })
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('judges at most the candidate cap and appends the rest unchanged',
    async () => {
      const candidates = Array.from({ length: 40 }, (_, index) => {
        return `passage ${index}`
      })

      answerWith(Array.from(
        { length: JEV_RERANK.maxCandidates },
        (_, index) => index === 5 ? 0.99 : 0.6,
      ))

      const ordered = await rerank({ candidates, keepAtLeast: 40 })
      const [options] = mocks.decide.mock.calls[0]!

      expect(Object.keys(options.questions)).toHaveLength(
        JEV_RERANK.maxCandidates,
      )
      expect(ordered).toHaveLength(40)
      expect(ordered[0]).toBe('passage 5')
      expect(ordered.slice(JEV_RERANK.maxCandidates))
        .toEqual(candidates.slice(JEV_RERANK.maxCandidates))
    })

  it('truncates long passages to the passage token cap', async () => {
    answerWith([0.9, 0.8])

    await rerank({
      candidates: ['word '.repeat(5000), 'short passage'],
    })

    const [options] = mocks.decide.mock.calls[0]!
    const passage = options.questions.c0.instructions.passage as string

    expect(passage.length).toBeLessThan(5000 * 5)
    expect(estimateKnowledgeTextTokens(countKnowledgeChars(passage), 'default'))
      .toBeLessThanOrEqual(JEV_RERANK.maxPassageTokens)
    expect(options.questions.c1.instructions.passage).toBe('short passage')
  })

  it('truncates a long query to the passage token cap', async () => {
    answerWith([0.9, 0.8])

    await rerank({
      query: 'pasted '.repeat(20_000),
      candidates: ['first passage', 'second passage'],
    })

    const [options] = mocks.decide.mock.calls[0]!
    const query = options.state.query as string

    expect(query.length).toBeGreaterThan(0)
    expect(estimateKnowledgeTextTokens(countKnowledgeChars(query), 'default'))
      .toBeLessThanOrEqual(JEV_RERANK.maxPassageTokens)
  })

  it('redacts never-store values from passages and the query before '
    + 'sending', async () => {
    answerWith([0.9, 0.8])

    await rerank({
      query: `pay with ${CARD_NUMBER}`,
      candidates: [`my card is ${CARD_NUMBER} for the trip`, 'plain text'],
    })

    const [options] = mocks.decide.mock.calls[0]!

    expect(JSON.stringify(options)).not.toContain('4111')
    expect(options.questions.c0.instructions.passage).toContain('my card is')
    expect(options.questions.c0.instructions.passage).toContain('for the trip')
  })

  it('redacts before truncating so a cut never leaves part of a value',
    async () => {
      answerWith([0.9, 0.8])

      const padding = 'word '.repeat(300)

      await rerank({
        candidates: [`${padding}${CARD_NUMBER}`, 'plain text'],
      })

      const [options] = mocks.decide.mock.calls[0]!

      expect(JSON.stringify(options)).not.toMatch(/4111|1111/)
    })

  it('logs counts, scores and status without any text', async () => {
    const { logger, read } = createLogger()

    answerWith([0.2, 0.95, 0.7, 0.9])

    await rerank({
      candidates: [
        'secret alpha',
        'secret beta',
        'secret gamma',
        'secret delta',
      ],
      query: 'secret query',
      keepAtLeast: 3,
      logger,
    })

    expect(read()).toMatchObject({
      status: 'ok',
      calls: 1,
      questions: 4,
      inputTokens: 321,
      counts: { candidates: 4, moved: 2, dropped: 1, redacted: 0 },
      scores: [0.95, 0.9, 0.7, 0.2],
    })
    expect(read().latencyMs).toBeTypeOf('number')
    expect(JSON.stringify(read())).not.toContain('secret')
  })
})

describe('createJevRerankModelResolver', () => {
  function createDb(input: {
    key?: { apiKey: string }
    typesafeRoles?: Record<string, boolean> | null
  }) {
    const keyFindFirst = vi.fn(async () => input.key)
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

  it('reads nothing until the first call and then resolves once', async () => {
    const { db, keyFindFirst } = createDb({ key: { apiKey: 'ts-key' } })
    const resolve = createJevRerankModelResolver({ db, userId: 1 })

    expect(keyFindFirst).not.toHaveBeenCalled()

    const [first, second] = await Promise.all([resolve(), resolve()])

    expect(first).not.toBeNull()
    expect(second).toBe(first)
    expect(keyFindFirst).toHaveBeenCalledTimes(1)
  })

  it('resolves to null without a key', async () => {
    const { db } = createDb({})

    expect(await createJevRerankModelResolver({ db, userId: 1 })())
      .toBeNull()
  })

  it('resolves to null when the rerank role is switched off', async () => {
    const { db } = createDb({
      key: { apiKey: 'ts-key' },
      typesafeRoles: { rerank: false },
    })

    expect(await createJevRerankModelResolver({ db, userId: 1 })())
      .toBeNull()
  })

  it('still resolves with another role switched off', async () => {
    const { db } = createDb({
      key: { apiKey: 'ts-key' },
      typesafeRoles: { memoryChecks: false },
    })

    expect(await createJevRerankModelResolver({ db, userId: 1 })())
      .not.toBeNull()
  })
})
