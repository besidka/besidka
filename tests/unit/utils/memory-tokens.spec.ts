import { describe, expect, it } from 'vitest'
import {
  MEMORY_CHARS_PER_TOKEN,
  estimateMemoryTokens,
} from '#shared/utils/memory-tokens'

describe('estimateMemoryTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateMemoryTokens('')).toBe(0)
  })

  it('counts ASCII at a quarter token per character', () => {
    expect(MEMORY_CHARS_PER_TOKEN.latin).toBe(4)
    expect(estimateMemoryTokens('a'.repeat(400))).toBe(100)
  })

  it('counts Cyrillic at 2.5 characters per token', () => {
    expect(MEMORY_CHARS_PER_TOKEN.cyrillic).toBe(2.5)
    expect(estimateMemoryTokens('я'.repeat(250))).toBe(100)
  })

  it('counts other non-ASCII at 1.5 characters per token', () => {
    expect(MEMORY_CHARS_PER_TOKEN.other).toBe(1.5)
    expect(estimateMemoryTokens('漢'.repeat(150))).toBe(100)
  })

  it('counts an emoji surrogate pair as one character', () => {
    expect(estimateMemoryTokens('😀'.repeat(3))).toBe(2)
  })

  it('treats accented Latin letters as Latin', () => {
    expect(estimateMemoryTokens('ąćęłńóśźż'.repeat(4))).toBe(9)
  })

  it('treats typographic punctuation as other characters', () => {
    expect(estimateMemoryTokens('—')).toBe(1)
    expect(estimateMemoryTokens('…‹›')).toBe(2)
  })

  it('rounds the summed total up once, not per class', () => {
    expect(estimateMemoryTokens('ab')).toBe(1)
    expect(estimateMemoryTokens('abя')).toBe(1)
    expect(estimateMemoryTokens('abяя')).toBe(2)
  })

  it('sums mixed classes', () => {
    const text = `${'a'.repeat(40)}${'я'.repeat(25)}${'漢'.repeat(15)}`

    expect(estimateMemoryTokens(text)).toBe(10 + 10 + 10)
  })

  it('estimates the same Cyrillic text higher than Latin text', () => {
    const latin = 'x'.repeat(1000)
    const cyrillic = 'ж'.repeat(1000)

    expect(estimateMemoryTokens(cyrillic)).toBeGreaterThan(
      estimateMemoryTokens(latin),
    )
  })
})
