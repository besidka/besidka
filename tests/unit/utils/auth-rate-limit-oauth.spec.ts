import { describe, expect, it } from 'vitest'
import {
  authRateLimitMaxWindow,
  authRateLimitRules,
} from '../../../server/utils/auth-rate-limit'

const ANTHROPIC_SHARED_EGRESS_USERS_PER_MINUTE = 50

describe('OAuth authorization server rate limits', () => {
  it.each([
    ['/oauth2/register', 60, 60],
    ['/oauth2/token', 60, 300],
    ['/oauth2/authorize', 60, 60],
    ['/oauth2/consent', 60, 20],
    ['/oauth2/revoke', 60, 120],
    ['/oauth2/introspect', 60, 120],
  ])('defines %s as %is / %i', (path, window, max) => {
    expect(authRateLimitRules[path]).toEqual({ window, max })
  })

  it('lets many users behind one shared egress IP register and refresh',
    () => {
      expect(authRateLimitRules['/oauth2/register']!.max)
        .toBeGreaterThanOrEqual(ANTHROPIC_SHARED_EGRESS_USERS_PER_MINUTE)
      expect(authRateLimitRules['/oauth2/token']!.max)
        .toBeGreaterThanOrEqual(ANTHROPIC_SHARED_EGRESS_USERS_PER_MINUTE * 2)
    })

  it('keeps the OAuth rows inside the KV TTL window', () => {
    for (const [path, rule] of Object.entries(authRateLimitRules)) {
      if (path.startsWith('/oauth2/')) {
        expect(rule.window).toBeLessThanOrEqual(authRateLimitMaxWindow)
      }
    }
  })

  it('has no wildcard row that could shadow an OAuth path', () => {
    const wildcardKeys = Object.keys(authRateLimitRules).filter((key) => {
      return key.includes('*')
    })

    for (const key of wildcardKeys) {
      expect('/oauth2/token'.startsWith(key.slice(0, key.indexOf('*'))))
        .toBe(false)
    }
  })
})
