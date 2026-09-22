import type { LanguageModelUsage } from 'ai'
import { describe, expect, it } from 'vitest'
import type { SearchUsage } from '../../../server/utils/ai/search-usage'
import {
  addImageGenerationCostToUsage,
  addSearchUsage,
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

  it('never sets totalCost, which only ever comes from '
    + 'already-persisted messages', () => {
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

    expect(result).not.toHaveProperty('totalCost')
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

describe('addSearchUsage', () => {
  const querySearch: SearchUsage = {
    units: 3,
    billingUnit: 'query',
    cost: 0.036,
    googleQueries: 3,
    googleGroundedSteps: 1,
  }
  const groundedPromptSearch: SearchUsage = {
    units: 2,
    billingUnit: 'grounded-prompt',
    cost: 0.08,
    googleQueries: 3,
    googleGroundedSteps: 2,
  }

  function buildBaseUsage() {
    return buildMessageUsage(
      createUsage({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      }),
      PRICED_MODEL_ID,
      PRICED_PROVIDER_ID,
    )
  }

  it('attaches search fields while leaving cost/estimate fields untouched', () => {
    const usage = buildBaseUsage()
    const outputCostBefore = usage?.outputCost
    const inputCostBefore = usage?.inputCost

    const result = addSearchUsage(usage, querySearch)

    expect(result?.searchUnits).toBe(3)
    expect(result?.searchBillingUnit).toBe('query')
    expect(result?.searchCost).toBe(0.036)
    expect(result?.outputCost).toBe(outputCostBefore)
    expect(result?.inputCost).toBe(inputCostBefore)
    expect(result?.costEstimated).toBeUndefined()
  })

  it('records the count with no searchCost key when cost is undefined', () => {
    const usage = buildBaseUsage()

    const result = addSearchUsage(usage, { ...querySearch, cost: undefined })

    expect(result?.searchUnits).toBe(3)
    expect(result && 'searchCost' in result).toBe(false)
  })

  it('records a grounded-prompt search as its own billing unit', () => {
    const usage = buildBaseUsage()

    const result = addSearchUsage(usage, groundedPromptSearch)

    expect(result?.searchUnits).toBe(2)
    expect(result?.searchBillingUnit).toBe('grounded-prompt')
  })

  it('records a search-unit search from Anthropic/OpenAI', () => {
    const usage = buildBaseUsage()
    const webSearch: SearchUsage = {
      units: 4,
      billingUnit: 'search',
      cost: 0.04,
      googleQueries: undefined,
      googleGroundedSteps: undefined,
    }

    const result = addSearchUsage(usage, webSearch)

    expect(result?.searchUnits).toBe(4)
    expect(result?.searchBillingUnit).toBe('search')
    expect(result?.searchCost).toBe(0.04)
  })

  it('sets searchProvider when the search usage carries one', () => {
    const usage = buildBaseUsage()
    const braveSearch: SearchUsage = {
      units: 1,
      billingUnit: 'search',
      cost: 0.005,
      googleQueries: undefined,
      googleGroundedSteps: undefined,
      provider: 'brave',
    }

    const result = addSearchUsage(usage, braveSearch)

    expect(result?.searchProvider).toBe('brave')
  })

  it('omits searchProvider when the search usage does not carry one', () => {
    const usage = buildBaseUsage()

    const result = addSearchUsage(usage, querySearch)

    expect(result && 'searchProvider' in result).toBe(false)
  })

  it('returns usage unchanged for undefined usage', () => {
    const result = addSearchUsage(undefined, querySearch)

    expect(result).toBeUndefined()
  })

  it('returns usage unchanged for undefined search', () => {
    const usage = buildBaseUsage()

    const result = addSearchUsage(usage, undefined)

    expect(result).toEqual(usage)
  })

  it('records a zero search unit count with no cost key when units is zero', () => {
    const usage = buildBaseUsage()
    const zeroSearch: SearchUsage = {
      units: 0,
      billingUnit: 'query',
      cost: undefined,
      googleQueries: 0,
      googleGroundedSteps: 1,
    }

    const result = addSearchUsage(usage, zeroSearch)

    expect(result?.searchUnits).toBe(0)
    expect(result?.searchBillingUnit).toBe('query')
    expect(result && 'searchCost' in result).toBe(false)
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
