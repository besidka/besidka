import { describe, expect, it } from 'vitest'
import {
  extractLocalFileStorageKey,
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

  it('extracts safe local keys from private and tokenized file URLs', () => {
    expect(extractLocalFileStorageKey('/files/abc-123_file.webp'))
      .toBe('abc-123_file.webp')
    expect(extractLocalFileStorageKey(
      '/files/abc-123_file.webp?token=header.payload.signature#preview',
    )).toBe('abc-123_file.webp')
  })

  it.each([
    '',
    'abc.webp',
    'javascript:alert(1)',
    'data:image/png;base64,abc',
    'https://besidka.com/files/abc.webp',
    '//evil.example/files/abc.webp',
    '/files/',
    '/files/.',
    '/files/..',
    '/files/a..b.webp',
    '/files/folder/abc.webp',
    '/files/folder\\abc.webp',
    '/files/%2Fetc%2Fpasswd',
    '/files/%5cwindows',
    '/files/%2e%2e%2fsecret',
    '/files/abc.webp/extra',
    '/files/abc:123.webp',
  ])('rejects unsafe file URL %s', (url) => {
    expect(extractLocalFileStorageKey(url)).toBeNull()
  })
})
