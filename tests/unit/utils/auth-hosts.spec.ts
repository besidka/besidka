import { describe, expect, it } from 'vitest'
import {
  getAllowedHosts,
  getRelyingPartyId,
  isSecureBaseUrl,
  parseAdditionalHosts,
} from '../../../server/utils/auth-hosts'

describe('getAllowedHosts', () => {
  it('returns an empty array when no base URL is configured', () => {
    expect(getAllowedHosts('')).toEqual([])
  })

  it('allows localhost and 127.0.0.1 with any port', () => {
    expect(getAllowedHosts('http://localhost:3000')).toEqual([
      'localhost:3000',
      'localhost:*',
      '127.0.0.1:*',
    ])
    expect(getAllowedHosts('http://127.0.0.1:8080')).toEqual([
      '127.0.0.1:8080',
      'localhost:*',
      '127.0.0.1:*',
    ])
  })

  it('adds the www-prefixed variant for a bare apex domain', () => {
    expect(getAllowedHosts('https://besidka.com')).toEqual([
      'besidka.com',
      'www.besidka.com',
    ])
  })

  it('adds the bare apex variant for a www-prefixed domain', () => {
    expect(getAllowedHosts('https://www.besidka.com')).toEqual([
      'www.besidka.com',
      'besidka.com',
    ])
  })

  it('adds a wildcard preview-deploy pattern for an arbitrary subdomain', () => {
    expect(getAllowedHosts('https://pr-123.besidka.com')).toEqual([
      'pr-123.besidka.com',
      '*-pr-123.besidka.com',
    ])
  })
})

function matchesHostPattern(host: string, pattern: string): boolean {
  const escapedPattern = pattern
    .split('*')
    .map(segment => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')

  return new RegExp(`^${escapedPattern}$`).test(host)
}

describe('getAllowedHosts additional hosts', () => {
  const previewBaseUrl = 'https://preview-besidka.chernenko.workers.dev'
  const additionalPattern = '*-besidka.chernenko.workers.dev'

  it('keeps the derived hosts unchanged when additional hosts are empty', () => {
    expect(getAllowedHosts(previewBaseUrl, '')).toEqual(
      getAllowedHosts(previewBaseUrl),
    )
    expect(getAllowedHosts(previewBaseUrl)).toEqual([
      'preview-besidka.chernenko.workers.dev',
      '*-preview-besidka.chernenko.workers.dev',
    ])
  })

  it('merges additional patterns after the derived hosts', () => {
    expect(getAllowedHosts(previewBaseUrl, additionalPattern)).toEqual([
      'preview-besidka.chernenko.workers.dev',
      '*-preview-besidka.chernenko.workers.dev',
      additionalPattern,
    ])
  })

  it('trims, drops empty entries and deduplicates additional hosts', () => {
    expect(getAllowedHosts(
      'https://besidka.com',
      ` extra.example.com , ,www.besidka.com,extra.example.com,`,
    )).toEqual([
      'besidka.com',
      'www.besidka.com',
      'extra.example.com',
    ])
  })

  it('does not allow any host when no base URL is configured', () => {
    expect(getAllowedHosts('', additionalPattern)).toEqual([])
  })

  it(
    'covers the named preview, PR previews and deployment-id previews '
    + 'with one wildcard pattern',
    () => {
      const allowedHosts = getAllowedHosts(previewBaseUrl, additionalPattern)
      const previewHosts = [
        'preview-besidka.chernenko.workers.dev',
        'pr-123-besidka.chernenko.workers.dev',
        '1a2b3c4d-besidka.chernenko.workers.dev',
      ]

      for (const previewHost of previewHosts) {
        expect(allowedHosts.some((pattern) => {
          return matchesHostPattern(previewHost, pattern)
        })).toBe(true)
      }
    },
  )

  it('does not cover unrelated workers.dev hosts', () => {
    const allowedHosts = getAllowedHosts(previewBaseUrl, additionalPattern)

    expect(allowedHosts.some((pattern) => {
      return matchesHostPattern('pr-123-other.chernenko.workers.dev', pattern)
    })).toBe(false)
  })
})

describe('parseAdditionalHosts', () => {
  it('returns an empty array for an empty value', () => {
    expect(parseAdditionalHosts('')).toEqual([])
    expect(parseAdditionalHosts(' , ')).toEqual([])
  })

  it('splits on commas, trims and deduplicates', () => {
    expect(parseAdditionalHosts('a.com, b.com ,a.com')).toEqual([
      'a.com',
      'b.com',
    ])
  })
})

describe('getRelyingPartyId', () => {
  it('returns localhost when no base URL is configured', () => {
    expect(getRelyingPartyId('')).toBe('localhost')
  })

  it('returns localhost for a localhost or 127.0.0.1 base URL', () => {
    expect(getRelyingPartyId('http://localhost:3000')).toBe('localhost')
    expect(getRelyingPartyId('http://127.0.0.1:8080')).toBe('localhost')
  })

  it('returns the bare apex domain for the apex host', () => {
    expect(getRelyingPartyId('https://besidka.com')).toBe('besidka.com')
  })

  it('returns the bare apex domain for the www-prefixed host', () => {
    expect(getRelyingPartyId('https://www.besidka.com')).toBe('besidka.com')
  })

  it('returns the full hostname for an arbitrary subdomain', () => {
    expect(getRelyingPartyId('https://pr-123.besidka.com'))
      .toBe('pr-123.besidka.com')
  })

  it(
    'returns the full hostname for a multi-label public-suffix host '
    + 'instead of collapsing to the bare public suffix',
    () => {
      const rpId = getRelyingPartyId(
        'https://preview-besidka.chernenko.workers.dev',
      )

      expect(rpId).toBe('preview-besidka.chernenko.workers.dev')
      expect(rpId).not.toBe('workers.dev')
    },
  )
})

describe('isSecureBaseUrl', () => {
  it('is true for https base URLs', () => {
    expect(isSecureBaseUrl('https://besidka.com')).toBe(true)
    expect(isSecureBaseUrl('https://x-pr-7.workers.dev')).toBe(true)
  })

  it('accepts a mixed-case scheme', () => {
    expect(isSecureBaseUrl('HTTPS://besidka.com')).toBe(true)
    expect(isSecureBaseUrl('Https://besidka.com')).toBe(true)
  })

  it('is false for an invalid URL', () => {
    expect(isSecureBaseUrl('besidka.com')).toBe(false)
    expect(isSecureBaseUrl('not a url')).toBe(false)
  })

  it('is false for http and empty base URLs', () => {
    expect(isSecureBaseUrl('http://localhost:3000')).toBe(false)
    expect(isSecureBaseUrl('')).toBe(false)
  })
})
