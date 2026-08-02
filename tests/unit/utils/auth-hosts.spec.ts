import { describe, expect, it } from 'vitest'
import { getAllowedHosts } from '../../../server/utils/auth-hosts'

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
