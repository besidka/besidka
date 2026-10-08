import { describe, expect, it } from 'vitest'
import { getModelCostMap } from '../../../server/utils/ai/cost-map'

describe('getModelCostMap', () => {
  it('never returns a per-token price for an image-generation model', () => {
    const costMap = getModelCostMap()

    expect(costMap['gemini-3.1-flash-image']).toBeUndefined()
    expect(costMap['gemini-3.1-flash-lite-image']).toBeUndefined()
    expect(costMap['gemini-3-pro-image']).toBeUndefined()
    expect(costMap['gemini-2.5-flash-image']).toBeUndefined()
    expect(costMap['gpt-image-2']).toBeUndefined()
  })

  it('does not fall back to a same-prefixed text model price', () => {
    const costMap = getModelCostMap()

    expect(costMap['gemini-2.5-flash']).toBeDefined()
    expect(costMap['gemini-2.5-flash-image']).not.toEqual(
      costMap['gemini-2.5-flash'],
    )
    expect(costMap['gemini-2.5-flash-image']).toBeUndefined()
  })

  it('still resolves an exact-match text model price', () => {
    const costMap = getModelCostMap()

    expect(costMap['gpt-5.4']).toEqual({
      input: 2.5,
      output: 15,
      cacheRead: 0.25,
    })
  })

  it('carries both cache prices for a model that publishes them', () => {
    const costMap = getModelCostMap()

    expect(costMap['claude-sonnet-5-5']).toEqual({
      input: 2,
      output: 10,
      cacheRead: 0.1,
      cacheWrite: 2.5,
    })
  })

  it('keeps sub-cent cache prices at full precision', () => {
    const costMap = getModelCostMap()

    expect(costMap['deepseek-flash']?.cacheRead).toBe(0.003)
  })

  it('omits cache prices for a model that publishes none', () => {
    const costMap = getModelCostMap()

    expect(costMap['gpt-4']).toEqual({ input: 30, output: 60 })
    expect(costMap['gpt-4']).not.toHaveProperty('cacheRead')
    expect(costMap['gpt-4']).not.toHaveProperty('cacheWrite')
  })

  it('still falls back to a longest-prefix match for a versioned text model', () => {
    const costMap = getModelCostMap()

    expect(costMap['gpt-5.4-nano-2026-03-17']).toEqual(
      costMap['gpt-5.4-nano'],
    )
    expect(costMap['gpt-5.4-nano-2026-03-17']).toBeDefined()
  })

  it('returns undefined for a completely unknown model', () => {
    const costMap = getModelCostMap()

    expect(costMap['unknown-model-xyz']).toBeUndefined()
  })
})
