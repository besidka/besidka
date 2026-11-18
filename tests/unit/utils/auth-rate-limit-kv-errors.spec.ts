import { betterAuth } from 'better-auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KV_ERROR_RETRY_AFTER_SECONDS,
  authRateLimitRules,
  buildAuthRateLimitCustomRules,
  consumeMemoryRateLimit,
  createAuthRateLimitStorage,
  resetMemoryRateLimits,
} from '~~/server/utils/auth-rate-limit'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
}))

vi.mock('~~/server/utils/files/logger', () => ({
  resolveServerLogger: () => ({ set: mocks.loggerSet }),
}))

const KV_429_MESSAGE = 'KV PUT failed: 429 Too Many Requests'
const CLIENT_IP = '203.0.113.7'

function createKv(overrides: {
  get?: (key: string) => Promise<string | null>
  put?: (key: string, value: string) => Promise<void>
} = {}) {
  const store = new Map<string, string>()

  return {
    store,
    get: vi.fn(overrides.get ?? (async (key: string) => {
      return store.get(key) ?? null
    })),
    put: vi.fn(overrides.put ?? (async (key: string, value: string) => {
      store.set(key, value)
    })),
    delete: vi.fn(),
  }
}

function createRefusingKv() {
  return createKv({
    put: async () => {
      throw new Error(KV_429_MESSAGE)
    },
  })
}

function createDenyingStorage(kv: ReturnType<typeof createKv>) {
  return createAuthRateLimitStorage(kv as never, 'auth:rate-limit', {
    denyOnKvError: true,
  })
}

function createRateLimitedAuth(kv: ReturnType<typeof createKv>) {
  return betterAuth({
    secret: 'a-test-secret-that-is-long-enough-for-better-auth',
    baseURL: 'https://besidka.test',
    emailAndPassword: { enabled: true },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: buildAuthRateLimitCustomRules(),
      customStorage: createDenyingStorage(kv),
    },
  })
}

function authRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://besidka.test/api/auth${path}`, {
    ...init,
    headers: {
      'cf-connecting-ip': CLIENT_IP,
      'content-type': 'application/json',
      'origin': 'https://besidka.test',
    },
  })
}

describe('createAuthRateLimitStorage with denyOnKvError', () => {
  beforeEach(() => {
    mocks.loggerSet.mockClear()
  })

  it('refuses with a one-second retry and logs when KV refuses the write',
    async () => {
      const storage = createDenyingStorage(createRefusingKv())

      await expect(storage.consume(`${CLIENT_IP}|/sign-in/email`, {
        window: 300,
        max: 10,
      })).resolves.toEqual({
        allowed: false,
        retryAfter: KV_ERROR_RETRY_AFTER_SECONDS,
      })
      expect(mocks.loggerSet).toHaveBeenCalledWith({
        attributes: {
          rateLimit: {
            keyPrefix: 'auth:rate-limit',
            kvReadFailed: false,
            kvWriteFailed: true,
            denied: true,
            error: KV_429_MESSAGE,
          },
        },
      })
    })

  it('never logs the bucket key, which holds the client IP', async () => {
    const storage = createDenyingStorage(createRefusingKv())

    await storage.consume(`${CLIENT_IP}|/sign-in/email`, {
      window: 300,
      max: 10,
    })

    expect(JSON.stringify(mocks.loggerSet.mock.calls)).not.toContain(CLIENT_IP)
  })

  it('refuses when KV cannot be read', async () => {
    const kv = createKv({
      get: async () => {
        throw new Error('KV GET failed: 503')
      },
    })

    await expect(createDenyingStorage(kv).consume('client|/verify-password', {
      window: 300,
      max: 5,
    })).resolves.toMatchObject({ allowed: false })
    expect(kv.put).not.toHaveBeenCalled()
    expect(mocks.loggerSet).toHaveBeenCalledWith({
      attributes: {
        rateLimit: expect.objectContaining({ kvReadFailed: true }),
      },
    })
  })

  it('keeps counting in KV when writes succeed', async () => {
    const storage = createDenyingStorage(createKv())
    const rule = { window: 60, max: 2 }

    await storage.consume('client|/list-sessions', rule)
    await storage.consume('client|/list-sessions', rule)

    await expect(storage.consume('client|/list-sessions', rule))
      .resolves.toMatchObject({ allowed: false })
    expect(mocks.loggerSet).not.toHaveBeenCalled()
  })
})

