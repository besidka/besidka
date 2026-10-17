import { describe, expect, it } from 'vitest'
import {
  getWebSearchCost,
  getWebSearchUsage,
  resolveWebSearchRates,
} from '../../../server/utils/ai/web-search-cost'

function anthropicStep(webSearchRequests: unknown) {
  return {
    providerMetadata: {
      anthropic: {
        usage: {
          server_tool_use: {
            web_search_requests: webSearchRequests,
          },
        },
      },
    },
  }
}

function toolResultStep(toolName: string) {
  return {
    content: [
      { type: 'tool-call', toolName },
      { type: 'tool-result', toolName },
    ],
  }
}

function toolErrorStep(toolName: string) {
  return {
    content: [
      { type: 'tool-call', toolName },
      { type: 'tool-error', toolName },
    ],
  }
}

function deepseekToolResultStep(output: unknown) {
  return {
    content: [
      { type: 'tool-call', toolName: 'web_search' },
      { type: 'tool-result', toolName: 'web_search', output },
    ],
  }
}

describe('getWebSearchUsage', () => {
  it('sums Anthropic web_search_requests across multiple steps', () => {
    const result = getWebSearchUsage(
      [anthropicStep(2), anthropicStep(1)],
      'anthropic',
    )

    expect(result).toEqual({ searches: 3, billingUnit: 'search' })
  })

  it('falls back to counting tool-result parts when Anthropic metadata is absent', () => {
    const result = getWebSearchUsage(
      [
        toolResultStep('web_search_preview'),
        toolResultStep('web_search_preview'),
      ],
      'anthropic',
    )

    expect(result).toEqual({ searches: 2, billingUnit: 'search' })
  })

  it('excludes errored searches from the structural fallback', () => {
    const result = getWebSearchUsage(
      [
        toolResultStep('web_search_preview'),
        toolErrorStep('web_search_preview'),
      ],
      'anthropic',
    )

    expect(result).toEqual({ searches: 1, billingUnit: 'search' })
  })

  it('counts OpenAI tool-result parts across steps', () => {
    const result = getWebSearchUsage(
      [
        toolResultStep('web_search_preview'),
        toolResultStep('web_search_preview'),
      ],
      'openai',
    )

    expect(result).toEqual({ searches: 2, billingUnit: 'search' })
  })

  it('also counts the provider-native fallback tool name', () => {
    const result = getWebSearchUsage(
      [toolResultStep('web_search')],
      'openai',
    )

    expect(result).toEqual({ searches: 1, billingUnit: 'search' })
  })

  it('ignores tool-result parts for unrelated tool names', () => {
    const result = getWebSearchUsage(
      [toolResultStep('generate_image')],
      'openai',
    )

    expect(result).toBeUndefined()
  })

  it('returns undefined when the count is zero', () => {
    const result = getWebSearchUsage([], 'openai')

    expect(result).toBeUndefined()
  })

  it('returns undefined for google even with web-search-shaped tool results', () => {
    const result = getWebSearchUsage(
      [toolResultStep('web_search_preview')],
      'google',
    )

    expect(result).toBeUndefined()
  })

  it('counts only DeepSeek tool results whose output is billable', () => {
    const result = getWebSearchUsage(
      [
        deepseekToolResultStep({ provider: 'deepseek', billable: true }),
        deepseekToolResultStep({ provider: 'deepseek', billable: false }),
        deepseekToolResultStep({ provider: 'deepseek', billable: true }),
      ],
      'deepseek',
    )

    expect(result).toEqual({ searches: 2, billingUnit: 'search' })
  })

  it('never counts a DeepSeek empty-result search', () => {
    const result = getWebSearchUsage(
      [deepseekToolResultStep({
        provider: 'deepseek',
        billable: false,
        results: [],
      })],
      'deepseek',
    )

    expect(result).toBeUndefined()
  })

  it('never counts a DeepSeek tool-error', () => {
    const result = getWebSearchUsage(
      [toolErrorStep('web_search')],
      'deepseek',
    )

    expect(result).toBeUndefined()
  })

  it('ignores DeepSeek tool results without a boolean billable flag', () => {
    const result = getWebSearchUsage(
      [
        deepseekToolResultStep({ provider: 'deepseek' }),
        deepseekToolResultStep({ billable: 'true' }),
        deepseekToolResultStep('not-a-record'),
        toolResultStep('web_search'),
      ],
      'deepseek',
    )

    expect(result).toBeUndefined()
  })

  it('ignores DeepSeek tool results under other tool names', () => {
    const result = getWebSearchUsage(
      [{
        content: [{
          type: 'tool-result',
          toolName: 'web_search_brave',
          output: { billable: true },
        }],
      }],
      'deepseek',
    )

    expect(result).toBeUndefined()
  })

  it('does not count billable DeepSeek-shaped results for other providers', () => {
    const result = getWebSearchUsage(
      [deepseekToolResultStep({ billable: true })],
      'moonshotai',
    )

    expect(result).toBeUndefined()
  })

  it('tolerates missing or non-array content, and non-record parts', () => {
    expect(getWebSearchUsage(
      [{ content: undefined }],
      'openai',
    )).toBeUndefined()
    expect(getWebSearchUsage(
      [{ content: 'not-an-array' }],
      'openai',
    )).toBeUndefined()
    expect(getWebSearchUsage(
      [{ content: ['not-a-record', 42, null] }],
      'openai',
    )).toBeUndefined()
  })
})

