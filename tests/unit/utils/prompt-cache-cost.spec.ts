import { describe, expect, it } from 'vitest'
import { estimatePromptCacheCost } from '#shared/utils/prompt-cache-cost'

describe('estimatePromptCacheCost', () => {
  it('reproduces the Claude Opus 5.5 row', () => {
    const estimate = estimatePromptCacheCost({
      cost: { input: 4, cacheRead: 0.2, cacheWrite: 5 },
      tokens: 64_000,
      turns: 20,
    })

    expect(estimate.uncachedUsd).toBeCloseTo(5.12, 6)
    expect(estimate.cachedUsd).toBeCloseTo(0.5632, 6)
    expect(estimate.perChangeUsd).toBeCloseTo(0.3072, 6)
    expect(estimate.savingsRatio).toBeCloseTo(1 - 0.5632 / 5.12, 6)
    expect(estimate.hasCachePrice).toBe(true)
  })

  it('reproduces the Gemini 3.8 Flash row without a write price', () => {
    const estimate = estimatePromptCacheCost({
      cost: { input: 0.75, cacheRead: 0.075 },
      tokens: 64_000,
      turns: 20,
    })

    expect(estimate.uncachedUsd).toBeCloseTo(0.96, 6)
    expect(estimate.cachedUsd).toBeCloseTo(0.1392, 6)
    expect(estimate.perChangeUsd).toBeCloseTo(0.0432, 6)
    expect(estimate.savingsRatio).toBeCloseTo(1 - 0.1392 / 0.96, 6)
    expect(estimate.hasCachePrice).toBe(true)
  })

  it('reproduces the Kimi K2.6 row', () => {
    const estimate = estimatePromptCacheCost({
      cost: { input: 0.95, cacheRead: 0.16 },
      tokens: 18_350,
      turns: 20,
    })

    expect(estimate.uncachedUsd).toBeCloseTo(0.34865, 5)
    expect(estimate.cachedUsd).toBeCloseTo(
      18_350 * 0.95 / 1e6 + 19 * 18_350 * 0.16 / 1e6,
      8,
    )
    expect(estimate.perChangeUsd).toBeCloseTo(18_350 * 0.79 / 1e6, 8)
    expect(estimate.perChangeUsd).toBeCloseTo(0.0145, 3)
    expect(estimate.cachedUsd).toBeCloseTo(0.0732, 3)
  })

  it('reproduces the DeepSeek Flash row', () => {
    const estimate = estimatePromptCacheCost({
      cost: { input: 0.15, cacheRead: 0.003 },
      tokens: 64_000,
      turns: 20,
    })

    expect(estimate.uncachedUsd).toBeCloseTo(0.192, 6)
    expect(estimate.cachedUsd).toBeCloseTo(0.013248, 6)
    expect(estimate.perChangeUsd).toBeCloseTo(0.009408, 6)
    expect(estimate.savingsRatio).toBeCloseTo(0.931, 3)
  })

  it('falls back to the input price when no cache prices exist', () => {
    const estimate = estimatePromptCacheCost({
      cost: { input: 2 },
      tokens: 10_000,
      turns: 5,
    })

    expect(estimate.uncachedUsd).toBeCloseTo(0.1, 8)
    expect(estimate.cachedUsd).toBeCloseTo(0.1, 8)
    expect(estimate.perChangeUsd).toBe(0)
    expect(estimate.savingsRatio).toBeCloseTo(0, 8)
    expect(estimate.hasCachePrice).toBe(false)
  })

  it('treats null cache prices like missing ones', () => {
    const estimate = estimatePromptCacheCost({
      cost: { input: 2, cacheRead: null, cacheWrite: null },
      tokens: 10_000,
      turns: 5,
    })

    expect(estimate.hasCachePrice).toBe(false)
    expect(estimate.perChangeUsd).toBe(0)
  })

  it('does not report a cache price for a non-finite read price', () => {
    const estimate = estimatePromptCacheCost({
      cost: { input: 2, cacheRead: Number.NaN },
      tokens: 10_000,
      turns: 5,
    })

    expect(estimate.hasCachePrice).toBe(false)
  })

  it('charges a single turn as one cache write', () => {
    const estimate = estimatePromptCacheCost({
      cost: { input: 4, cacheRead: 0.2, cacheWrite: 5 },
      tokens: 1_000_000,
      turns: 1,
    })

    expect(estimate.uncachedUsd).toBeCloseTo(4, 8)
    expect(estimate.cachedUsd).toBeCloseTo(5, 8)
    expect(estimate.savingsRatio).toBeCloseTo(-0.25, 8)
  })

  it('returns zeros for fewer than one turn', () => {
    const estimate = estimatePromptCacheCost({
      cost: { input: 4, cacheRead: 0.2, cacheWrite: 5 },
      tokens: 64_000,
      turns: 0,
    })

    expect(estimate).toEqual({
      uncachedUsd: 0,
      cachedUsd: 0,
      perChangeUsd: 0,
      savingsRatio: 0,
      hasCachePrice: true,
    })
  })

  it('returns zeros for non-positive tokens', () => {
    const estimate = estimatePromptCacheCost({
      cost: { input: 4 },
      tokens: 0,
      turns: 20,
    })

    expect(estimate).toEqual({
      uncachedUsd: 0,
      cachedUsd: 0,
      perChangeUsd: 0,
      savingsRatio: 0,
      hasCachePrice: false,
    })
  })

  it('returns a zero ratio when the input price is zero', () => {
    const estimate = estimatePromptCacheCost({
      cost: { input: 0, cacheRead: 0, cacheWrite: 0 },
      tokens: 64_000,
      turns: 20,
    })

    expect(estimate.uncachedUsd).toBe(0)
    expect(estimate.savingsRatio).toBe(0)
  })
})
