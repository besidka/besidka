import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authRateLimitDefaults,
  authRateLimitMaxWindow,
  authRateLimitRules,
  createAuthRateLimitStorage,
} from '../../../server/utils/auth-rate-limit'

function wildcardMatches(pattern: string, path: string): boolean {
  if (!pattern.includes('*')) {
    return pattern === path
  }

  const prefix = pattern.slice(0, pattern.indexOf('*'))

  return path !== pattern && path.startsWith(prefix)
}

function createFakeKV() {
  const store = new Map<string, string>()
  const putCalls: Array<{
    key: string
    value: string
    options?: { expirationTtl?: number }
  }> = []

  return {
    store,
    putCalls,
    async get(key: string) {
      return store.get(key) ?? null
    },
    async put(
      key: string,
      value: string,
      options?: { expirationTtl?: number },
    ) {
      store.set(key, value)
      putCalls.push({ key, value, options })
    },
    async delete(key: string) {
      store.delete(key)
    },
  }
}

describe('authRateLimitRules', () => {
  it('has only paths starting with a leading slash', () => {
    for (const key of Object.keys(authRateLimitRules)) {
      expect(key.startsWith('/')).toBe(true)
    }
  })

  it('orders every exact-path key before any wildcard key it could match', () => {
    const keys = Object.keys(authRateLimitRules)

    keys.forEach((wildcardKey, wildcardIndex) => {
      if (!wildcardKey.includes('*')) {
        return
      }

      keys.forEach((exactKey, exactIndex) => {
        if (exactKey.includes('*') || exactKey === wildcardKey) {
          return
        }

        if (wildcardMatches(wildcardKey, exactKey)) {
          expect(exactIndex).toBeLessThan(wildcardIndex)
        }
      })
    })
  })

  it('never has a window longer than authRateLimitMaxWindow', () => {
    for (const rule of Object.values(authRateLimitRules)) {
      expect(rule.window).toBeLessThanOrEqual(authRateLimitMaxWindow)
    }
  })

  it('computes a max window of 900 seconds', () => {
    expect(authRateLimitMaxWindow).toBe(900)
  })

  it('rate-limits /verify-password tighter than the generic default', () => {
    expect(authRateLimitRules['/verify-password']).toEqual({
      window: 300,
      max: 5,
    })
  })

  it('rate-limits get-totp-uri and send-otp as tightly as enable/disable', () => {
    expect(authRateLimitRules['/two-factor/get-totp-uri']).toEqual({
      window: 900,
      max: 5,
    })
    expect(authRateLimitRules['/two-factor/send-otp']).toEqual({
      window: 900,
      max: 5,
    })
    expect(authRateLimitRules['/two-factor/get-totp-uri']).toEqual(
      authRateLimitRules['/two-factor/enable'],
    )
  })

  it('covers parameterized sibling routes with wildcard rules', () => {
    expect(authRateLimitRules['/reset-password/*']).toEqual({
      window: 900,
      max: 10,
    })
    expect(authRateLimitRules['/delete-user/*']).toEqual({
      window: 900,
      max: 10,
    })
    expect(authRateLimitRules['/callback/*']).toEqual({
      window: 300,
      max: 30,
    })
  })
})

describe('authRateLimitDefaults', () => {
  it('falls back to a 60s/60req default rule', () => {
    expect(authRateLimitDefaults).toEqual({ window: 60, max: 60 })
  })
})

