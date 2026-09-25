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
      exaSearchCostPerThousandRequestsUsd: '17',
    })

    expect(rates.bravePerSearchUsd).toBeCloseTo(0.005)
    expect(rates.exaPerSearchUsd).toBeCloseTo(0.017)
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
  const rates = { bravePerSearchUsd: 0.005, exaPerSearchUsd: 0.017 }

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
      { bravePerSearchUsd: undefined, exaPerSearchUsd: undefined },
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
