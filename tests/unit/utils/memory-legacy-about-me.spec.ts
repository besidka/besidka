import { describe, expect, it } from 'vitest'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import { buildAboutMeDescription } from '~~/server/utils/memory/about-me-migration'
import {
  buildLegacyAboutMeDescription,
  buildLegacyAboutMeEntryValues,
} from '~/utils/memory-legacy-about-me'

const limit = MEMORY_LIMITS.maxDescriptionChars

describe('buildLegacyAboutMeDescription', () => {
  it('uses the first non-empty line', () => {
    expect(buildLegacyAboutMeDescription('\n  \nBackend dev.\nSecond line.'))
      .toBe('Backend dev.')
  })

  it('collapses inner whitespace to a single line', () => {
    expect(buildLegacyAboutMeDescription('Backend \t  dev'))
      .toBe('Backend dev')
  })

  it('keeps a line of exactly the limit untouched', () => {
    const line = 'a'.repeat(limit)

    expect(buildLegacyAboutMeDescription(line)).toBe(line)
  })

  it('cuts a longer line at the last word boundary with an ellipsis', () => {
    const description = buildLegacyAboutMeDescription(
      `${'word '.repeat(30)}tail`,
    )

    expect(description.length).toBeLessThanOrEqual(limit)
    expect(description.endsWith('word…')).toBe(true)
  })

  it('hard-cuts a long line without spaces', () => {
    expect(buildLegacyAboutMeDescription('я'.repeat(300)))
      .toBe(`${'я'.repeat(limit - 1)}…`)
  })

  it('does not leave half of a surrogate pair', () => {
    const description = buildLegacyAboutMeDescription('😀'.repeat(100))

    expect(description.length).toBeLessThanOrEqual(limit)
    expect(description).not.toMatch(/[\uD800-\uDBFF]…$/)
  })

  it('falls back when there is no text', () => {
    expect(buildLegacyAboutMeDescription('  \n ')).toBe(
      'Things I wrote about myself',
    )
  })

  it.each([
    'Backend dev.\nSecond line.',
    '  \n\n  Spaced   out \t line',
    `${'word '.repeat(40)}tail`,
    'я'.repeat(250),
    '😀'.repeat(120),
    `${'a'.repeat(limit - 1)} b`,
    `${'a'.repeat(limit - 1)}\u2028second`,
    '',
  ])('matches the server rule for %j', (text) => {
    expect(buildLegacyAboutMeDescription(text))
      .toBe(buildAboutMeDescription(text))
  })
})

describe('buildLegacyAboutMeEntryValues', () => {
  it('prefills a Profile entry titled About me when none exists', () => {
    expect(buildLegacyAboutMeEntryValues('I am a developer.\nMore.', false))
      .toEqual({
        title: 'About me',
        description: 'I am a developer.',
        body: 'I am a developer.\nMore.',
        category: 'profile',
      })
  })

  it('falls back to Topics when a Profile entry already exists', () => {
    expect(buildLegacyAboutMeEntryValues('I am a developer.', true).category)
      .toBe('topics')
  })

  it('keeps the legacy text untouched as the body', () => {
    const text = '  Line one\n\n  Line two  '

    expect(buildLegacyAboutMeEntryValues(text, false).body).toBe(text)
  })
})
