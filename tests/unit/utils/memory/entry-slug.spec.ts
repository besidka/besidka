import { describe, expect, it } from 'vitest'
import {
  MEMORY_ENTRY_SLUG_PATTERN,
  MEMORY_LIMITS,
} from '#shared/utils/memory-policy'
import {
  slugifyMemoryTitle,
  suffixMemorySlug,
} from '~~/server/utils/memory/entry-slug'

describe('slugifyMemoryTitle', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(slugifyMemoryTitle('Favorite Programming Languages'))
      .toBe('favorite-programming-languages')
  })

  it('collapses punctuation and trims edge hyphens', () => {
    expect(slugifyMemoryTitle('  --Hello,   world!!  ')).toBe('hello-world')
  })

  it('transliterates Ukrainian titles', () => {
    expect(slugifyMemoryTitle('Улюблена їжа')).toBe('uliublena-izha')
    expect(slugifyMemoryTitle('Щастя, ґанок і Євген')).toBe(
      'shchastia-ganok-i-ievhen',
    )
  })

  it('transliterates Russian titles', () => {
    expect(slugifyMemoryTitle('Съёмка ёжика')).toBe('semka-ezhyka')
    expect(slugifyMemoryTitle('Объём')).toBe('obem')
  })

  it('treats decomposed Cyrillic the same as composed', () => {
    const decomposed = 'Йод'.normalize('NFD')

    expect(slugifyMemoryTitle(decomposed)).toBe(slugifyMemoryTitle('Йод'))
    expect(slugifyMemoryTitle('Йод')).toBe('iod')
  })

  it('strips Latin diacritics', () => {
    expect(slugifyMemoryTitle('Zażółć gęślą jaźń')).toBe('zazolc-gesla-jazn')
    expect(slugifyMemoryTitle('Crème brûlée')).toBe('creme-brulee')
  })

  it('falls back to entry when nothing slug-safe remains', () => {
    expect(slugifyMemoryTitle('日本語')).toBe('entry')
    expect(slugifyMemoryTitle('!!!')).toBe('entry')
    expect(slugifyMemoryTitle('')).toBe('entry')
  })

  it('caps the slug length without a trailing hyphen', () => {
    const slug = slugifyMemoryTitle(`${'word '.repeat(40)}end`)

    expect(slug.length).toBeLessThanOrEqual(MEMORY_LIMITS.maxSlugChars)
    expect(slug.endsWith('-')).toBe(false)
  })

  it('always produces a slug matching the policy pattern', () => {
    const titles = [
      'Hello World',
      'Привіт, світе',
      'Łódź & Gdańsk',
      '12345',
      'a'.repeat(200),
      '🙂 emoji only 🙂',
    ]

    for (const title of titles) {
      expect(slugifyMemoryTitle(title)).toMatch(MEMORY_ENTRY_SLUG_PATTERN)
    }
  })
})

describe('suffixMemorySlug', () => {
  it('returns the base slug for the first attempt', () => {
    expect(suffixMemorySlug('cooking', 1)).toBe('cooking')
  })

  it('appends the attempt number from the second attempt', () => {
    expect(suffixMemorySlug('cooking', 2)).toBe('cooking-2')
    expect(suffixMemorySlug('cooking', 13)).toBe('cooking-13')
  })

  it('keeps the suffixed slug within the length cap', () => {
    const baseSlug = 'a'.repeat(MEMORY_LIMITS.maxSlugChars)
    const slug = suffixMemorySlug(baseSlug, 12)

    expect(slug.length).toBeLessThanOrEqual(MEMORY_LIMITS.maxSlugChars)
    expect(slug.endsWith('-12')).toBe(true)
    expect(slug).toMatch(MEMORY_ENTRY_SLUG_PATTERN)
  })
})
