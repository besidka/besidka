import { describe, expect, it } from 'vitest'
import {
  getPreferredFileExtension,
  normalizeMediaType,
} from '../../../shared/utils/files'

describe('shared files utils', () => {
  it('normalizes media type by trimming params and casing', () => {
    expect(normalizeMediaType('Text/Plain; charset=UTF-8'))
      .toBe('text/plain')
  })

  it('returns empty string for invalid media type', () => {
    expect(normalizeMediaType('not-a-media-type')).toBe('')
  })

  it('returns preferred extension for mapped media types', () => {
    expect(getPreferredFileExtension('image/jpeg')).toBe('jpg')
    expect(getPreferredFileExtension('text/plain; charset=utf-8')).toBe('txt')
  })

  it('falls back to structured subtype parsing when possible', () => {
    expect(getPreferredFileExtension('application/problem+json')).toBe('json')
    expect(getPreferredFileExtension('application/x-tar')).toBe('tar')
  })

  it('falls back to bin for unsupported subtype shapes', () => {
    expect(
      getPreferredFileExtension(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('bin')
  })
})
