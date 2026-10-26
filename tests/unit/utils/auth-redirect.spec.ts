import { describe, expect, it } from 'vitest'
import {
  appendNextToPath,
  resolveSafeNextPath,
} from '../../../shared/utils/auth-redirect'

describe('resolveSafeNextPath', () => {
  it.each([
    ['/profile/keys', '/profile/keys'],
    ['/profile/keys?provider=google', '/profile/keys?provider=google'],
    ['/profile/keys?tab=search', '/profile/keys?tab=search'],
    [
      '/profile/keys?provider=google&tab=providers',
      '/profile/keys?provider=google&tab=providers',
    ],
    ['/chats/new', '/chats/new'],
  ])('accepts %s', (input, expected) => {
    expect(resolveSafeNextPath(input)).toBe(expected)
  })

  it('strips query keys other than provider and tab', () => {
    expect(resolveSafeNextPath('/profile/keys?provider=google&x=1'))
      .toBe('/profile/keys?provider=google')
  })

  it('strips an unknown provider but keeps the path', () => {
    expect(resolveSafeNextPath('/profile/keys?provider=evil'))
      .toBe('/profile/keys')
  })

  it.each([
    ['openrouter'],
    ['vercel'],
    ['cloudflare'],
    ['brave'],
    ['exa'],
  ])('keeps the %s gateway or search provider id', (providerId) => {
    expect(resolveSafeNextPath(`/profile/keys?provider=${providerId}`))
      .toBe(`/profile/keys?provider=${providerId}`)
  })

  it('keeps a gateway provider alongside the gateways tab', () => {
    expect(
      resolveSafeNextPath('/profile/keys?provider=openrouter&tab=gateways'),
    ).toBe('/profile/keys?provider=openrouter&tab=gateways')
  })

  it('keeps the TypeSafe AI memory-check id, the guide sign-up deep link',
    () => {
      expect(resolveSafeNextPath('/profile/keys?provider=typesafe'))
        .toBe('/profile/keys?provider=typesafe')
    })

  it('keeps the memory checks tab', () => {
    expect(
      resolveSafeNextPath('/profile/keys?provider=typesafe&tab=memory-checks'),
    ).toBe('/profile/keys?provider=typesafe&tab=memory-checks')
  })

  it('strips a provider id that only looks like a gateway', () => {
    expect(resolveSafeNextPath('/profile/keys?provider=openrouter-evil'))
      .toBe('/profile/keys')
    expect(resolveSafeNextPath('/profile/keys?provider=Vercel'))
      .toBe('/profile/keys')
  })

  it('strips an unknown tab', () => {
    expect(resolveSafeNextPath('/profile/keys?tab=admin&provider=openai'))
      .toBe('/profile/keys?provider=openai')
  })

  it('does not treat inherited object keys as providers', () => {
    expect(resolveSafeNextPath('/profile/keys?provider=constructor'))
      .toBe('/profile/keys')
    expect(resolveSafeNextPath('/profile/keys?provider=__proto__'))
      .toBe('/profile/keys')
  })

  it('drops the query and hash from /chats/new', () => {
    expect(resolveSafeNextPath('/chats/new?q=1#top')).toBe('/chats/new')
  })

  it('drops the hash from /profile/keys', () => {
    expect(resolveSafeNextPath('/profile/keys?provider=google#x'))
      .toBe('/profile/keys?provider=google')
  })

  it('uses the first value when the query param repeats', () => {
    expect(resolveSafeNextPath(['/profile/keys', '//evil.com']))
      .toBe('/profile/keys')
    expect(resolveSafeNextPath(['//evil.com', '/profile/keys'])).toBeNull()
  })

  it.each([
    ['//evil.com'],
    ['//evil.com/profile/keys'],
    ['/\\evil.com'],
    ['\\\\evil.com'],
    ['/profile/keys\\..\\evil'],
    ['https://evil.com'],
    ['https://besidka.com/profile/keys'],
    ['http://localhost/profile/keys'],
    ['javascript:alert(1)'],
    ['data:text/html,x'],
    ['profile/keys'],
    ['evil.com'],
    ['/chats/123'],
    ['/chats'],
    ['/signin'],
    ['/signin?next=/profile/keys'],
    ['/signup'],
    ['/profile/keys/'],
    ['/profile/keys/extra'],
    ['/profile'],
    ['/PROFILE/keys'],
    ['/profile/keys/../../evil'],
    ['/profile/keys/../../chats/123'],
    ['/profile/keys%2f..%2fevil'],
    ['/%2Fevil.com'],
    ['/profile/keys\n'],
    ['/profile/keys\r\n/evil'],
    ['/profile/\tkeys'],
    ['/profile/keys\u0000'],
    ['/profile/keys\u007f'],
    [' /profile/keys'],
    [''],
  ])('rejects %j', (input) => {
    expect(resolveSafeNextPath(input)).toBeNull()
  })

  it('rejects an overlong value', () => {
    const overlong = `/profile/keys?provider=google&${'a'.repeat(300)}=1`

    expect(resolveSafeNextPath(overlong)).toBeNull()
  })

  it.each([
    [undefined],
    [null],
    [42],
    [true],
    [{}],
    [[]],
    [['']],
  ])('rejects non-string value %j', (input) => {
    expect(resolveSafeNextPath(input)).toBeNull()
  })
})

describe('appendNextToPath', () => {
  it('returns the path unchanged without a next value', () => {
    expect(appendNextToPath('/signin', null)).toBe('/signin')
    expect(appendNextToPath('/signin', undefined)).toBe('/signin')
    expect(appendNextToPath('/signin', '')).toBe('/signin')
  })

  it('encodes the next value into a single query parameter', () => {
    const path = appendNextToPath('/signup', '/profile/keys?provider=google')
    const parsed = new URL(path, 'http://localhost')

    expect(parsed.pathname).toBe('/signup')
    expect(parsed.searchParams.get('next'))
      .toBe('/profile/keys?provider=google')
    expect(parsed.searchParams.has('provider')).toBe(false)
  })

  it('round-trips through the safe-path resolver', () => {
    const path = appendNextToPath('/signin', '/profile/keys?provider=google')
    const next = new URL(path, 'http://localhost').searchParams.get('next')

    expect(resolveSafeNextPath(next)).toBe('/profile/keys?provider=google')
  })
})
