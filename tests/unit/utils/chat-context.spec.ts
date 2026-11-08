import { describe, expect, it } from 'vitest'
import { toSafeLocalUrl } from '../../../app/utils/chat-context'

describe('toSafeLocalUrl', () => {
  it('keeps same-origin relative paths unchanged', () => {
    expect(toSafeLocalUrl('/files/key-1')).toBe('/files/key-1')
    expect(toSafeLocalUrl('/files/key-1?download=1#top'))
      .toBe('/files/key-1?download=1#top')
    expect(toSafeLocalUrl('/')).toBe('/')
  })

  it('rejects protocol-relative urls', () => {
    expect(toSafeLocalUrl('//evil.test/a.png')).toBeNull()
    expect(toSafeLocalUrl('///evil.test/a.png')).toBeNull()
  })

  it('rejects absolute and scripted urls', () => {
    expect(toSafeLocalUrl('https://example.com/a.png')).toBeNull()
    expect(toSafeLocalUrl('http://example.com/a.png')).toBeNull()
    expect(toSafeLocalUrl('javascript:alert(1)')).toBeNull()
    expect(toSafeLocalUrl('data:image/png;base64,AAAA')).toBeNull()
    expect(toSafeLocalUrl('blob:https://example.com/id')).toBeNull()
  })

  it('rejects relative paths that do not start with a slash', () => {
    expect(toSafeLocalUrl('files/key-1')).toBeNull()
    expect(toSafeLocalUrl('./files/key-1')).toBeNull()
    expect(toSafeLocalUrl(' /files/key-1')).toBeNull()
  })

  it('rejects missing and empty values', () => {
    expect(toSafeLocalUrl(undefined)).toBeNull()
    expect(toSafeLocalUrl(null)).toBeNull()
    expect(toSafeLocalUrl('')).toBeNull()
  })
})
