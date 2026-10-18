import { describe, expect, it } from 'vitest'
import {
  UTM_QUERY_KEYS,
  appendUtmToPath,
  extractUtmFromUrl,
  hasUtmParams,
  sanitizeUtmParams,
  sanitizeUtmValue,
} from '../../../shared/utils/utm'

describe('UTM_QUERY_KEYS', () => {
  it('lists exactly the four supported utm keys', () => {
    expect(UTM_QUERY_KEYS).toEqual([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
    ])
  })
})

describe('sanitizeUtmValue', () => {
  it('keeps valid values', () => {
    expect(sanitizeUtmValue('reddit')).toBe('reddit')
    expect(sanitizeUtmValue('launch_2026-10.v2')).toBe('launch_2026-10.v2')
    expect(sanitizeUtmValue('a')).toBe('a')
  })

  it('lowercases and trims', () => {
    expect(sanitizeUtmValue('  Reddit  ')).toBe('reddit')
    expect(sanitizeUtmValue('NEWSLETTER')).toBe('newsletter')
  })

  it('drops values with invalid characters instead of stripping them', () => {
    expect(sanitizeUtmValue('red dit')).toBeUndefined()
    expect(sanitizeUtmValue('reddit!')).toBeUndefined()
    expect(sanitizeUtmValue('<script>')).toBeUndefined()
    expect(sanitizeUtmValue('a/b')).toBeUndefined()
    expect(sanitizeUtmValue('ünïcode')).toBeUndefined()
    expect(sanitizeUtmValue('user@example.com')).toBeUndefined()
  })

  it('accepts 64 characters and drops anything longer', () => {
    expect(sanitizeUtmValue('a'.repeat(64))).toBe('a'.repeat(64))
    expect(sanitizeUtmValue('a'.repeat(65))).toBeUndefined()
    expect(sanitizeUtmValue(` ${'a'.repeat(64)} `)).toBe('a'.repeat(64))
  })

  it('drops empty and whitespace-only values', () => {
    expect(sanitizeUtmValue('')).toBeUndefined()
    expect(sanitizeUtmValue('   ')).toBeUndefined()
  })

  it('uses the first element of an array', () => {
    expect(sanitizeUtmValue(['Twitter', 'reddit'])).toBe('twitter')
    expect(sanitizeUtmValue(['bad value', 'reddit'])).toBeUndefined()
    expect(sanitizeUtmValue([])).toBeUndefined()
  })

  it('drops non-string values', () => {
    expect(sanitizeUtmValue(undefined)).toBeUndefined()
    expect(sanitizeUtmValue(null)).toBeUndefined()
    expect(sanitizeUtmValue(42)).toBeUndefined()
    expect(sanitizeUtmValue({ value: 'reddit' })).toBeUndefined()
    expect(sanitizeUtmValue([42])).toBeUndefined()
  })
})

describe('sanitizeUtmParams', () => {
  it('reads utm keys from URLSearchParams', () => {
    const params = new URLSearchParams(
      'utm_source=Reddit&utm_medium=social&utm_campaign=launch'
      + '&utm_content=hero',
    )

    expect(sanitizeUtmParams(params)).toEqual({
      source: 'reddit',
      medium: 'social',
      campaign: 'launch',
      content: 'hero',
    })
  })

  it('reads utm keys from a record, including array values', () => {
    expect(sanitizeUtmParams({
      utm_source: ['twitter', 'reddit'],
      utm_medium: 'Social',
    })).toEqual({
      source: 'twitter',
      medium: 'social',
    })
  })

  it('ignores unknown keys', () => {
    expect(sanitizeUtmParams({
      utm_term: 'keyword',
      utm_id: '123',
      source: 'reddit',
      gclid: 'abc',
    })).toEqual({})
  })

  it('omits invalid values and keeps the valid ones', () => {
    expect(sanitizeUtmParams({
      utm_source: 'reddit',
      utm_medium: 'bad value',
      utm_campaign: 'a'.repeat(65),
    })).toEqual({ source: 'reddit' })
  })

  it('returns an empty object for missing input', () => {
    expect(sanitizeUtmParams(null)).toEqual({})
    expect(sanitizeUtmParams(undefined)).toEqual({})
    expect(sanitizeUtmParams(new URLSearchParams())).toEqual({})
  })
})

describe('hasUtmParams', () => {
  it('is true when any utm field is set', () => {
    expect(hasUtmParams({ source: 'reddit' })).toBe(true)
    expect(hasUtmParams({ content: 'hero' })).toBe(true)
  })

  it('is false for empty or missing values', () => {
    expect(hasUtmParams({})).toBe(false)
    expect(hasUtmParams(null)).toBe(false)
    expect(hasUtmParams(undefined)).toBe(false)
    expect(hasUtmParams({ source: '' })).toBe(false)
  })
})

