import {
  APICallError,
  Experimental_DecisionRefusalError,
  RetryError,
} from 'ai'
import { createTypeSafeAi } from '@ai-sdk/typesafe-ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  JEV_AUTO_WEB_SEARCH,
  JEV_MODEL_ID,
  JEV_RERANK,
} from '#shared/utils/jev-policy'
import {
  classifyJevFailure,
  createJevDecisionModel,
  jevDecide,
  readJevApiKey,
} from '~~/server/utils/jev/client'

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  decrypt: vi.fn(),
  useRealDecide: false,
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    experimental_decide: (
      ...args: Parameters<typeof actual.experimental_decide>
    ) => {
      if (mocks.useRealDecide) {
        return actual.experimental_decide(...args)
      }

      return mocks.decide(...args)
    },
  }
})

vi.mock('~~/server/utils/encryption', () => ({
  useDecryptText: (value: string) => mocks.decrypt(value),
}))

function apiError(statusCode: number | undefined) {
  return new APICallError({
    message: 'failed',
    url: 'https://api.typesafe.ai/v1/systemone',
    requestBodyValues: {},
    statusCode,
  })
}

function testModel() {
  const model = createJevDecisionModel('ts-test-key')

  if (!model) {
    throw new Error('expected a model')
  }

  return model
}

const WEB_SEARCH_QUESTIONS = {
  [JEV_AUTO_WEB_SEARCH.questionId]: JEV_AUTO_WEB_SEARCH.question,
}

beforeEach(() => {
  mocks.useRealDecide = false
  mocks.decide.mockReset()
  mocks.decrypt.mockReset()
})

describe('classifyJevFailure', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'rate-limited'],
    [529, 'rate-limited'],
    [500, 'error'],
    [400, 'error'],
  ] as const)('maps HTTP %i to %s', (statusCode, expected) => {
    expect(classifyJevFailure(apiError(statusCode))).toBe(expected)
  })

  it('reads the status of the last error inside a retry error', () => {
    const exception = new RetryError({
      message: 'retries exhausted',
      reason: 'maxRetriesExceeded',
      errors: [apiError(429)],
    })

    expect(classifyJevFailure(exception)).toBe('rate-limited')
  })

  it('maps timeouts and aborts, also when wrapped as a cause', () => {
    const timeout = new DOMException('timed out', 'TimeoutError')
    const abort = new DOMException('aborted', 'AbortError')
    const wrapped = new Error('request failed', { cause: timeout })

    expect(classifyJevFailure(timeout)).toBe('timeout')
    expect(classifyJevFailure(abort)).toBe('timeout')
    expect(classifyJevFailure(wrapped)).toBe('timeout')
  })

  it('maps a fetch failure without a status to network', () => {
    expect(classifyJevFailure(new TypeError('fetch failed'))).toBe('network')
    expect(classifyJevFailure(apiError(undefined))).toBe('network')
  })

  it('maps a refusal answer and anything unknown to error', () => {
    const refusal = new Experimental_DecisionRefusalError({
      questionIds: ['w1_live'],
      answers: {},
    } as never)

    expect(classifyJevFailure(refusal)).toBe('error')
    expect(classifyJevFailure('boom')).toBe('error')
  })
})

describe('createJevDecisionModel', () => {
  it('returns null for an empty key so the SDK never reads an env var', () => {
    expect(createJevDecisionModel('   ')).toBeNull()
  })

  it('pins the eval model', () => {
    expect(JEV_MODEL_ID).toBe('jev-1.14.0')
    expect(testModel().modelId).toBe('jev-1.14.0')
  })
})

describe('readJevApiKey', () => {
  it('reads the typesafe key row and decrypts it', async () => {
    const findFirst = vi.fn(async () => ({ apiKey: 'encrypted:key' }))

    mocks.decrypt.mockResolvedValue('plain-key')

    const apiKey = await readJevApiKey({
      db: { query: { keys: { findFirst } } } as any,
      userId: 9,
    })

    expect(apiKey).toBe('plain-key')
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 9, provider: 'typesafe' },
      columns: { apiKey: true },
    })
  })

  it('returns null without a key and lets read errors through', async () => {
    const missing = vi.fn(async () => undefined)
    const failing = vi.fn(async () => {
      throw new Error('D1 down')
    })

    expect(await readJevApiKey({
      db: { query: { keys: { findFirst: missing } } } as any,
      userId: 9,
    })).toBeNull()
    await expect(readJevApiKey({
      db: { query: { keys: { findFirst: failing } } } as any,
      userId: 9,
    })).rejects.toThrow('D1 down')
    expect(mocks.decrypt).not.toHaveBeenCalled()
  })
})

