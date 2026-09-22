import { describe, expect, it } from 'vitest'
import {
  getGoogleSearchBillableUnits,
  getGoogleSearchBillingUnit,
  getGoogleSearchCost,
  getGoogleSearchGrounding,
  resolveGoogleSearchRates,
} from '../../../server/utils/ai/google-search-cost'

const TEST_PER_THOUSAND_QUERIES = '12'
const TEST_PER_THOUSAND_GROUNDED_PROMPTS = '40'

function buildStep(webSearchQueries: unknown) {
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

describe('getGoogleSearchBillingUnit', () => {
  it('bills Gemini 3.x per query', () => {
    expect(getGoogleSearchBillingUnit('gemini-3.8-flash')).toBe('query')
    expect(getGoogleSearchBillingUnit('gemini-3.1-pro-preview')).toBe('query')
    expect(getGoogleSearchBillingUnit('gemini-3-pro-preview')).toBe('query')
  })

  it('bills Gemini 2.5 and earlier per grounded prompt', () => {
    expect(getGoogleSearchBillingUnit('gemini-2.5-pro')).toBe(
      'grounded-prompt',
    )
    expect(getGoogleSearchBillingUnit('gemini-2.0-flash')).toBe(
      'grounded-prompt',
    )
  })

  it('returns undefined for a non-Gemini model id', () => {
    expect(getGoogleSearchBillingUnit('gpt-5.4')).toBeUndefined()
    expect(
      getGoogleSearchBillingUnit('deep-research-preview-04-2026'),
    ).toBeUndefined()
  })
})

describe('getGoogleSearchGrounding', () => {
  it('dedupes trimmed non-empty queries across multiple steps', () => {
    const result = getGoogleSearchGrounding(
      [
        buildStep(['a', '  a  ', '']),
        buildStep(['b']),
      ],
      'gemini-3.8-flash',
    )

    expect(result).toEqual({
      queries: 2,
      groundedSteps: 2,
      billingUnit: 'query',
    })
  })

  it('counts a grounded step with zero queries', () => {
    const result = getGoogleSearchGrounding(
      [buildStep([])],
      'gemini-3.8-flash',
    )

    expect(result).toEqual({
      queries: 0,
      groundedSteps: 1,
      billingUnit: 'query',
    })
  })

  it('ignores imageSearchQueries and retrievalQueries', () => {
    const result = getGoogleSearchGrounding(
      [{
        providerMetadata: {
          google: {
            groundingMetadata: {
              webSearchQueries: ['a'],
              imageSearchQueries: ['b', 'c'],
              retrievalQueries: ['d'],
            },
          },
        },
      }],
      'gemini-3.8-flash',
    )

    expect(result?.queries).toBe(1)
  })

  it('returns undefined when no step has google metadata', () => {
    const result = getGoogleSearchGrounding(
      [{ providerMetadata: { openai: { responses: {} } } }],
      'gemini-3.8-flash',
    )

    expect(result).toBeUndefined()
  })

  it('returns undefined when groundingMetadata is null', () => {
    const result = getGoogleSearchGrounding(
      [{ providerMetadata: { google: { groundingMetadata: null } } }],
      'gemini-3.8-flash',
    )

    expect(result).toBeUndefined()
  })

  it('tolerates malformed shapes', () => {
    expect(getGoogleSearchGrounding(
      [{ providerMetadata: undefined }],
      'gemini-3.8-flash',
    )).toBeUndefined()
    expect(getGoogleSearchGrounding(
      [{ providerMetadata: 'not-an-object' }],
      'gemini-3.8-flash',
    )).toBeUndefined()
    expect(getGoogleSearchGrounding(
      [buildStep('not-an-array')],
      'gemini-3.8-flash',
    )).toEqual({ queries: 0, groundedSteps: 1, billingUnit: 'query' })
  })

  it('sets billingUnit from the passed modelId', () => {
    expect(
      getGoogleSearchGrounding([buildStep(['a'])], 'gemini-3.8-flash')
        ?.billingUnit,
    ).toBe('query')
    expect(
      getGoogleSearchGrounding([buildStep(['a'])], 'gemini-2.5-pro')
        ?.billingUnit,
    ).toBe('grounded-prompt')
    expect(
      getGoogleSearchGrounding([buildStep(['a'])], 'gpt-5.4')
        ?.billingUnit,
    ).toBeUndefined()
  })
})

describe('getGoogleSearchBillableUnits', () => {
  it('uses queries for a query-unit grounding', () => {
    expect(getGoogleSearchBillableUnits({
      queries: 3,
      groundedSteps: 2,
      billingUnit: 'query',
    })).toBe(3)
  })

  it('uses groundedSteps for a grounded-prompt-unit grounding', () => {
    expect(getGoogleSearchBillableUnits({
      queries: 3,
      groundedSteps: 2,
      billingUnit: 'grounded-prompt',
    })).toBe(2)
  })

  it('falls back to queries for an unknown unit', () => {
    expect(getGoogleSearchBillableUnits({
      queries: 3,
      groundedSteps: 2,
      billingUnit: undefined,
    })).toBe(3)
  })
})

describe('resolveGoogleSearchRates', () => {
  it('returns undefined for both rates when config is empty', () => {
    expect(resolveGoogleSearchRates({})).toEqual({
      perQueryUsd: undefined,
      perGroundedPromptUsd: undefined,
    })
  })

  it('returns undefined for an empty string', () => {
    expect(resolveGoogleSearchRates({
      googleSearchCostPerThousandQueriesUsd: '',
    }).perQueryUsd).toBeUndefined()
  })

  it('divides a string rate into a per-unit rate', () => {
    expect(resolveGoogleSearchRates({
      googleSearchCostPerThousandQueriesUsd: TEST_PER_THOUSAND_QUERIES,
    }).perQueryUsd).toBe(0.012)
  })

  it('divides a numeric rate into a per-unit rate', () => {
    expect(resolveGoogleSearchRates({
      googleSearchCostPerThousandQueriesUsd: 12,
    }).perQueryUsd).toBe(0.012)
  })

  it('returns undefined for a non-numeric, zero, or negative rate', () => {
    expect(resolveGoogleSearchRates({
      googleSearchCostPerThousandQueriesUsd: 'abc',
    }).perQueryUsd).toBeUndefined()
    expect(resolveGoogleSearchRates({
      googleSearchCostPerThousandQueriesUsd: '0',
    }).perQueryUsd).toBeUndefined()
    expect(resolveGoogleSearchRates({
      googleSearchCostPerThousandQueriesUsd: '-5',
    }).perQueryUsd).toBeUndefined()
  })

  it('maps each config key to its own output field', () => {
    const result = resolveGoogleSearchRates({
      googleSearchCostPerThousandQueriesUsd: TEST_PER_THOUSAND_QUERIES,
      googleSearchCostPerThousandGroundedPromptsUsd:
        TEST_PER_THOUSAND_GROUNDED_PROMPTS,
    })

    expect(result).toEqual({
      perQueryUsd: 0.012,
      perGroundedPromptUsd: 0.04,
    })
  })
})

describe('getGoogleSearchCost', () => {
  const rates = {
    perQueryUsd: 0.012,
    perGroundedPromptUsd: 0.04,
  }

  it('charges billable queries at the per-query rate', () => {
    const result = getGoogleSearchCost(
      { queries: 3, groundedSteps: 1, billingUnit: 'query' },
      rates,
    )

    expect(result).toBeCloseTo(3 * 0.012)
  })

  it('charges grounded steps at the grounded-prompt rate, not the query count', () => {
    const result = getGoogleSearchCost(
      { queries: 5, groundedSteps: 2, billingUnit: 'grounded-prompt' },
      rates,
    )

    expect(result).toBeCloseTo(2 * 0.04)
  })

  it('returns undefined when the matching rate is unset even if the other is set', () => {
    const result = getGoogleSearchCost(
      { queries: 3, groundedSteps: 1, billingUnit: 'query' },
      { perQueryUsd: undefined, perGroundedPromptUsd: 0.04 },
    )

    expect(result).toBeUndefined()
  })

  it('returns undefined when billingUnit is undefined', () => {
    const result = getGoogleSearchCost(
      { queries: 3, groundedSteps: 1, billingUnit: undefined },
      rates,
    )

    expect(result).toBeUndefined()
  })

  it('returns undefined for zero billable units', () => {
    const result = getGoogleSearchCost(
      { queries: 0, groundedSteps: 0, billingUnit: 'query' },
      rates,
    )

    expect(result).toBeUndefined()
  })

  it('returns undefined for undefined grounding', () => {
    expect(getGoogleSearchCost(undefined, rates)).toBeUndefined()
  })
})
