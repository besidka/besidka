import { APICallError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JEV_INJECTION_SCREENING } from '#shared/utils/jev-policy'
import { createJevDecisionModel } from '~~/server/utils/jev/client'
import {
  screenTextsForInjection,
  splitTextForInjectionScreening,
} from '~~/server/utils/jev/injection-screening'

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    experimental_decide: (...args: unknown[]) => mocks.decide(...args),
  }
})

const { questionId, flagAtOrAbove, maxChunkTokens, maxConcurrentCalls }
  = JEV_INJECTION_SCREENING
const CARD_NUMBER = '4111 1111 1111 1111'
const INJECTION_MARKER = 'INJECTION'

interface DecideCall {
  state: { text: string }
  questions: Record<string, unknown>
}

function testModel() {
  const model = createJevDecisionModel('ts-test-key')

  if (!model) {
    throw new Error('expected a model')
  }

  return model
}

function answer(probability: number) {
  return {
    answers: { [questionId]: { type: 'boolean', probability } },
    usage: { inputTokens: 10 },
  }
}

function scoreByMarker() {
  mocks.decide.mockImplementation(async (call: DecideCall) => {
    return answer(call.state.text.includes(INJECTION_MARKER) ? 0.9 : 0.05)
  })
}

function decidedTexts(): string[] {
  return mocks.decide.mock.calls.map((call) => {
    return (call[0] as DecideCall).state.text
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

function createLogger() {
  let context: Record<string, unknown> = {}

  return {
    set: vi.fn((fields: Record<string, unknown>) => {
      context = { ...context, ...fields }
    }),
    getContext: () => context,
  }
}

function longLatinText(lines: number): string {
  return Array.from({ length: lines }, (_value, index) => {
    return `Line ${index} of a long project document about gardening.`
  }).join('\n')
}

describe('splitTextForInjectionScreening', () => {
  it('keeps a short text as one chunk', () => {
    expect(splitTextForInjectionScreening('Short text.')).toEqual([
      'Short text.',
    ])
  })

  it('cuts a long text at line breaks into chunks under the cap', () => {
    const text = longLatinText(1200)
    const chunks = splitTextForInjectionScreening(text)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(text)

    for (const chunk of chunks) {
      expect(chunk.endsWith('\n') || chunk === chunks.at(-1)).toBe(true)
      expect(chunk.length).toBeLessThanOrEqual(maxChunkTokens * 3.5)
    }
  })

  it('slices a single huge line so a chunk never exceeds the cap', () => {
    const chunks = splitTextForInjectionScreening('ж'.repeat(10_000))

    expect(chunks.length).toBeGreaterThan(1)

    for (const chunk of chunks) {
      expect(Array.from(chunk).length).toBeLessThanOrEqual(maxChunkTokens * 1.5)
    }
  })

  it('drops whitespace-only chunks', () => {
    expect(splitTextForInjectionScreening('   \n  ')).toEqual([])
  })
})

describe('screenTextsForInjection', () => {
  beforeEach(() => {
    mocks.decide.mockReset()
  })

  it('asks the pinned i2_attack question with the text as state', async () => {
    mocks.decide.mockResolvedValue(answer(0.05))

    await screenTextsForInjection({
      model: testModel(),
      texts: ['Plain README text.'],
      source: 'knowledge',
      timeoutMs: JEV_INJECTION_SCREENING.timeoutMs,
    })

    expect(mocks.decide).toHaveBeenCalledTimes(1)

    const call = mocks.decide.mock.calls[0]![0] as DecideCall

    expect(call.state).toEqual({ text: 'Plain README text.' })
    expect(call.questions).toEqual({
      [questionId]: JEV_INJECTION_SCREENING.question,
    })
  })

  it('flags at the threshold and keeps a text below it', async () => {
    mocks.decide
      .mockResolvedValueOnce(answer(flagAtOrAbove))
      .mockResolvedValueOnce(answer(flagAtOrAbove - 0.01))

    const verdicts = await screenTextsForInjection({
      model: testModel(),
      texts: ['first', 'second'],
      source: 'search',
      timeoutMs: JEV_INJECTION_SCREENING.searchResultsTimeoutMs,
    })

    expect(verdicts).toEqual(['flagged', 'clean'])
  })

  it('flags a long text when only its last chunk is an injection', async () => {
    scoreByMarker()

    const text = `${longLatinText(1200)}\n${INJECTION_MARKER}`
    const verdicts = await screenTextsForInjection({
      model: testModel(),
      texts: [text],
      source: 'knowledge',
      timeoutMs: JEV_INJECTION_SCREENING.timeoutMs,
    })

    expect(verdicts).toEqual(['flagged'])
    expect(mocks.decide.mock.calls.length).toBe(
      splitTextForInjectionScreening(text).length,
    )
  })

  it('stops sending a text once one chunk is flagged', async () => {
    scoreByMarker()

    const text = `${INJECTION_MARKER}\n${longLatinText(4000)}`
    const chunkCount = splitTextForInjectionScreening(text).length

    await screenTextsForInjection({
      model: testModel(),
      texts: [text],
      source: 'knowledge',
      timeoutMs: JEV_INJECTION_SCREENING.timeoutMs,
    })

    expect(chunkCount).toBeGreaterThan(maxConcurrentCalls)
    expect(mocks.decide).toHaveBeenCalledTimes(maxConcurrentCalls)
  })

  it('never runs more calls at once than maxConcurrentCalls', async () => {
    let inFlight = 0
    let maxInFlight = 0

    mocks.decide.mockImplementation(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      inFlight--

      return answer(0.05)
    })

    await screenTextsForInjection({
      model: testModel(),
      texts: Array.from({ length: 10 }, (_value, index) => `text ${index}`),
      source: 'search',
      timeoutMs: JEV_INJECTION_SCREENING.searchResultsTimeoutMs,
    })

    expect(mocks.decide).toHaveBeenCalledTimes(10)
    expect(maxInFlight).toBe(maxConcurrentCalls)
  })

  it('redacts never-store values before the text leaves', async () => {
    mocks.decide.mockResolvedValue(answer(0.05))

    await screenTextsForInjection({
      model: testModel(),
      texts: [`Pay with card ${CARD_NUMBER} please.`],
      source: 'knowledge',
      timeoutMs: JEV_INJECTION_SCREENING.timeoutMs,
    })

    expect(decidedTexts()[0]).not.toContain(CARD_NUMBER)
    expect(decidedTexts()[0]).toContain('Pay with card')
  })

  it.each([
    ['401', () => apiError(401), 'unauthorized'],
    ['429', () => apiError(429), 'rate-limited'],
    ['timeout', () => {
      return Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    }, 'timeout'],
  ])('on a %s stops calling and leaves the rest unscreened', async (
    _label,
    createException,
    expectedStatus,
  ) => {
    mocks.decide
      .mockResolvedValueOnce(answer(0.9))
      .mockRejectedValueOnce(createException())
      .mockResolvedValue(answer(0.05))

    const logger = createLogger()
    const verdicts = await screenTextsForInjection({
      model: testModel(),
      texts: ['a', 'b', 'c', 'd', 'e'],
      source: 'search',
      timeoutMs: JEV_INJECTION_SCREENING.searchResultsTimeoutMs,
      logger,
    })

    expect(mocks.decide).toHaveBeenCalledTimes(maxConcurrentCalls)
    expect(verdicts).toEqual([
      'flagged',
      'unscreened',
      'clean',
      'unscreened',
      'unscreened',
    ])
    expect(logger.getContext()).toMatchObject({
      attributes: {
        injectionScreeningJev: {
          status: expectedStatus,
          calls: maxConcurrentCalls,
          counts: {
            searchFlagged: 1,
            searchClean: 1,
            searchUnscreened: 3,
          },
        },
      },
    })
  })

  it('treats a missing probability as a failure, never as clean', async () => {
    mocks.decide.mockResolvedValue({ answers: {}, usage: {} })

    const verdicts = await screenTextsForInjection({
      model: testModel(),
      texts: ['a'],
      source: 'knowledge',
      timeoutMs: JEV_INJECTION_SCREENING.timeoutMs,
    })

    expect(verdicts).toEqual(['unscreened'])
  })

  it('logs counts and scores only, never the text', async () => {
    scoreByMarker()

    const logger = createLogger()

    await screenTextsForInjection({
      model: testModel(),
      texts: [`secret plan ${INJECTION_MARKER}`, 'secret recipe'],
      source: 'knowledge',
      timeoutMs: JEV_INJECTION_SCREENING.timeoutMs,
      logger,
    })

    const logged = JSON.stringify(logger.getContext())

    expect(logged).not.toContain('secret')
    expect(logger.getContext()).toMatchObject({
      attributes: {
        injectionScreeningJev: {
          model: 'jev-1.14.0',
          status: 'ok',
          calls: 2,
          inputTokens: 20,
          counts: { knowledgeFlagged: 1, knowledgeClean: 1 },
          scores: [0.9, 0.05],
        },
      },
    })
  })

  it('makes no call and logs nothing for empty texts', async () => {
    const logger = createLogger()
    const verdicts = await screenTextsForInjection({
      model: testModel(),
      texts: ['', '  '],
      source: 'knowledge',
      timeoutMs: JEV_INJECTION_SCREENING.timeoutMs,
      logger,
    })

    expect(verdicts).toEqual(['clean', 'clean'])
    expect(mocks.decide).not.toHaveBeenCalled()
    expect(logger.set).not.toHaveBeenCalled()
  })
})
