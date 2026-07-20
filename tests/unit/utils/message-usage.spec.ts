import type { LanguageModelUsage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  addImageGenerationCostToUsage,
  addResearchCostEstimateToUsage,
  buildMessageUsage,
} from '../../../server/utils/ai/message-usage'

const PRICED_MODEL_ID = 'gpt-5.4'
const PRICED_PROVIDER_ID = 'openai'
const PRICED_MODEL_INPUT_PER_MILLION = 2.5
const PRICED_MODEL_OUTPUT_PER_MILLION = 15

function createUsage(
  overrides: Partial<LanguageModelUsage> = {},
): LanguageModelUsage {
  return {
    inputTokens: undefined,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens: undefined,
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined,
    },
    totalTokens: undefined,
    ...overrides,
  }
}

describe('buildMessageUsage', () => {
  it('returns undefined for incomplete usage', () => {
    const usage = createUsage()

    const result = buildMessageUsage(
      usage,
      PRICED_MODEL_ID,
      PRICED_PROVIDER_ID,
    )

    expect(result).toBeUndefined()
  })

  it('maps tokens and costs for a known-priced model', () => {
    const usage = createUsage({
      inputTokens: 1000,
      inputTokenDetails: {
        noCacheTokens: 800,
        cacheReadTokens: 200,
        cacheWriteTokens: undefined,
      },
      outputTokens: 500,
      outputTokenDetails: {
        textTokens: 380,
        reasoningTokens: 120,
      },
      totalTokens: 1500,
    })

    const result = buildMessageUsage(
      usage,
      PRICED_MODEL_ID,
      PRICED_PROVIDER_ID,
    )

    expect(result).toEqual({
      model: PRICED_MODEL_ID,
      provider: PRICED_PROVIDER_ID,
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      reasoningTokens: 120,
      cachedInputTokens: 200,
      inputCost: (1000 * PRICED_MODEL_INPUT_PER_MILLION) / 1_000_000,
      outputCost: (500 * PRICED_MODEL_OUTPUT_PER_MILLION) / 1_000_000,
    })
  })

  it('omits cost fields for an unpriced model', () => {
    const usage = createUsage({
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    })

    const result = buildMessageUsage(
      usage,
      'unknown-model-xyz',
      PRICED_PROVIDER_ID,
    )

    expect(result?.inputTokens).toBe(1000)
    expect(result?.outputTokens).toBe(500)
    expect(result?.totalTokens).toBe(1500)
    expect(result?.inputCost).toBeUndefined()
    expect(result?.outputCost).toBeUndefined()
  })

  it('coalesces missing totalTokens to inputTokens plus outputTokens', () => {
    const usage = createUsage({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: undefined,
    })

    const result = buildMessageUsage(
      usage,
      PRICED_MODEL_ID,
      PRICED_PROVIDER_ID,
    )

    expect(result?.totalTokens).toBe(30)
  })

  it('omits reasoningTokens and cachedInputTokens when absent', () => {
    const usage = createUsage({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    })

    const result = buildMessageUsage(
      usage,
      PRICED_MODEL_ID,
      PRICED_PROVIDER_ID,
    )

    expect(result).not.toHaveProperty('reasoningTokens')
    expect(result).not.toHaveProperty('cachedInputTokens')
  })
})

describe('addImageGenerationCostToUsage', () => {
  it('adds the image cost onto an existing outputCost', () => {
    const usage = buildMessageUsage(
      createUsage({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      }),
      PRICED_MODEL_ID,
      PRICED_PROVIDER_ID,
    )

    const result = addImageGenerationCostToUsage(usage, 0.067)

    expect(result?.outputCost).toBeCloseTo(
      (500 * PRICED_MODEL_OUTPUT_PER_MILLION) / 1_000_000 + 0.067,
    )
  })

  it('adds the image cost even when there is no text outputCost', () => {
    const usage = buildMessageUsage(
      createUsage({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      }),
      'unknown-model-xyz',
      PRICED_PROVIDER_ID,
    )

    const result = addImageGenerationCostToUsage(usage, 0.067)

    expect(result?.outputCost).toBe(0.067)
  })

  it('returns usage unchanged when no image was generated', () => {
    const usage = buildMessageUsage(
      createUsage({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      }),
      PRICED_MODEL_ID,
      PRICED_PROVIDER_ID,
    )

    const result = addImageGenerationCostToUsage(usage, undefined)

    expect(result).toEqual(usage)
  })

  it('returns undefined unchanged when usage itself is undefined', () => {
    const result = addImageGenerationCostToUsage(undefined, 0.067)

    expect(result).toBeUndefined()
  })
})

describe('addResearchCostEstimateToUsage', () => {
  it('fills in the midpoint task estimate for a Google deep research usage with totals-only tokens', () => {
    const usage = buildMessageUsage(
      createUsage({ totalTokens: 1130546 }),
      'deep-research-preview-04-2026',
      'google',
    )

    const result = addResearchCostEstimateToUsage(
      usage,
      'deep-research-preview-04-2026',
    )

    expect(result?.outputCost).toBe(2)
    expect(result?.costEstimated).toBe(true)
  })

  it('leaves an OpenAI deep research usage with a real computed cost unchanged', () => {
    const usage = buildMessageUsage(
      createUsage({
        inputTokens: 49052,
        outputTokens: 35610,
        totalTokens: 84662,
      }),
      'o4-mini-deep-research',
      'openai',
    )

    const result = addResearchCostEstimateToUsage(
      usage,
      'o4-mini-deep-research',
    )

    expect(result).toEqual(usage)
  })

  it('is a no-op for a regular non-research model', () => {
    const usage = buildMessageUsage(
      createUsage({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      }),
      PRICED_MODEL_ID,
      PRICED_PROVIDER_ID,
    )

    const result = addResearchCostEstimateToUsage(usage, PRICED_MODEL_ID)

    expect(result).toEqual(usage)
  })

  it('overwrites a fake $0 caused by an unknown split on a priced research model', () => {
    const usage = buildMessageUsage(
      createUsage({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 1000,
      }),
      'o4-mini-deep-research',
      'openai',
    )

    expect(usage?.outputCost).toBe(0)

    const result = addResearchCostEstimateToUsage(
      usage,
      'o4-mini-deep-research',
    )

    expect(result?.outputCost).toBe(1)
    expect(result?.costEstimated).toBe(true)
  })

  it('returns undefined unchanged when usage itself is undefined', () => {
    const result = addResearchCostEstimateToUsage(
      undefined,
      'deep-research-preview-04-2026',
    )

    expect(result).toBeUndefined()
  })
})
