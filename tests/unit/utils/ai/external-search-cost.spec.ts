import { describe, expect, it } from 'vitest'
import {
  getExternalSearchCost,
  getExternalSearchUsage,
  resolveExternalSearchRates,
} from '../../../../server/utils/ai/external-search-cost'

function toolResultStep(toolName: string, output: unknown) {
  return {
    content: [
      { type: 'tool-result', toolName, output },
    ],
  }
}

function toolErrorStep(toolName: string) {
  return {
    content: [
      { type: 'tool-error', toolName, error: 'boom' },
    ],
  }
}

describe('getExternalSearchUsage', () => {
  it('counts tool-result parts matching the provider\'s tool name', () => {
    const usage = getExternalSearchUsage(
      [
        toolResultStep('web_search_brave', { results: [] }),
        toolResultStep('web_search_brave', { results: [] }),
      ],
      'brave',
    )

    expect(usage).toEqual({
      searches: 2,
      billingUnit: 'search',
      reportedCostDollars: undefined,
    })
  })

  it('never counts tool-error parts, since a failed search is not a '
    + 'billable unit', () => {
    const usage = getExternalSearchUsage(
      [
        toolErrorStep('web_search_exa'),
        toolResultStep('web_search_exa', { results: [] }),
      ],
      'exa',
    )

    expect(usage?.searches).toBe(1)
  })

  it('counts only the executed searches when a turn hits the per-turn '
    + 'search limit', () => {
    const executedSearches = Array.from({ length: 8 }, () => {
      return toolResultStep('web_search_brave', { results: [] })
    })
    const usage = getExternalSearchUsage(
      [...executedSearches, toolErrorStep('web_search_brave')],
      'brave',
    )

    expect(usage?.searches).toBe(8)
  })

  it('ignores tool-result parts for a different tool name', () => {
    const usage = getExternalSearchUsage(
      [toolResultStep('web_search_brave', { results: [] })],
      'exa',
    )

    expect(usage).toBeUndefined()
  })

  it('returns undefined when zero searches ran', () => {
    const usage = getExternalSearchUsage([], 'brave')

    expect(usage).toBeUndefined()
  })

  it('sums a vendor-reported costDollars across every matching call in '
    + 'the turn', () => {
    const usage = getExternalSearchUsage(
      [
        toolResultStep('web_search_exa', { results: [], costDollars: 0.007 }),
        toolResultStep('web_search_exa', { results: [], costDollars: 0.007 }),
      ],
      'exa',
    )

    expect(usage).toEqual({
      searches: 2,
      billingUnit: 'search',
      reportedCostDollars: 0.014,
    })
  })

  it('leaves reportedCostDollars undefined when no call carried one '
    + '(Brave never reports a cost)', () => {
    const usage = getExternalSearchUsage(
      [toolResultStep('web_search_brave', { results: [] })],
      'brave',
    )

    expect(usage?.reportedCostDollars).toBeUndefined()
  })
})

describe('resolveExternalSearchRates', () => {
  it('parses configured per-thousand rates into per-search USD', () => {
    const rates = resolveExternalSearchRates({
      braveSearchCostPerThousandRequestsUsd: '5',
      exaLiteSearchCostPerThousandRequestsUsd: '4',
      exaSearchCostPerThousandRequestsUsd: '7',
      exaDeepSearchCostPerThousandRequestsUsd: 12,
    })

    expect(rates.bravePerSearchUsd).toBeCloseTo(0.005)
    expect(rates.exaPerSearchUsdByLevel.lite).toBeCloseTo(0.004)
    expect(rates.exaPerSearchUsdByLevel.auto).toBeCloseTo(0.007)
    expect(rates.exaPerSearchUsdByLevel.deep).toBeCloseTo(0.012)
  })

  it('leaves an Exa level undefined when only its own config key is '
    + 'missing', () => {
    const rates = resolveExternalSearchRates({
      exaSearchCostPerThousandRequestsUsd: '7',
      exaDeepSearchCostPerThousandRequestsUsd: '',
    })

    expect(rates.exaPerSearchUsdByLevel.lite).toBeUndefined()
    expect(rates.exaPerSearchUsdByLevel.auto).toBeCloseTo(0.007)
    expect(rates.exaPerSearchUsdByLevel.deep).toBeUndefined()
  })

  it('returns undefined for empty, non-finite or non-positive values', () => {
    expect(resolveExternalSearchRates({}).bravePerSearchUsd).toBeUndefined()
    expect(resolveExternalSearchRates({
      braveSearchCostPerThousandRequestsUsd: '',
    }).bravePerSearchUsd).toBeUndefined()
    expect(resolveExternalSearchRates({
      braveSearchCostPerThousandRequestsUsd: '0',
    }).bravePerSearchUsd).toBeUndefined()
    expect(resolveExternalSearchRates({
      braveSearchCostPerThousandRequestsUsd: 'not-a-number',
    }).bravePerSearchUsd).toBeUndefined()
  })
})

