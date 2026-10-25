import { describe, expect, it } from 'vitest'
import { detectSpecialCategories } from '~~/server/utils/memory/special-category'

describe('detectSpecialCategories', () => {
  it('returns an array of categories', () => {
    const categories = detectSpecialCategories('I like terse answers')

    expect(Array.isArray(categories)).toBe(true)
  })

  it('returns no categories while the classifier seam is not wired', () => {
    expect(detectSpecialCategories('')).toEqual([])
  })
})
