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

    expect(costMap['gpt-5.4']).toEqual({ input: 2.5, output: 15 })
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