describe('resolveWebSearchRates', () => {
  it('returns undefined for all rates when config is empty', () => {
    expect(resolveWebSearchRates({})).toEqual({
      anthropicPerSearchUsd: undefined,
      openaiPerCallUsd: undefined,
      deepseekPerSearchUsd: undefined,
    })
  })

  it('divides the DeepSeek per-thousand rate into a per-request rate', () => {
    expect(resolveWebSearchRates({
      deepseekSearchCostPerThousandRequestsUsd: '0.75',
    }).deepseekPerSearchUsd).toBe(0.00075)
    expect(resolveWebSearchRates({
      deepseekSearchCostPerThousandRequestsUsd: 0.75,
    }).deepseekPerSearchUsd).toBe(0.00075)
    expect(resolveWebSearchRates({
      deepseekSearchCostPerThousandRequestsUsd: '0',
    }).deepseekPerSearchUsd).toBeUndefined()
    expect(resolveWebSearchRates({
      deepseekSearchCostPerThousandRequestsUsd: '',
    }).deepseekPerSearchUsd).toBeUndefined()
  })

  it('divides a string rate into a per-unit rate', () => {
    expect(resolveWebSearchRates({
      anthropicWebSearchCostPerThousandSearchesUsd: '10',
    }).anthropicPerSearchUsd).toBe(0.01)
    expect(resolveWebSearchRates({
      openaiWebSearchCostPerThousandCallsUsd: '10',
    }).openaiPerCallUsd).toBe(0.01)
  })

  it('also accepts a numeric rate', () => {
    expect(resolveWebSearchRates({
      anthropicWebSearchCostPerThousandSearchesUsd: 10,
    }).anthropicPerSearchUsd).toBe(0.01)
    expect(resolveWebSearchRates({
      openaiWebSearchCostPerThousandCallsUsd: 10,
    }).openaiPerCallUsd).toBe(0.01)
  })

  it('returns undefined for a non-numeric, zero, or negative rate', () => {
    expect(resolveWebSearchRates({
      anthropicWebSearchCostPerThousandSearchesUsd: 'abc',
    }).anthropicPerSearchUsd).toBeUndefined()
    expect(resolveWebSearchRates({
      anthropicWebSearchCostPerThousandSearchesUsd: '0',
    }).anthropicPerSearchUsd).toBeUndefined()
    expect(resolveWebSearchRates({
      anthropicWebSearchCostPerThousandSearchesUsd: '-5',
    }).anthropicPerSearchUsd).toBeUndefined()
    expect(resolveWebSearchRates({
      openaiWebSearchCostPerThousandCallsUsd: '0',
    }).openaiPerCallUsd).toBeUndefined()
  })
})

describe('getWebSearchCost', () => {
  const rates = {
    anthropicPerSearchUsd: 0.01,
    openaiPerCallUsd: 0.01,
    deepseekPerSearchUsd: 0.00075,
  }

  it('charges DeepSeek searches at units times the per-request rate', () => {
    const result = getWebSearchCost(
      { searches: 4, billingUnit: 'search' },
      'deepseek',
      rates,
    )

    expect(result).toBeCloseTo(4 * 0.75 / 1000)
  })

  it('returns no DeepSeek cost when the rate is unset', () => {
    const result = getWebSearchCost(
      { searches: 4, billingUnit: 'search' },
      'deepseek',
      { ...rates, deepseekPerSearchUsd: undefined },
    )

    expect(result).toBeUndefined()
  })

  it('charges Anthropic searches at the per-search rate', () => {
    const result = getWebSearchCost(
      { searches: 3, billingUnit: 'search' },
      'anthropic',
      rates,
    )

    expect(result).toBeCloseTo(3 * 0.01)
  })

  it('charges OpenAI searches at the same flat rate, no per-model branching', () => {
    const result = getWebSearchCost(
      { searches: 2, billingUnit: 'search' },
      'openai',
      rates,
    )

    expect(result).toBeCloseTo(2 * 0.01)
  })

  it('returns undefined when the matching rate is unset', () => {
    const result = getWebSearchCost(
      { searches: 2, billingUnit: 'search' },
      'anthropic',
      { ...rates, anthropicPerSearchUsd: undefined },
    )

    expect(result).toBeUndefined()
  })

  it('returns undefined for an unconfigured OpenAI rate, still recording units elsewhere', () => {
    const result = getWebSearchCost(
      { searches: 2, billingUnit: 'search' },
      'openai',
      { ...rates, openaiPerCallUsd: undefined },
    )

    expect(result).toBeUndefined()
  })

  it('returns undefined for undefined usage', () => {
    expect(getWebSearchCost(
      undefined,
      'anthropic',
      rates,
    )).toBeUndefined()
  })

  it('returns undefined for google', () => {
    const result = getWebSearchCost(
      { searches: 2, billingUnit: 'search' },
      'google',
      rates,
    )

    expect(result).toBeUndefined()
  })
})
