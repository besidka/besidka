import { describe, expect, it } from 'vitest'
import { buildAboutMeDescription } from '#shared/utils/memory-about-me'
import { buildLegacyAboutMeEntryValues } from '~/utils/memory-legacy-about-me'

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

  it('derives the description with the shared about-me rule', () => {
    const text = `${'word '.repeat(40)}tail`

    expect(buildLegacyAboutMeEntryValues(text, false).description)
      .toBe(buildAboutMeDescription(text))
  })
})