describe('extractUtmFromUrl', () => {
  it('reads utm from a relative url', () => {
    expect(extractUtmFromUrl(
      '/chats/new?utm_source=reddit&utm_campaign=Launch',
    )).toEqual({
      source: 'reddit',
      campaign: 'launch',
    })
  })

  it('reads utm from an absolute url', () => {
    expect(extractUtmFromUrl(
      'https://besidka.com/signin?utm_medium=email#top',
    )).toEqual({ medium: 'email' })
  })

  it('unwraps a nested callbackURL from the oauth proxy', () => {
    const original = '/chats/new?utm_source=reddit&utm_medium=social'
    const wrapped = 'https://pr-1.besidka.workers.dev/api/auth/callback/'
      + `github/oauth-proxy?callbackURL=${encodeURIComponent(original)}`

    expect(extractUtmFromUrl(wrapped)).toEqual({
      source: 'reddit',
      medium: 'social',
    })
  })

  it('unwraps an absolute nested callbackURL', () => {
    const original = 'https://pr-1.besidka.workers.dev/chats/new'
      + '?utm_campaign=launch'
    const wrapped = '/api/auth/callback/google/oauth-proxy?callbackURL='
      + encodeURIComponent(original)

    expect(extractUtmFromUrl(wrapped)).toEqual({ campaign: 'launch' })
  })

  it('prefers the outer utm over a nested callbackURL', () => {
    const nested = encodeURIComponent('/chats/new?utm_source=nested')

    expect(extractUtmFromUrl(
      `/x?utm_source=outer&callbackURL=${nested}`,
    )).toEqual({ source: 'outer' })
  })

  it('unwraps only one level', () => {
    const inner = encodeURIComponent('/chats/new?utm_source=deep')
    const middle = encodeURIComponent(`/middle?callbackURL=${inner}`)

    expect(extractUtmFromUrl(`/outer?callbackURL=${middle}`)).toEqual({})
  })

  it('returns an empty object when no utm is present', () => {
    expect(extractUtmFromUrl('/chats/new')).toEqual({})
    expect(extractUtmFromUrl('/chats/new?callbackURL=%2Fsignin')).toEqual({})
  })

  it('never throws on garbage input', () => {
    const garbage: unknown[] = [
      null,
      undefined,
      '',
      'http://',
      'http://[::1',
      '%%%',
      '?utm_source=%E0%A4%A',
      '/x?callbackURL=http%3A%2F%2F%5B%3A%3A1',
      'javascript:alert(1)',
      42,
      {},
    ]

    for (const value of garbage) {
      expect(() => {
        return extractUtmFromUrl(value as string)
      }).not.toThrow()
    }

    expect(extractUtmFromUrl('http://[::1')).toEqual({})
    expect(extractUtmFromUrl(
      '/x?callbackURL=http%3A%2F%2F%5B%3A%3A1',
    )).toEqual({})
  })
})

describe('appendUtmToPath', () => {
  it('returns the path unchanged when there is no utm', () => {
    expect(appendUtmToPath('/signin', {})).toBe('/signin')
    expect(appendUtmToPath('/signin', null)).toBe('/signin')
    expect(appendUtmToPath('/signin?x=1#h', undefined)).toBe('/signin?x=1#h')
  })

  it('appends utm keys in a stable order', () => {
    expect(appendUtmToPath('/signin', {
      content: 'hero',
      source: 'reddit',
      campaign: 'launch',
      medium: 'social',
    })).toBe(
      '/signin?utm_source=reddit&utm_medium=social&utm_campaign=launch'
      + '&utm_content=hero',
    )
  })

  it('preserves an existing query and hash', () => {
    expect(appendUtmToPath('/chats/new?model=gpt#composer', {
      source: 'reddit',
    })).toBe('/chats/new?model=gpt&utm_source=reddit#composer')
  })

  it('overwrites existing utm keys instead of duplicating them', () => {
    expect(appendUtmToPath('/signup?utm_source=old', {
      source: 'reddit',
    })).toBe('/signup?utm_source=reddit')
  })

  it('skips values that do not pass sanitization', () => {
    expect(appendUtmToPath('/signup', {
      source: 'Reddit',
      medium: 'bad value',
    })).toBe('/signup?utm_source=reddit')
  })

  it('keeps absolute urls absolute', () => {
    expect(appendUtmToPath('https://besidka.com/signin', {
      source: 'reddit',
    })).toBe('https://besidka.com/signin?utm_source=reddit')
  })

  it('round-trips through extractUtmFromUrl', () => {
    const utm = { source: 'reddit', medium: 'social', campaign: 'launch' }

    expect(extractUtmFromUrl(appendUtmToPath('/signin', utm))).toEqual(utm)
  })
})