describe('jevDecide', () => {
  it('returns probabilities by question id, with no retries and a timeout',
    async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')

      mocks.decide.mockResolvedValue({
        answers: { w1_live: { type: 'boolean', probability: 0.73 } },
        usage: { inputTokens: 443 },
      })

      const result = await jevDecide({
        model: testModel(),
        state: { recent_turns: [], message: 'Bitcoin price?' },
        questions: WEB_SEARCH_QUESTIONS,
        timeoutMs: 800,
      })
      const [options] = mocks.decide.mock.calls[0]!

      expect(result).toMatchObject({
        ok: true,
        status: 'ok',
        probabilities: { w1_live: 0.73 },
        inputTokens: 443,
      })
      expect(options.maxRetries).toBe(0)
      expect(options.abortSignal).toBeInstanceOf(AbortSignal)
      expect(timeoutSpy).toHaveBeenCalledWith(800)

      timeoutSpy.mockRestore()
    })

  it('never throws and classifies the failure', async () => {
    mocks.decide.mockRejectedValue(apiError(529))

    const result = await jevDecide({
      model: testModel(),
      state: 'state',
      questions: WEB_SEARCH_QUESTIONS,
      timeoutMs: 800,
    })

    expect(result).toMatchObject({ ok: false, status: 'rate-limited' })
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('times out a hung call', async () => {
    mocks.decide.mockImplementation(({ abortSignal }) => {
      return new Promise((_resolve, reject) => {
        abortSignal.addEventListener('abort', () => {
          reject(abortSignal.reason)
        })
      })
    })

    const result = await jevDecide({
      model: testModel(),
      state: 'state',
      questions: WEB_SEARCH_QUESTIONS,
      timeoutMs: 5,
    })

    expect(result).toMatchObject({ ok: false, status: 'timeout' })
  })

  it('follows the caller abort signal', async () => {
    const controller = new AbortController()

    mocks.decide.mockImplementation(({ abortSignal }) => {
      return new Promise((_resolve, reject) => {
        abortSignal.addEventListener('abort', () => {
          reject(abortSignal.reason)
        })
      })
    })

    const pending = jevDecide({
      model: testModel(),
      state: 'state',
      questions: WEB_SEARCH_QUESTIONS,
      timeoutMs: 60_000,
      abortSignal: controller.signal,
    })

    controller.abort()

    expect(await pending).toMatchObject({ ok: false, status: 'timeout' })
  })
})

describe('SDK path (no raw fetch)', () => {
  it('sends criteria, object instructions and a JSON state to '
    + '/v1/systemone through experimental_decide', async () => {
    const requests: Array<{ url: string, body: any, headers: Headers }> = []
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({
        url,
        body: JSON.parse(String(init.body)),
        headers: new Headers(init.headers),
      })

      return new Response(JSON.stringify({
        model: 'jev-1.14.0',
        answers: {
          w1_live: { type: 'noul', noul: 0.81 },
          c0: { type: 'noul', noul: 0.12 },
        },
        usage: { input_tokens: 500, output_tokens: 0 },
      }), { headers: { 'content-type': 'application/json' } })
    })
    const model = createTypeSafeAi({
      apiKey: 'ts-test-key',
      fetch: fetchSpy as unknown as typeof fetch,
    }).decisionModel(JEV_MODEL_ID)

    mocks.useRealDecide = true

    const result = await jevDecide({
      model,
      state: { recent_turns: ['hi'], message: 'Who won yesterday?' },
      questions: {
        ...WEB_SEARCH_QUESTIONS,
        c0: {
          type: 'boolean',
          instructions: { task: JEV_RERANK.task, passage: 'A passage.' },
          criteria: JEV_RERANK.criteria,
        },
      },
      timeoutMs: 800,
    })
    const [request] = requests

    expect(request?.url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(request?.headers.get('authorization')).toBe('Bearer ts-test-key')
    expect(request?.headers.get('typesafe-danger-zone-long-context')).toBeNull()
    expect(request?.body).toEqual({
      model: 'jev-1.14.0',
      state: { recent_turns: ['hi'], message: 'Who won yesterday?' },
      questions: {
        w1_live: {
          type: 'noul',
          instructions: JEV_AUTO_WEB_SEARCH.question.instructions,
          criteria: JEV_AUTO_WEB_SEARCH.question.criteria,
        },
        c0: {
          type: 'noul',
          instructions: { task: JEV_RERANK.task, passage: 'A passage.' },
          criteria: JEV_RERANK.criteria,
        },
      },
    })
    expect(result).toMatchObject({
      ok: true,
      probabilities: { w1_live: 0.81, c0: 0.12 },
      inputTokens: 500,
    })
  })

  it('reports a 401 from the API as unauthorized', async () => {
    const model = createTypeSafeAi({
      apiKey: 'ts-bad-key',
      fetch: (async () => {
        return new Response(JSON.stringify({ message: 'bad key' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      }) as unknown as typeof fetch,
    }).decisionModel(JEV_MODEL_ID)

    mocks.useRealDecide = true

    expect(await jevDecide({
      model,
      state: 'state',
      questions: WEB_SEARCH_QUESTIONS,
      timeoutMs: 800,
    })).toMatchObject({ ok: false, status: 'unauthorized' })
  })
})