describe('getExternalSearchCost', () => {
  const rates = {
    bravePerSearchUsd: 0.005,
    exaPerSearchUsdByLevel: {
      lite: 0.004,
      auto: 0.007,
      deep: 0.012,
    },
  }

  it('prefers a vendor-reported cost over the configured rate', () => {
    const cost = getExternalSearchCost(
      { searches: 2, billingUnit: 'search', reportedCostDollars: 0.014 },
      'exa',
      rates,
    )

    expect(cost).toBe(0.014)
  })

  it('falls back to searches × rate when no cost was reported', () => {
    const cost = getExternalSearchCost(
      { searches: 3, billingUnit: 'search', reportedCostDollars: undefined },
      'brave',
      rates,
    )

    expect(cost).toBeCloseTo(0.015)
  })

  it('returns undefined, never 0, when the rate is unresolved and no '
    + 'cost was reported', () => {
    const cost = getExternalSearchCost(
      { searches: 1, billingUnit: 'search', reportedCostDollars: undefined },
      'brave',
      {
        bravePerSearchUsd: undefined,
        exaPerSearchUsdByLevel: {
          lite: undefined,
          auto: undefined,
          deep: undefined,
        },
      },
    )

    expect(cost).toBeUndefined()
  })

  it.each([
    ['lite', 0.008],
    ['auto', 0.014],
    ['deep', 0.024],
  ] as const)('falls back to the %s Exa rate when no cost was reported',
    (level, expectedCost) => {
      const cost = getExternalSearchCost(
        { searches: 2, billingUnit: 'search', reportedCostDollars: undefined },
        'exa',
        rates,
        level,
      )

      expect(cost).toBeCloseTo(expectedCost)
    })

  it('defaults the Exa fallback rate to the auto level', () => {
    const cost = getExternalSearchCost(
      { searches: 1, billingUnit: 'search', reportedCostDollars: undefined },
      'exa',
      rates,
    )

    expect(cost).toBeCloseTo(0.007)
  })

  it('still prefers a reported cost over the selected level rate', () => {
    const cost = getExternalSearchCost(
      { searches: 1, billingUnit: 'search', reportedCostDollars: 0.012 },
      'exa',
      rates,
      'lite',
    )

    expect(cost).toBe(0.012)
  })

  it('returns undefined when only the selected level has no rate', () => {
    const cost = getExternalSearchCost(
      { searches: 1, billingUnit: 'search', reportedCostDollars: undefined },
      'exa',
      {
        ...rates,
        exaPerSearchUsdByLevel: {
          ...rates.exaPerSearchUsdByLevel,
          deep: undefined,
        },
      },
      'deep',
    )

    expect(cost).toBeUndefined()
  })

  it('returns undefined for zero searches or undefined usage', () => {
    expect(getExternalSearchCost(undefined, 'brave', rates)).toBeUndefined()
    expect(getExternalSearchCost(
      { searches: 0, billingUnit: 'search', reportedCostDollars: undefined },
      'brave',
      rates,
    )).toBeUndefined()
  })
})
