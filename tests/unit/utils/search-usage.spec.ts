import { describe, expect, it } from 'vitest'
import { resolveSearchRates, resolveSearchUsage } from '../../../server/utils/ai/search-usage'

function googleStep(webSearchQueries: unknown) {
  return {
    providerMetadata: {
      google: {
        groundingMetadata: {
          webSearchQueries,
        },
      },
    },
  }
}

function webSearchToolResultStep(toolName: string) {
  return {
    content: [
      { type: 'tool-call', toolName },
      { type: 'tool-result', toolName },
    ],
  }
}

const rates = resolveSearchRates({
  googleSearchCostPerThousandQueriesUsd: '14',
  googleSearchCostPerThousandGroundedPromptsUsd: '35',
  anthropicWebSearchCostPerThousandSearchesUsd: '10',
  openaiWebSearchCostPerThousandCallsUsd: '10',
})

describe('resolveSearchRates', () => {
  it('maps all four config keys into google and web rate groups', () => {
    expect(rates).toEqual({
      google: {
        perQueryUsd: 0.014,
        perGroundedPromptUsd: 0.035,
      },
      web: {
        anthropicPerSearchUsd: 0.01,
        openaiPerCallUsd: 0.01,
      },
    })
  })
})

describe('resolveSearchUsage', () => {
  it('returns a full breakdown for a Google turn', () => {
    const result = resolveSearchUsage({
      providerId: 'google',
      modelId: 'gemini-3.8-flash',
      steps: [googleStep(['a', 'b'])],
      rates,
    })

    expect(result).toEqual({
      units: 2,
      billingUnit: 'query',
      cost: 2 * 0.014,
      googleQueries: 2,
      googleGroundedSteps: 1,
    })
  })

  it('reports zero units and no cost for a grounded step with no queries on a 3.x model', () => {
    const result = resolveSearchUsage({
      providerId: 'google',
      modelId: 'gemini-3.8-flash',
      steps: [googleStep([])],
      rates,
    })

    expect(result?.units).toBe(0)
    expect(result?.cost).toBeUndefined()
  })

  it('returns an Anthropic turn with no google fields', () => {
    const result = resolveSearchUsage({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-6',
      steps: [
        webSearchToolResultStep('web_search_preview'),
        webSearchToolResultStep('web_search_preview'),
        webSearchToolResultStep('web_search_preview'),
      ],
      rates,
    })

    expect(result).toEqual({
      units: 3,
      billingUnit: 'search',
      cost: 0.03,
      googleQueries: undefined,
      googleGroundedSteps: undefined,
    })
  })

  it('charges the same flat rate for a reasoning, a non-reasoning, and both mini OpenAI models', () => {
    const reasoningModelResult = resolveSearchUsage({
      providerId: 'openai',
      modelId: 'gpt-5.4',
      steps: [webSearchToolResultStep('web_search_preview')],
      rates,
    })
    const nonReasoningModelResult = resolveSearchUsage({
      providerId: 'openai',
      modelId: 'gpt-4o',
      steps: [webSearchToolResultStep('web_search_preview')],
      rates,
    })
    const gpt4oMiniResult = resolveSearchUsage({
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      steps: [webSearchToolResultStep('web_search_preview')],
      rates,
    })
    const gpt41MiniResult = resolveSearchUsage({
      providerId: 'openai',
      modelId: 'gpt-4.1-mini',
      steps: [webSearchToolResultStep('web_search_preview')],
      rates,
    })

    expect(reasoningModelResult?.cost).toBeCloseTo(0.01)
    expect(nonReasoningModelResult?.cost).toBeCloseTo(0.01)
    expect(gpt4oMiniResult?.cost).toBeCloseTo(0.01)
    expect(gpt41MiniResult?.cost).toBeCloseTo(0.01)
  })

  it('records units with no cost when no OpenAI rate is configured', () => {
    const result = resolveSearchUsage({
      providerId: 'openai',
      modelId: 'gpt-5.4',
      steps: [webSearchToolResultStep('web_search_preview')],
      rates: {
        ...rates,
        web: { ...rates.web, openaiPerCallUsd: undefined },
      },
    })

    expect(result?.units).toBe(1)
    expect(result?.cost).toBeUndefined()
  })

  it('returns undefined when no search happened, for any provider', () => {
    expect(resolveSearchUsage({
      providerId: 'google',
      modelId: 'gemini-3.8-flash',
      steps: [],
      rates,
    })).toBeUndefined()
    expect(resolveSearchUsage({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-6',
      steps: [],
      rates,
    })).toBeUndefined()
    expect(resolveSearchUsage({
      providerId: 'openai',
      modelId: 'gpt-5.4',
      steps: [],
      rates,
    })).toBeUndefined()
  })

  it('records units with no cost when no Anthropic rate is configured', () => {
    const result = resolveSearchUsage({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-6',
      steps: [webSearchToolResultStep('web_search_preview')],
      rates: {
        ...rates,
        web: { ...rates.web, anthropicPerSearchUsd: undefined },
      },
    })

    expect(result?.units).toBe(1)
    expect(result?.cost).toBeUndefined()
  })
})
