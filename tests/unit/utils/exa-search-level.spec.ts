import { describe, expect, it } from 'vitest'
import {
  isExaSearchLevel,
  normalizeExaSearchLevel,
} from '#shared/utils/exa-search-level'

describe('isExaSearchLevel', () => {
  it('accepts every supported level', () => {
    expect(isExaSearchLevel('lite')).toBe(true)
    expect(isExaSearchLevel('auto')).toBe(true)
    expect(isExaSearchLevel('deep')).toBe(true)
  })

  it('rejects unknown strings, null, undefined and non-string values', () => {
    expect(isExaSearchLevel('fast')).toBe(false)
    expect(isExaSearchLevel('')).toBe(false)
    expect(isExaSearchLevel(null)).toBe(false)
    expect(isExaSearchLevel(undefined)).toBe(false)
    expect(isExaSearchLevel(3)).toBe(false)
  })
})

describe('normalizeExaSearchLevel', () => {
  it('returns supported levels unchanged', () => {
    expect(normalizeExaSearchLevel('lite')).toBe('lite')
    expect(normalizeExaSearchLevel('auto')).toBe('auto')
    expect(normalizeExaSearchLevel('deep')).toBe('deep')
  })

  it('falls back to auto for invalid input', () => {
    expect(normalizeExaSearchLevel('fast')).toBe('auto')
    expect(normalizeExaSearchLevel(null)).toBe('auto')
    expect(normalizeExaSearchLevel(undefined)).toBe('auto')
    expect(normalizeExaSearchLevel(42)).toBe('auto')
  })
})
