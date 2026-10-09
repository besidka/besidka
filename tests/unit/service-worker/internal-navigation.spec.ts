import { describe, expect, it } from 'vitest'
import {
  resolveInternalNavigationTarget,
} from '../../../app/service-worker/internal-navigation'

const ORIGIN = 'https://besidka.com'

describe('resolveInternalNavigationTarget', () => {
  it('returns a valid same-origin path unchanged', () => {
    expect(resolveInternalNavigationTarget('/chats/abc', ORIGIN))
      .toBe('/chats/abc')
  })

  it('keeps the search and hash of the resolved URL', () => {
    expect(resolveInternalNavigationTarget('/chats/abc?x=1#top', ORIGIN))
      .toBe('/chats/abc?x=1#top')
  })

  it('normalises dot segments against the origin', () => {
    expect(resolveInternalNavigationTarget('/chats/../shared/abc', ORIGIN))
      .toBe('/shared/abc')
  })

  it('works for a localhost origin with a port', () => {
    expect(resolveInternalNavigationTarget(
      '/chats/abc',
      'http://localhost:3905',
    )).toBe('/chats/abc')
  })

  it.each([
    ['a backslash after the slash', '/\\evil.com'],
    ['a backslash anywhere', '/chats\\abc'],
    ['a protocol-relative url', '//evil.com'],
    ['a protocol-relative url with a path', '//evil.com/chats/abc'],
    ['an absolute external url', 'https://evil.com'],
    ['an absolute same-origin url', 'https://besidka.com/chats/abc'],
    ['a javascript url', 'javascript:alert(1)'],
    ['a relative path', 'chats/abc'],
    ['an empty string', ''],
    ['a tab after the slash', '/\t/evil.com'],
    ['a newline in the path', '/chats\n/abc'],
    ['a carriage return', '/\r/evil.com'],
    ['a space', '/chats /abc'],
    ['a null byte', '/chats\u0000abc'],
    ['a DEL character', '/chats\u007fabc'],
    ['a C1 control character', '/chats\u0085abc'],
    ['a unicode line separator', '/chats abc'],
  ])('rejects %s', (_label, target) => {
    expect(resolveInternalNavigationTarget(target, ORIGIN)).toBeNull()
  })

  it.each([undefined, null, 42, {}, ['/chats/abc']])(
    'rejects the non-string value %s',
    (target) => {
      expect(resolveInternalNavigationTarget(target, ORIGIN)).toBeNull()
    },
  )

  it('rejects an invalid origin instead of throwing', () => {
    expect(resolveInternalNavigationTarget('/chats/abc', 'not an origin'))
      .toBeNull()
  })
})
