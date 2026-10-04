import { describe, expect, it } from 'vitest'
import { isHttpUrl } from '../../../shared/utils/http-url'

describe('isHttpUrl', () => {
  it('accepts http and https urls', () => {
    expect(isHttpUrl('https://example.com/a?b=c')).toBe(true)
    expect(isHttpUrl('http://example.com')).toBe(true)
    expect(isHttpUrl('HTTPS://EXAMPLE.COM')).toBe(true)
  })

  it('rejects other schemes', () => {
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isHttpUrl('ftp://example.com')).toBe(false)
    expect(isHttpUrl('vbscript:msgbox')).toBe(false)
  })

  it('rejects relative, empty and unparsable values', () => {
    expect(isHttpUrl('/relative/path')).toBe(false)
    expect(isHttpUrl('not-a-valid-url')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
  })
})
