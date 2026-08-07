import { describe, expect, it } from 'vitest'
import { buildCanonicalUrl } from '../../../app/utils/canonical'

const ORIGIN = 'https://besidka.com'

describe('buildCanonicalUrl', () => {
  it('preserves the trailing slash on the root path', () => {
    const canonicalUrl = buildCanonicalUrl(ORIGIN, '/')

    expect(canonicalUrl).toBe('https://besidka.com/')
  })

  it('builds a canonical URL for a plain path', () => {
    const canonicalUrl = buildCanonicalUrl(ORIGIN, '/privacy')

    expect(canonicalUrl).toBe('https://besidka.com/privacy')
  })

  it(
    'strips a trailing slash on a non-root path so /privacy and '
    + '/privacy/ advertise one canonical instead of splitting into two',
    () => {
      const canonicalUrl = buildCanonicalUrl(ORIGIN, '/privacy/')

      expect(canonicalUrl).toBe('https://besidka.com/privacy')
    },
  )

  it('strips multiple trailing slashes down to one path', () => {
    const canonicalUrl = buildCanonicalUrl(ORIGIN, '/privacy///')

    expect(canonicalUrl).toBe('https://besidka.com/privacy')
  })

  it(
    'produces the same result whether the origin has a trailing slash '
    + 'or not, with no double slash after the scheme',
    () => {
      const canonicalUrlWithoutSlash = buildCanonicalUrl(ORIGIN, '/privacy')
      const canonicalUrlWithSlash = buildCanonicalUrl(
        'https://besidka.com/',
        '/privacy',
      )

      expect(canonicalUrlWithSlash).toBe(canonicalUrlWithoutSlash)

      const [, pathAfterScheme] = canonicalUrlWithSlash.split('://')

      expect(pathAfterScheme).not.toContain('//')
    },
  )

  it(
    'clears a query string and hash carried by the origin, so an '
    + 'origin like https://host/?ref=x#frag cannot leak tracking params '
    + 'into the canonical URL',
    () => {
      const canonicalUrl = buildCanonicalUrl(
        'https://besidka.com/?ref=x#frag',
        '/privacy',
      )

      expect(canonicalUrl).toBe('https://besidka.com/privacy')
    },
  )

  it(
    'keeps the origin host when the path itself contains ? or # — '
    + 'both real call sites only ever pass route.path (never containing '
    + 'a query or hash) or a literal asset path, so this is a safety '
    + 'net rather than a behaviour guarantee for that input shape',
    () => {
      const canonicalUrl = buildCanonicalUrl(
        ORIGIN,
        '/privacy?utm_source=x#top',
      )
      const canonicalUrlHost = new URL(canonicalUrl).host

      expect(canonicalUrlHost).toBe('besidka.com')
    },
  )

  it(
    'keeps the origin host even when the path begins with // — the '
    + 'two-argument new URL(path, origin) form would read that as a '
    + 'network-path reference and silently switch host to evil.com',
    () => {
      const canonicalUrl = buildCanonicalUrl(ORIGIN, '//evil.com/foo')
      const canonicalUrlHost = new URL(canonicalUrl).host

      expect(canonicalUrlHost).toBe('besidka.com')
    },
  )

  it('round-trips a deep path unchanged', () => {
    const path = '/shared/01KYFB1TAKRQNHJKAFR5MJR2WD'
    const canonicalUrl = buildCanonicalUrl(ORIGIN, path)

    expect(canonicalUrl).toBe(`https://besidka.com${path}`)
  })
})