describe('createAuthRateLimitStorage without denyOnKvError', () => {
  it('lets a KV write error reach the caller', async () => {
    const storage = createAuthRateLimitStorage(
      createRefusingKv() as never,
      'bridge',
    )

    await expect(storage.consume('7', { window: 60, max: 10 }))
      .rejects.toThrow(KV_429_MESSAGE)
  })
})

describe('Better Auth with KV refusing rate-limit writes', () => {
  beforeEach(() => {
    mocks.loggerSet.mockClear()
  })

  it.each([
    ['/sign-in/email', { email: 'person@example.com', password: 'guess' }],
    ['/sign-up/email', {
      email: 'person@example.com',
      password: 'a-long-password',
      name: 'Person',
    }],
    ['/request-password-reset', { email: 'person@example.com' }],
    ['/two-factor/verify-totp', { code: '123456' }],
  ])('answers 429 on %s instead of 500 or letting it through',
    async (path, body) => {
      const auth = createRateLimitedAuth(createRefusingKv())
      const response = await auth.handler(authRequest(path, {
        method: 'POST',
        body: JSON.stringify(body),
      }))

      expect(response.status).toBe(429)
      expect(response.headers.get('X-Retry-After'))
        .toBe(String(KV_ERROR_RETRY_AFTER_SECONDS))
    })

  it('never counts /get-session, so it never writes KV', async () => {
    const kv = createRefusingKv()
    const auth = createRateLimitedAuth(kv)
    const response = await auth.handler(authRequest('/get-session'))

    expect(response.status).toBe(200)
    expect(kv.get).not.toHaveBeenCalled()
    expect(kv.put).not.toHaveBeenCalled()
  })

  it.each([
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/openid-configuration',
  ])('never counts the discovery document %s', async (path) => {
    const kv = createRefusingKv()
    const auth = createRateLimitedAuth(kv)

    await auth.handler(new Request(`https://besidka.test${path}`, {
      headers: { 'cf-connecting-ip': CLIENT_IP },
    }))

    expect(kv.get).not.toHaveBeenCalled()
    expect(kv.put).not.toHaveBeenCalled()
  })
})

describe('buildAuthRateLimitCustomRules', () => {
  it('exempts /get-session and keeps every limited path', () => {
    const rules = buildAuthRateLimitCustomRules()

    expect(rules['/get-session']).toBe(false)

    for (const [path, rule] of Object.entries(authRateLimitRules)) {
      expect(rules[path]).toEqual(rule)
    }
  })

  it('exempts only /get-session and the public discovery documents', () => {
    const exempt = Object.entries(buildAuthRateLimitCustomRules())
      .filter(([, rule]) => rule === false)
      .map(([path]) => path)

    expect(exempt).toEqual(['/get-session', '/.well-known/**'])
  })

  it('exempts no limited path', () => {
    const limitedPaths = Object.keys(authRateLimitRules)

    expect(limitedPaths.some((path) => {
      return path === '/get-session' || path.startsWith('/.well-known/')
    })).toBe(false)
  })
})

describe('consumeMemoryRateLimit', () => {
  beforeEach(() => {
    resetMemoryRateLimits()
  })

  it('denies past max within the window and allows again after it', () => {
    const rule = { window: 60, max: 2 }
    const start = 1_000_000

    expect(consumeMemoryRateLimit('bucket', rule, start).allowed).toBe(true)
    expect(consumeMemoryRateLimit('bucket', rule, start + 1).allowed)
      .toBe(true)
    expect(consumeMemoryRateLimit('bucket', rule, start + 2)).toEqual({
      allowed: false,
      retryAfter: 60,
    })
    expect(consumeMemoryRateLimit('bucket', rule, start + 60_000).allowed)
      .toBe(true)
  })

  it('keeps buckets independent', () => {
    const rule = { window: 60, max: 1 }

    expect(consumeMemoryRateLimit('first', rule).allowed).toBe(true)
    expect(consumeMemoryRateLimit('second', rule).allowed).toBe(true)
    expect(consumeMemoryRateLimit('first', rule).allowed).toBe(false)
  })
})