describe('createAuthRateLimitStorage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows exactly max requests within the window then denies', async () => {
    const kv = createFakeKV()
    const storage = createAuthRateLimitStorage(
      kv as any,
      'auth:rate-limit',
    )
    const rule = { window: 60, max: 3 }

    const first = await storage.consume('ip:/path', rule)
    const second = await storage.consume('ip:/path', rule)
    const third = await storage.consume('ip:/path', rule)
    const fourth = await storage.consume('ip:/path', rule)

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(third.allowed).toBe(true)
    expect(fourth.allowed).toBe(false)
    expect(fourth.retryAfter).toBeGreaterThan(0)
  })

  it('resets rather than compounding once the window has elapsed', async () => {
    const kv = createFakeKV()
    const storage = createAuthRateLimitStorage(
      kv as any,
      'auth:rate-limit',
    )
    const rule = { window: 60, max: 1 }

    const first = await storage.consume('ip:/path', rule)

    expect(first.allowed).toBe(true)

    const blocked = await storage.consume('ip:/path', rule)

    expect(blocked.allowed).toBe(false)

    vi.advanceTimersByTime(61_000)

    const afterWindow = await storage.consume('ip:/path', rule)

    expect(afterWindow.allowed).toBe(true)
  })

  it('never blocks steady calls spaced inside a long window', async () => {
    const kv = createFakeKV()
    const storage = createAuthRateLimitStorage(
      kv as any,
      'auth:rate-limit',
    )
    const rule = { window: 3600, max: 20 }
    const results: boolean[] = []

    for (let call = 0; call < 40; call++) {
      const result = await storage.consume('mcp:delete', rule)

      results.push(result.allowed)
      vi.advanceTimersByTime(50 * 60 * 1000)
    }

    expect(results.every(allowed => allowed)).toBe(true)
  })

  it('blocks the call after max within one window with the remaining time', async () => {
    const kv = createFakeKV()
    const storage = createAuthRateLimitStorage(
      kv as any,
      'auth:rate-limit',
    )
    const rule = { window: 3600, max: 20 }

    for (let call = 0; call < 20; call++) {
      const result = await storage.consume('mcp:delete', rule)

      expect(result.allowed).toBe(true)
      vi.advanceTimersByTime(60 * 1000)
    }

    const blocked = await storage.consume('mcp:delete', rule)

    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBe(2400)
  })

  it('opens a new window exactly when the old one ends', async () => {
    const kv = createFakeKV()
    const storage = createAuthRateLimitStorage(
      kv as any,
      'auth:rate-limit',
    )
    const rule = { window: 60, max: 2 }

    await storage.consume('ip:/path', rule)
    vi.advanceTimersByTime(30_000)
    await storage.consume('ip:/path', rule)

    const blocked = await storage.consume('ip:/path', rule)

    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBe(30)

    vi.advanceTimersByTime(30_000)

    const reopened = await storage.consume('ip:/path', rule)
    const stored = JSON.parse(kv.store.get('auth:rate-limit:ip:/path')!)

    expect(reopened.allowed).toBe(true)
    expect(stored.count).toBe(1)
    expect(stored.windowStart).toBe(Date.now())
  })

  it('keeps the window start fixed across increments', async () => {
    const kv = createFakeKV()
    const storage = createAuthRateLimitStorage(
      kv as any,
      'auth:rate-limit',
    )
    const rule = { window: 60, max: 5 }
    const startedAt = Date.now()

    await storage.consume('ip:/path', rule)
    vi.advanceTimersByTime(20_000)
    await storage.consume('ip:/path', rule)

    const stored = JSON.parse(kv.store.get('auth:rate-limit:ip:/path')!)

    expect(stored.windowStart).toBe(startedAt)
    expect(stored.lastRequest).toBe(startedAt + 20_000)
    expect(stored.count).toBe(2)
  })

  it('reads a legacy value without windowStart from lastRequest', async () => {
    const kv = createFakeKV()
    const storage = createAuthRateLimitStorage(
      kv as any,
      'auth:rate-limit',
    )
    const rule = { window: 60, max: 2 }

    kv.store.set(
      'auth:rate-limit:ip:/path',
      JSON.stringify({
        key: 'ip:/path',
        count: 2,
        lastRequest: Date.now() - 10_000,
      }),
    )

    const blocked = await storage.consume('ip:/path', rule)

    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBe(50)

    vi.advanceTimersByTime(50_000)

    const reopened = await storage.consume('ip:/path', rule)

    expect(reopened.allowed).toBe(true)
  })

  it('stores every value with a TTL of Math.max(60, authRateLimitMaxWindow)', async () => {
    const kv = createFakeKV()
    const storage = createAuthRateLimitStorage(
      kv as any,
      'auth:rate-limit',
    )

    await storage.consume('ip:/path', { window: 60, max: 5 })

    expect(kv.putCalls).toHaveLength(1)
    expect(kv.putCalls[0]?.options).toEqual({
      expirationTtl: Math.max(60, authRateLimitMaxWindow),
    })
  })

  it('namespaces every KV key under the given prefix', async () => {
    const kv = createFakeKV()
    const storage = createAuthRateLimitStorage(
      kv as any,
      'auth:rate-limit',
    )

    await storage.consume('ip:/sign-in/email', { window: 60, max: 5 })

    expect(kv.putCalls[0]?.key).toBe('auth:rate-limit:ip:/sign-in/email')
  })
})
