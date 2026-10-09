import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRequestHeader: vi.fn<
    (event: unknown, name: string) => string | undefined
  >(),
  loggerSet: vi.fn(),
  env: {} as Record<string, unknown>,
}))

vi.mock('evlog', () => ({
  createError: (input: {
    message: string
    status?: number
    why?: string
    fix?: string
  }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('nuxt/server', () => ({
  getRequestHeader: mocks.getRequestHeader,
}))

vi.mock('cloudflare:workers', () => ({
  env: mocks.env,
}))

function createEvent() {
  const headers = new Headers()

  return { event: { res: { headers } } as never, headers }
}

function createLimiter(success: boolean) {
  return { limit: vi.fn(async () => ({ success })) }
}

const logger = { set: mocks.loggerSet } as never

async function importLimiter() {
  return import('../../../server/utils/consents-rate-limit')
}

describe('resolveRateLimitKey', () => {
  it('keys an IPv4 address as-is', async () => {
    const { resolveRateLimitKey } = await importLimiter()

    expect(resolveRateLimitKey('203.0.113.7')).toBe('203.0.113.7')
  })

  it('collapses an IPv6 address to its /64 prefix', async () => {
    const { resolveRateLimitKey } = await importLimiter()

    expect(resolveRateLimitKey('2001:db8:abcd:12:1:2:3:4'))
      .toBe('2001:db8:abcd:12::/64')
  })

  it('gives every address in one /64 the same key', async () => {
    const { resolveRateLimitKey } = await importLimiter()

    expect(resolveRateLimitKey('2001:db8:abcd:12::1'))
      .toBe(resolveRateLimitKey('2001:0db8:ABCD:0012:ffff:ffff:ffff:ffff'))
  })

  it('separates different /64 prefixes', async () => {
    const { resolveRateLimitKey } = await importLimiter()

    expect(resolveRateLimitKey('2001:db8:abcd:12::1'))
      .not.toBe(resolveRateLimitKey('2001:db8:abcd:13::1'))
  })

  it('expands a leading compression', async () => {
    const { resolveRateLimitKey } = await importLimiter()

    expect(resolveRateLimitKey('::1')).toBe('0:0:0:0::/64')
  })

  it('keys an IPv4-mapped IPv6 address by the IPv4 address', async () => {
    const { resolveRateLimitKey } = await importLimiter()

    expect(resolveRateLimitKey('::ffff:203.0.113.7')).toBe('203.0.113.7')
  })

  it('strips brackets and zone ids', async () => {
    const { resolveRateLimitKey } = await importLimiter()

    expect(resolveRateLimitKey('[2001:db8:1:2::9]'))
      .toBe('2001:db8:1:2::/64')
    expect(resolveRateLimitKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
  })

  it('keys an unparseable value verbatim, truncated', async () => {
    const { resolveRateLimitKey } = await importLimiter()

    expect(resolveRateLimitKey('zz::zz::zz')).toBe('zz::zz::zz')
    expect(resolveRateLimitKey(`1:${'a'.repeat(200)}`).length).toBe(64)
  })
})

describe('enforceConsentsRateLimit', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mocks.env.CONSENTS_RATE_LIMITER = undefined

    mocks.getRequestHeader.mockImplementation((_event, name) => {
      return name === 'cf-connecting-ip' ? '203.0.113.7' : undefined
    })
  })

  it('lets a request through when the binding allows it', async () => {
    const limiter = createLimiter(true)

    mocks.env.CONSENTS_RATE_LIMITER = limiter

    const { enforceConsentsRateLimit } = await importLimiter()
    const { event } = createEvent()

    await expect(enforceConsentsRateLimit(event, logger))
      .resolves
      .toBeUndefined()

    expect(limiter.limit).toHaveBeenCalledWith({ key: '203.0.113.7' })
  })

  it('keys an IPv6 client by its /64 prefix', async () => {
    const limiter = createLimiter(true)

    mocks.env.CONSENTS_RATE_LIMITER = limiter
    mocks.getRequestHeader.mockImplementation((_event, name) => {
      return name === 'cf-connecting-ip'
        ? '2001:db8:abcd:12:aaaa:bbbb:cccc:dddd'
        : undefined
    })

    const { enforceConsentsRateLimit } = await importLimiter()
    const { event } = createEvent()

    await enforceConsentsRateLimit(event, logger)

    expect(limiter.limit).toHaveBeenCalledWith({
      key: '2001:db8:abcd:12::/64',
    })
  })

  it('returns 429 with Retry-After when the binding refuses', async () => {
    mocks.env.CONSENTS_RATE_LIMITER = createLimiter(false)

    const { enforceConsentsRateLimit } = await importLimiter()
    const { event, headers } = createEvent()

    await expect(enforceConsentsRateLimit(event, logger))
      .rejects
      .toMatchObject({
        status: 429,
        why: expect.any(String),
        fix: expect.any(String),
      })

    expect(headers.get('Retry-After')).toBe('60')
  })

  it('degrades open and logs when there is no client IP', async () => {
    const limiter = createLimiter(false)

    mocks.env.CONSENTS_RATE_LIMITER = limiter
    mocks.getRequestHeader.mockReturnValue(undefined)

    const { enforceConsentsRateLimit } = await importLimiter()
    const { event } = createEvent()

    await expect(enforceConsentsRateLimit(event, logger))
      .resolves
      .toBeUndefined()

    expect(limiter.limit).not.toHaveBeenCalled()
    expect(mocks.loggerSet).toHaveBeenCalledWith({
      consentRateLimit: { skipped: 'no-client-ip' },
    })
  })

  it('degrades open and logs when the binding is absent', async () => {
    const { enforceConsentsRateLimit } = await importLimiter()
    const { event } = createEvent()

    await expect(enforceConsentsRateLimit(event, logger))
      .resolves
      .toBeUndefined()

    expect(mocks.loggerSet).toHaveBeenCalledWith({
      consentRateLimit: { skipped: 'binding-unavailable' },
    })
  })

  it('degrades open and logs the error under attributes when the binding throws', async () => {
    mocks.env.CONSENTS_RATE_LIMITER = {
      limit: async () => {
        throw new Error('limiter unavailable')
      },
    }

    const { enforceConsentsRateLimit } = await importLimiter()
    const { event } = createEvent()

    await expect(enforceConsentsRateLimit(event, logger))
      .resolves
      .toBeUndefined()

    expect(mocks.loggerSet).toHaveBeenCalledWith({
      consentRateLimit: { skipped: 'limiter-error' },
      attributes: {
        consentRateLimit: { error: 'limiter unavailable' },
      },
    })
  })
})
