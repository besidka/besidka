import { describe, expect, it } from 'vitest'
import {
  estimateArtifactBridgeMaxCost,
  formatArtifactBridgeCost,
  revealInvisibleCharacters,
} from '../../../app/utils/artifact-bridge'

const PRICED_MODEL = {
  inputPricePerMillion: 0.1,
  outputPricePerMillion: 0.5,
}

describe('revealInvisibleCharacters', () => {
  it('leaves ordinary text unchanged', () => {
    const text = 'Explain photosynthesis, please.\n\tSecond line.'

    expect(revealInvisibleCharacters(text)).toBe(text)
  })

  it('leaves non-Latin text, emoji and combining marks unchanged', () => {
    const text = 'Бесідка 日本語 مرحبا 😀 é'

    expect(revealInvisibleCharacters(text)).toBe(text)
  })

  it('returns an empty string for an empty string', () => {
    expect(revealInvisibleCharacters('')).toBe('')
  })

  it.each([
    ['​', '[U+200B]'],
    ['‌', '[U+200C]'],
    ['‍', '[U+200D]'],
    ['‎', '[U+200E]'],
    ['‏', '[U+200F]'],
    ['‪', '[U+202A]'],
    ['‫', '[U+202B]'],
    ['‬', '[U+202C]'],
    ['‭', '[U+202D]'],
    ['‮', '[U+202E]'],
    ['⁠', '[U+2060]'],
    ['⁡', '[U+2061]'],
    ['⁤', '[U+2064]'],
    ['⁦', '[U+2066]'],
    ['⁧', '[U+2067]'],
    ['⁨', '[U+2068]'],
    ['⁩', '[U+2069]'],
    ['﻿', '[U+FEFF]'],
  ])('shows %j as a visible marker', (character, marker) => {
    expect(revealInvisibleCharacters(character)).toBe(marker)
  })

  it('shows a right-to-left override inside a sentence', () => {
    expect(revealInvisibleCharacters('Pay ‮nothing‬ now'))
      .toBe('Pay [U+202E]nothing[U+202C] now')
  })

  it('shows every occurrence, not only the first', () => {
    expect(revealInvisibleCharacters('a​b​c﻿'))
      .toBe('a[U+200B]b[U+200B]c[U+FEFF]')
  })

  it('pads short code points to four hex digits in capitals', () => {
    expect(revealInvisibleCharacters('​')).toMatch(/^\[U\+[0-9A-F]{4}\]$/)
  })

  it('does not touch characters next to the ranges', () => {
    expect(revealInvisibleCharacters('\u2010\u202F \u2070'))
      .toBe('\u2010\u202F \u2070')
  })

  it('does not change the original string', () => {
    const original = 'x‮y'

    revealInvisibleCharacters(original)

    expect(original).toBe('x‮y')
  })
})

describe('estimateArtifactBridgeMaxCost', () => {
  it('prices one token per two characters plus the full output budget', () => {
    const cost = estimateArtifactBridgeMaxCost(PRICED_MODEL, 2000, 1000)

    expect(cost).toBeCloseTo((1000 * 0.1 + 1000 * 0.5) / 1_000_000)
  })

  it('rounds the input tokens up', () => {
    const cost = estimateArtifactBridgeMaxCost(PRICED_MODEL, 3, 0)

    expect(cost).toBeCloseTo((2 * 0.1) / 1_000_000)
  })

  it('costs only the output budget for an empty input', () => {
    const cost = estimateArtifactBridgeMaxCost(PRICED_MODEL, 0, 2000)

    expect(cost).toBeCloseTo((2000 * 0.5) / 1_000_000)
  })

  it('grows with the input length and the output budget', () => {
    const small = estimateArtifactBridgeMaxCost(PRICED_MODEL, 100, 100)!
    const longer = estimateArtifactBridgeMaxCost(PRICED_MODEL, 10_000, 100)!
    const bigger = estimateArtifactBridgeMaxCost(PRICED_MODEL, 100, 2000)!

    expect(longer).toBeGreaterThan(small)
    expect(bigger).toBeGreaterThan(small)
  })

  it('handles an expensive model at the largest input', () => {
    const cost = estimateArtifactBridgeMaxCost(
      { inputPricePerMillion: 5, outputPricePerMillion: 25 },
      10_000,
      2000,
    )

    expect(cost).toBeCloseTo((5000 * 5 + 2000 * 25) / 1_000_000)
  })

  it('returns null without an input price', () => {
    expect(estimateArtifactBridgeMaxCost({
      inputPricePerMillion: null,
      outputPricePerMillion: 0.5,
    }, 100, 100)).toBeNull()
  })

  it('returns null without an output price', () => {
    expect(estimateArtifactBridgeMaxCost({
      inputPricePerMillion: 0.1,
      outputPricePerMillion: null,
    }, 100, 100)).toBeNull()
  })

  it('accepts a free model with a price of zero', () => {
    expect(estimateArtifactBridgeMaxCost({
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    }, 100, 100)).toBe(0)
  })
})

describe('formatArtifactBridgeCost', () => {
  it('says the price is unknown for null', () => {
    expect(formatArtifactBridgeCost(null))
      .toBe('unknown (no published price)')
  })

  it.each([0, 0.000001, 0.0099])('says under one cent for %s', (cost) => {
    expect(formatArtifactBridgeCost(cost)).toBe('under $0.01')
  })

  it('switches to a rounded amount at one cent', () => {
    expect(formatArtifactBridgeCost(0.01)).toBe('about $0.01')
  })

  it('rounds to two decimals', () => {
    expect(formatArtifactBridgeCost(0.126)).toBe('about $0.13')
    expect(formatArtifactBridgeCost(1)).toBe('about $1.00')
    expect(formatArtifactBridgeCost(12.344)).toBe('about $12.34')
  })
})
