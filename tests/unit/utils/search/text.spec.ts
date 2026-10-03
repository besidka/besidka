import { describe, expect, it } from 'vitest'
import {
  extractMessageSearchText,
  MAX_INDEXED_BODY_LENGTH,
  normalizeSearchText,
  SEARCH_APOSTROPHE,
} from '../../../../server/utils/search/text'

describe('extractMessageSearchText', () => {
  it('returns an empty string for non-array input', () => {
    expect(extractMessageSearchText(undefined)).toBe('')
    expect(extractMessageSearchText(null)).toBe('')
    expect(extractMessageSearchText('not an array')).toBe('')
    expect(extractMessageSearchText({})).toBe('')
  })

  it('keeps only text parts and joins them with a newline', () => {
    const parts = [
      { type: 'text', text: 'Hello world' },
      { type: 'reasoning', text: 'ignored reasoning' },
      { type: 'file', url: 'https://example.com/file.png' },
      { type: 'step-start' },
      { type: 'tool-generate_image', state: 'output-available' },
      { type: 'text', text: 'Second line' },
    ]

    expect(extractMessageSearchText(parts)).toBe('Hello world Second line')
  })

  it('drops empty and whitespace-only text parts', () => {
    const parts = [
      { type: 'text', text: '   ' },
      { type: 'text', text: '' },
      { type: 'text', text: 'Kept' },
    ]

    expect(extractMessageSearchText(parts)).toBe('Kept')
  })

  it('truncates the result at MAX_INDEXED_BODY_LENGTH', () => {
    const longText = 'a'.repeat(MAX_INDEXED_BODY_LENGTH + 500)
    const parts = [{ type: 'text', text: longText }]

    const result = extractMessageSearchText(parts)

    expect(result).toHaveLength(MAX_INDEXED_BODY_LENGTH)
  })

  it('bounds a pathologically long message (10x the cap)', () => {
    const pathologicalText = 'a'.repeat(MAX_INDEXED_BODY_LENGTH * 10)
    const parts = [{ type: 'text', text: pathologicalText }]

    const result = extractMessageSearchText(parts)

    expect(result).toHaveLength(MAX_INDEXED_BODY_LENGTH)
  })

  it('excludes a persisted empty-answer failure notice', () => {
    const parts = [
      {
        type: 'text',
        text: 'The model finished searching but didn\'t write an answer.'
          + ' Try again or pick another model.',
      },
      { type: 'text', text: 'Kept' },
    ]

    expect(extractMessageSearchText(parts)).toBe('Kept')
  })

  it('excludes a persisted image-generation failure notice', () => {
    const parts = [
      {
        type: 'text',
        text: 'Image generation failed. Revise the prompt or try a'
          + ' different provider. (ref: abc123)',
      },
      { type: 'text', text: 'Kept' },
    ]

    expect(extractMessageSearchText(parts)).toBe('Kept')
  })

  it('excludes a persisted oversized-response failure notice', () => {
    const parts = [
      {
        type: 'text',
        text: 'The response was too large to save. Try again or pick'
          + ' another model.',
      },
      { type: 'text', text: 'Kept' },
    ]

    expect(extractMessageSearchText(parts)).toBe('Kept')
  })

  it('excludes a persisted gateway generated-image-save failure notice',
    () => {
      const parts = [
        {
          type: 'text',
          text: 'An image was generated but could not be saved.',
        },
        { type: 'text', text: 'Kept' },
      ]

      expect(extractMessageSearchText(parts)).toBe('Kept')
    })

  it('keeps normal text that merely mentions image generation failing', () => {
    const parts = [
      {
        type: 'text',
        text: 'My last image generation failed, can you explain why?',
      },
    ]

    expect(extractMessageSearchText(parts)).toBe(
      'My last image generation failed, can you explain why?',
    )
  })

  it('strips private-use-area snippet sentinel characters', () => {
    const parts = [{
      type: 'text',
      text: 'before  highlighted  after',
    }]

    const result = extractMessageSearchText(parts)

    expect(result).not.toContain('')
    expect(result).not.toContain('')
    expect(result).toBe('before highlighted after')
  })
})

describe('normalizeSearchText', () => {
  it('canonicalises every apostrophe variant to U+02BC', () => {
    const variants = [
      'п\'ять',
      'п’ять',
      'п`ять',
      'п´ять',
    ]

    for (const variant of variants) {
      expect(normalizeSearchText(variant)).toBe(`п${SEARCH_APOSTROPHE}ять`)
    }
  })

  it('applies NFC normalisation', () => {
    const decomposed = 'é'
    const composed = 'é'

    expect(normalizeSearchText(decomposed)).toBe(normalizeSearchText(composed))
  })

  it('collapses whitespace runs', () => {
    expect(normalizeSearchText('hello   \n\t  world')).toBe('hello world')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeSearchText('  hello world  ')).toBe('hello world')
  })
})
