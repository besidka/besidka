import { describe, expect, it } from 'vitest'
import { buildShareDescription } from '../../../shared/utils/og-description'

describe('buildShareDescription', () => {
  it('returns the first sentence when it fits within maxLength', () => {
    const parts = [
      {
        type: 'text',
        text: 'Hello world. This is a much longer second sentence '
          + 'that keeps going for a while.',
      },
    ]

    expect(buildShareDescription(parts)).toBe('Hello world.')
  })

  it('cuts at the last word boundary and appends an ellipsis '
    + 'when the sentence overruns maxLength', () => {
    const parts = [
      {
        type: 'text',
        text: 'The quick brown fox jumps over the lazy dog again '
          + 'and again without stopping',
      },
    ]

    expect(buildShareDescription(parts, 22)).toBe('The quick brown fox…')
  })

  it('strips markdown syntax noise before building the description', () => {
    const parts = [
      {
        type: 'text',
        text: '# Heading\n\nSome **bold** text and `code` here.',
      },
    ]

    expect(buildShareDescription(parts))
      .toBe('Heading Some bold text and code here.')
  })

  it('collapses newlines and repeated spaces into single spaces', () => {
    const parts = [
      { type: 'text', text: 'Hello\n\n\nworld   test.' },
    ]

    expect(buildShareDescription(parts)).toBe('Hello world test.')
  })

  it('returns an empty string for an empty parts array', () => {
    expect(buildShareDescription([])).toBe('')
  })

  it('returns an empty string when no part has type text', () => {
    const parts = [
      { type: 'reasoning', text: 'thinking...' },
      { type: 'file', url: 'https://example.com/file.png' },
    ]

    expect(buildShareDescription(parts)).toBe('')
  })

  it('returns an empty string when the only text part is blank', () => {
    const parts = [
      { type: 'text', text: '   ' },
    ]

    expect(buildShareDescription(parts)).toBe('')
  })

  it('returns an empty string when parts is not an array', () => {
    expect(buildShareDescription(undefined)).toBe('')
    expect(buildShareDescription(null)).toBe('')
    expect(buildShareDescription('not-an-array')).toBe('')
  })

  it('does not end with a split surrogate pair when truncating '
    + 'a spaceless run of astral characters', () => {
    const parts = [
      { type: 'text', text: `A${'🙂'.repeat(200)}` },
    ]

    const result = buildShareDescription(parts)

    expect(result.at(-1)).toBe('…')
    expect(result).not.toMatch(/[\uD800-\uDBFF]…$/)
  })
})
