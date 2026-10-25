import { describe, expect, it } from 'vitest'
import {
  estimatePromptCacheCost,
  formatCostUsd,
  formatApproxTokens,
  parseUsdPrice,
  toPricePerMillion,
} from '#shared/utils/prompt-cache-estimate'

const SONNET_PRICES = {
  inputPrice: 3,
  cacheReadPrice: 0.3,
  cacheWritePrice: 3.75,
}

const ZEROS = { uncached: 0, cached: 0, perChange: 0 }

describe('estimatePromptCacheCost', () => {
  it('reproduces the Sonnet-like design table row for 64k and 20 turns', () => {
    const estimate = estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: 64_000,
      turns: 20,
    })

    expect(estimate.uncached).toBeCloseTo(3.84, 10)
    expect(estimate.cached).toBeCloseTo(0.24 + 19 * 0.0192, 10)
    expect(estimate.perChange).toBeCloseTo(64_000 * 3.45 / 1e6, 10)
  })

  it('reproduces the Opus 5.5 row of the design table', () => {
    const estimate = estimatePromptCacheCost({
      inputPrice: 4,
      cacheReadPrice: 0.2,
      cacheWritePrice: 5,
      tokens: 64_000,
      turns: 20,
    })

    expect(estimate.uncached).toBeCloseTo(5.12, 10)
    expect(estimate.cached).toBeCloseTo(0.32 + 19 * 0.0128, 10)
    expect(estimate.perChange).toBeCloseTo(0.3072, 10)
  })

  it('reproduces the Sonnet 5.5 row of the design table', () => {
    const estimate = estimatePromptCacheCost({
      inputPrice: 2,
      cacheReadPrice: 0.1,
      cacheWritePrice: 2.5,
      tokens: 64_000,
      turns: 20,
    })

    expect(formatCostUsd(estimate.uncached)).toBe('$2.56')
    expect(formatCostUsd(estimate.cached)).toBe('$0.28')
    expect(formatCostUsd(estimate.perChange)).toBe('$0.15')
  })

  it('matches the documented formulas on round numbers', () => {
    const estimate = estimatePromptCacheCost({
      tokens: 1_000_000,
      turns: 10,
      inputPrice: 2,
      cacheReadPrice: 0.5,
      cacheWritePrice: 4,
    })

    expect(estimate.uncached).toBe(20)
    expect(estimate.cached).toBe(4 + 9 * 0.5)
    expect(estimate.perChange).toBe(3.5)
  })

  it('falls back to the input price when cache prices are undefined', () => {
    const estimate = estimatePromptCacheCost({
      tokens: 10_000,
      turns: 5,
      inputPrice: 2,
    })

    expect(estimate.cached).toBeCloseTo(estimate.uncached, 12)
    expect(estimate.perChange).toBe(0)
  })

  it('falls back to the input price when cache prices are null', () => {
    const estimate = estimatePromptCacheCost({
      tokens: 10_000,
      turns: 5,
      inputPrice: 2,
      cacheReadPrice: null,
      cacheWritePrice: null,
    })

    expect(estimate.cached).toBeCloseTo(estimate.uncached, 12)
    expect(estimate.perChange).toBe(0)
  })

  it('falls back per price: only the read price is published', () => {
    const estimate = estimatePromptCacheCost({
      tokens: 1_000_000,
      turns: 3,
      inputPrice: 2,
      cacheReadPrice: 0.5,
    })

    expect(estimate.cached).toBe(2 + 2 * 0.5)
    expect(estimate.perChange).toBe(1.5)
  })

  it('falls back per price: only the write price is published', () => {
    const estimate = estimatePromptCacheCost({
      tokens: 1_000_000,
      turns: 3,
      inputPrice: 2,
      cacheWritePrice: 2.5,
    })

    expect(estimate.cached).toBe(2.5 + 2 * 2)
    expect(estimate.perChange).toBe(0.5)
  })

  it('treats invalid cache prices as missing', () => {
    const estimate = estimatePromptCacheCost({
      tokens: 1_000_000,
      turns: 2,
      inputPrice: 2,
      cacheReadPrice: Number.NaN,
      cacheWritePrice: -1,
    })

    expect(estimate.cached).toBe(4)
    expect(estimate.perChange).toBe(0)
  })

  it('charges only the cache write for a single turn', () => {
    const estimate = estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: 1_000_000,
      turns: 1,
    })

    expect(estimate.uncached).toBe(3)
    expect(estimate.cached).toBe(3.75)
  })

  it('returns zeros for zero turns', () => {
    expect(estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: 64_000,
      turns: 0,
    })).toEqual(ZEROS)
  })

  it('returns zeros for negative turns', () => {
    expect(estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: 64_000,
      turns: -3,
    })).toEqual(ZEROS)
  })

  it('returns zeros for fractional turns below one', () => {
    expect(estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: 64_000,
      turns: 0.9,
    })).toEqual(ZEROS)
  })

  it('floors fractional turns', () => {
    const fractional = estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: 64_000,
      turns: 20.9,
    })
    const whole = estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: 64_000,
      turns: 20,
    })

    expect(fractional).toEqual(whole)
  })

  it('returns zeros for zero tokens', () => {
    expect(estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: 0,
      turns: 20,
    })).toEqual(ZEROS)
  })

  it('returns zeros for negative tokens', () => {
    expect(estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: -1,
      turns: 20,
    })).toEqual(ZEROS)
  })

  it('returns zeros, never NaN, for NaN tokens', () => {
    const estimate = estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: Number.NaN,
      turns: 20,
    })

    expect(estimate).toEqual(ZEROS)
    expect(Object.values(estimate).some(Number.isNaN)).toBe(false)
  })

  it('returns zeros for NaN turns', () => {
    expect(estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: 64_000,
      turns: Number.NaN,
    })).toEqual(ZEROS)
  })

  it('returns zeros for a NaN input price', () => {
    expect(estimatePromptCacheCost({
      tokens: 64_000,
      turns: 20,
      inputPrice: Number.NaN,
    })).toEqual(ZEROS)
  })

  it('returns zeros for a negative input price', () => {
    expect(estimatePromptCacheCost({
      tokens: 64_000,
      turns: 20,
      inputPrice: -3,
    })).toEqual(ZEROS)
  })

  it('returns zeros for an undefined input price', () => {
    expect(estimatePromptCacheCost({
      tokens: 64_000,
      turns: 20,
      inputPrice: undefined as unknown as number,
    })).toEqual(ZEROS)
  })

  it('returns zeros for infinite inputs', () => {
    expect(estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: Number.POSITIVE_INFINITY,
      turns: 20,
    })).toEqual(ZEROS)
    expect(estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: 64_000,
      turns: Number.POSITIVE_INFINITY,
    })).toEqual(ZEROS)
  })

  it('handles a free model', () => {
    expect(estimatePromptCacheCost({
      tokens: 64_000,
      turns: 20,
      inputPrice: 0,
      cacheReadPrice: 0,
      cacheWritePrice: 0,
    })).toEqual(ZEROS)
  })

  it('stays finite for large values', () => {
    const estimate = estimatePromptCacheCost({
      tokens: 10_000_000,
      turns: 10_000,
      inputPrice: 75,
      cacheReadPrice: 7.5,
      cacheWritePrice: 93.75,
    })

    expect(estimate.uncached).toBeCloseTo(7_500_000, 4)
    expect(Number.isFinite(estimate.cached)).toBe(true)
    expect(estimate.cached).toBeLessThan(estimate.uncached)
  })

  it('reports a negative perChange when writing is cheaper than reading', () => {
    const estimate = estimatePromptCacheCost({
      tokens: 1_000_000,
      turns: 4,
      inputPrice: 2,
      cacheReadPrice: 1,
      cacheWritePrice: 0.5,
    })

    expect(estimate.perChange).toBe(-0.5)
  })

  it('reports a zero perChange when write and read prices match', () => {
    const estimate = estimatePromptCacheCost({
      tokens: 64_000,
      turns: 20,
      inputPrice: 1,
      cacheReadPrice: 0.5,
      cacheWritePrice: 0.5,
    })

    expect(estimate.perChange).toBe(0)
  })

  it('grows monotonically with turns', () => {
    const estimates = [1, 2, 5, 20, 100].map((turns) => {
      return estimatePromptCacheCost({
        ...SONNET_PRICES,
        tokens: 64_000,
        turns,
      })
    })

    estimates.slice(1).forEach((estimate, index) => {
      const previous = estimates[index]!

      expect(estimate.uncached).toBeGreaterThan(previous.uncached)
      expect(estimate.cached).toBeGreaterThan(previous.cached)
      expect(estimate.perChange).toBe(previous.perChange)
    })
  })

  it('grows monotonically with tokens', () => {
    const estimates = [1_000, 10_000, 64_000].map((tokens) => {
      return estimatePromptCacheCost({
        ...SONNET_PRICES,
        tokens,
        turns: 20,
      })
    })

    estimates.slice(1).forEach((estimate, index) => {
      const previous = estimates[index]!

      expect(estimate.uncached).toBeGreaterThan(previous.uncached)
      expect(estimate.cached).toBeGreaterThan(previous.cached)
      expect(estimate.perChange).toBeGreaterThan(previous.perChange)
    })
  })

  it('is cheaper cached than uncached once reads dominate', () => {
    const estimate = estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: 64_000,
      turns: 20,
    })

    expect(estimate.cached).toBeLessThan(estimate.uncached)
  })

  it('costs more cached than uncached for a single turn on a write premium', () => {
    const estimate = estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: 64_000,
      turns: 1,
    })

    expect(estimate.cached).toBeGreaterThan(estimate.uncached)
  })
})

