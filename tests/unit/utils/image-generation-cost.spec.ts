import { describe, expect, it } from 'vitest'
import {
  getImageGenerationCost,
} from '../../../server/utils/ai/image-generation-cost'

describe('getImageGenerationCost', () => {
  it('returns the flat price for gemini-3.1-flash-image', () => {
    expect(getImageGenerationCost('gemini-3.1-flash-image', '1:1'))
      .toBe(0.067)
    expect(getImageGenerationCost('gemini-3.1-flash-image', '3:2'))
      .toBe(0.067)
  })

  it('returns the flat price for gemini-3.1-flash-lite-image', () => {
    expect(getImageGenerationCost('gemini-3.1-flash-lite-image', '1:1'))
      .toBe(0.0336)
  })

  it('returns the flat price for gemini-3-pro-image', () => {
    expect(getImageGenerationCost('gemini-3-pro-image', '2:3'))
      .toBe(0.134)
  })

  it('returns the flat price for gemini-2.5-flash-image', () => {
    expect(getImageGenerationCost('gemini-2.5-flash-image', '1:1'))
      .toBe(0.039)
  })

  it('returns the square price for gpt-image-2 at 1:1', () => {
    expect(getImageGenerationCost('gpt-image-2', '1:1')).toBe(0.041)
  })

  it('returns the non-square price for gpt-image-2 at 2:3 and 3:2', () => {
    expect(getImageGenerationCost('gpt-image-2', '2:3')).toBe(0.053)
    expect(getImageGenerationCost('gpt-image-2', '3:2')).toBe(0.053)
  })

  it('returns undefined for a model with no known image price', () => {
    expect(getImageGenerationCost('gpt-5.4', '1:1')).toBeUndefined()
    expect(getImageGenerationCost('unknown-model', '1:1')).toBeUndefined()
  })
})
