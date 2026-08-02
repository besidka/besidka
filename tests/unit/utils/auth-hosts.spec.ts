import { describe, expect, it } from 'vitest'
import {
  getAllowedHosts,
  getRelyingPartyId,
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
        'https://besidka-preview.chernenko.workers.dev',
      )

      expect(rpId).toBe('besidka-preview.chernenko.workers.dev')
      expect(rpId).not.toBe('workers.dev')
    },
  )
})
