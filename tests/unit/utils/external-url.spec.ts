import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl } from '../../../shared/utils/external-url'

describe('isSafeExternalUrl', () => {
  it('accepts https urls', () => {
    expect(isSafeExternalUrl('https://example.com/a?b=c')).toBe(true)
    expect(isSafeExternalUrl('HTTPS://EXAMPLE.COM')).toBe(true)
  })

  it('rejects plain http and other schemes', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>'))
      .toBe(false)
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('ftp://example.com')).toBe(false)
  })

  it('rejects relative, protocol-relative, empty and unparsable values', () => {
    expect(isSafeExternalUrl('/relative/path')).toBe(false)
    expect(isSafeExternalUrl('//example.com')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
    expect(isSafeExternalUrl('')).toBe(false)
    expect(isSafeExternalUrl(null)).toBe(false)
    expect(isSafeExternalUrl(undefined)).toBe(false)
  })
})