describe('parseUsdPrice', () => {
  it('passes a plain number through', () => {
    expect(parseUsdPrice(3.5)).toBe(3.5)
    expect(parseUsdPrice(0)).toBe(0)
  })

  it('rejects negative and non-finite numbers', () => {
    expect(parseUsdPrice(-1)).toBeNull()
    expect(parseUsdPrice(Number.NaN)).toBeNull()
    expect(parseUsdPrice(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('parses display strings', () => {
    expect(parseUsdPrice('$3.00')).toBe(3)
    expect(parseUsdPrice('$0.25')).toBe(0.25)
    expect(parseUsdPrice('3')).toBe(3)
  })

  it('parses thousands separators', () => {
    expect(parseUsdPrice('$1,250.00')).toBe(1250)
  })

  it('reads the floor of a ranged price', () => {
    expect(parseUsdPrice('from $2.00')).toBe(2)
  })

  it('returns null for empty, missing or unparseable values', () => {
    expect(parseUsdPrice('')).toBeNull()
    expect(parseUsdPrice(undefined)).toBeNull()
    expect(parseUsdPrice(null)).toBeNull()
    expect(parseUsdPrice('free')).toBeNull()
  })
})

describe('toPricePerMillion', () => {
  it('keeps prices already quoted per million tokens', () => {
    expect(toPricePerMillion(3, 1_000_000)).toBe(3)
  })

  it('defaults the unit to one million tokens', () => {
    expect(toPricePerMillion(3)).toBe(3)
  })

  it('rescales a price quoted for another token unit', () => {
    expect(toPricePerMillion(1, 1000)).toBe(1000)
  })

  it('returns null for invalid amounts or units', () => {
    expect(toPricePerMillion(-1)).toBeNull()
    expect(toPricePerMillion(Number.NaN)).toBeNull()
    expect(toPricePerMillion(1, 0)).toBeNull()
    expect(toPricePerMillion(1, Number.NaN)).toBeNull()
  })
})

describe('formatCostUsd', () => {
  it('uses two decimals from one dollar up', () => {
    expect(formatCostUsd(1)).toBe('$1.00')
    expect(formatCostUsd(2.56)).toBe('$2.56')
    expect(formatCostUsd(5.123)).toBe('$5.12')
    expect(formatCostUsd(5.126)).toBe('$5.13')
  })

  it('groups thousands for large amounts', () => {
    expect(formatCostUsd(1234.5)).toBe('$1,234.50')
    expect(formatCostUsd(75_000_000)).toBe('$75,000,000.00')
  })

  it('uses two significant digits below one dollar', () => {
    expect(formatCostUsd(0.28)).toBe('$0.28')
    expect(formatCostUsd(0.5604)).toBe('$0.56')
    expect(formatCostUsd(0.013)).toBe('$0.013')
    expect(formatCostUsd(0.0123)).toBe('$0.012')
    expect(formatCostUsd(0.045)).toBe('$0.045')
    expect(formatCostUsd(0.1)).toBe('$0.10')
  })

  it('does not print $1.0 when rounding carries over one dollar', () => {
    expect(formatCostUsd(0.996)).toBe('$1.00')
  })

  it('shows less than a cent for a positive amount under one cent', () => {
    expect(formatCostUsd(0.0099)).toBe('< $0.01')
    expect(formatCostUsd(0.000001)).toBe('< $0.01')
  })

  it('shows exactly one cent as $0.010', () => {
    expect(formatCostUsd(0.01)).toBe('$0.010')
  })

  it('reads $0.00 for zero and invalid amounts', () => {
    expect(formatCostUsd(0)).toBe('$0.00')
    expect(formatCostUsd(Number.NaN)).toBe('$0.00')
    expect(formatCostUsd(Number.POSITIVE_INFINITY)).toBe('$0.00')
  })

  it('keeps the sign of a negative amount', () => {
    expect(formatCostUsd(-0.5)).toBe('-$0.50')
    expect(formatCostUsd(-2)).toBe('-$2.00')
    expect(formatCostUsd(-0.001)).toBe('$0.00')
  })

  it('formats the estimator output from the design table', () => {
    const estimate = estimatePromptCacheCost({
      ...SONNET_PRICES,
      tokens: 64_000,
      turns: 20,
    })

    expect(formatCostUsd(estimate.uncached)).toBe('$3.84')
    expect(formatCostUsd(estimate.cached)).toBe('$0.60')
    expect(formatCostUsd(estimate.perChange)).toBe('$0.22')
  })
})

describe('formatApproxTokens', () => {
  it('prints small counts as they are', () => {
    expect(formatApproxTokens(573)).toBe('573')
    expect(formatApproxTokens(1)).toBe('1')
  })

  it('prints thousands with one decimal at most', () => {
    expect(formatApproxTokens(64_000)).toBe('64k')
    expect(formatApproxTokens(18_300)).toBe('18.3k')
    expect(formatApproxTokens(1840)).toBe('1.8k')
  })

  it('reads 0 for zero, negative and invalid counts', () => {
    expect(formatApproxTokens(0)).toBe('0')
    expect(formatApproxTokens(-5)).toBe('0')
    expect(formatApproxTokens(Number.NaN)).toBe('0')
  })
})
