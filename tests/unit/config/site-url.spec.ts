import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SITE_URL,
  assertSecureSiteUrl,
  resolveSiteUrl,
} from '~~/config/site-url'

describe('resolveSiteUrl', () => {
  it('falls back to the apex host when NUXT_PUBLIC_BASE_URL is unset', () => {
    expect(resolveSiteUrl({})).toBe(DEFAULT_SITE_URL)
    expect(resolveSiteUrl({ NUXT_PUBLIC_BASE_URL: '' })).toBe(DEFAULT_SITE_URL)
  })

  it('uses NUXT_PUBLIC_BASE_URL without a trailing slash', () => {
    expect(resolveSiteUrl({ NUXT_PUBLIC_BASE_URL: 'https://example.com//' }))
      .toBe('https://example.com')
  })
})

describe('assertSecureSiteUrl', () => {
  it('accepts an https site URL', () => {
    expect(() => assertSecureSiteUrl('https://besidka.com')).not.toThrow()
  })

  it.each([
    'http://localhost:3000',
    'http://besidka.com',
    'localhost:3000',
    '',
  ])('rejects %j and names the fix', (siteUrl) => {
    expect(() => assertSecureSiteUrl(siteUrl))
      .toThrow(/NUXT_PUBLIC_BASE_URL/)
  })
})
