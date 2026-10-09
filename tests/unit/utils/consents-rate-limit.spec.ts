import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exceptionMessage } from '../../../server/utils/evlog-attributes'

const mocks = vi.hoisted(() => ({
  getRequestHeader: vi.fn<
    (event: unknown, name: string) => string | undefined
  >(),
  loggerSet: vi.fn(),
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

function createFakeKv() {
  const store = new Map<string, string>()

  return {
    async get(key: string) {
      return store.get(key) ?? null
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
    store,
  }
}

function createEvent() {
  const headers = new Headers()

  return { event: { res: { headers } } as never, headers }
}

const logger = { set: mocks.loggerSet } as never

async function importLimiter() {
  return import('../../../server/utils/consents-rate-limit')
}

describe('enforceConsentsRateLimit', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T12:00:10.000Z'))
    vi.stubGlobal('exceptionMessage', exceptionMessage)
    vi.stubGlobal('useKV', () => createFakeKv())
    mocks.getRequestHeader.mockImplementation((_event, name) => {
      return name === 'cf-connecting-ip' ? '203.0.113.7' : undefined
    })
  })

  it('allows requests up to the limit and then returns 429', async () => {
    const fakeKv = createFakeKv()

    vi.stubGlobal('useKV', () => fakeKv)

    const { enforceConsentsRateLimit, consentsRateLimitRule }
      = await importLimiter()
    const { event } = createEvent()

    for (let attempt = 0; attempt < consentsRateLimitRule.max; attempt += 1) {
      await expect(enforceConsentsRateLimit(event, logger))
        .resolves
        .toBeUndefined()
    }

    await expect(enforceConsentsRateLimit(event, logger))
      .rejects
      .toMatchObject({
        status: 429,
        why: expect.any(String),
        fix: expect.any(String),
      })
  })

  it('sets Retry-After to the seconds left in the current window', async () => {
    const fakeKv = createFakeKv()

    vi.stubGlobal('useKV', () => fakeKv)

    const { enforceConsentsRateLimit, consentsRateLimitRule }
      = await importLimiter()
    const { event, headers } = createEvent()

    for (let attempt = 0; attempt < consentsRateLimitRule.max; attempt += 1) {
      await enforceConsentsRateLimit(event, logger)
    }

    await expect(enforceConsentsRateLimit(event, logger)).rejects.toBeTruthy()

    expect(headers.get('Retry-After')).toBe('50')
  })

  it('starts a fresh window once the minute rolls over', async () => {
    const fakeKv = createFakeKv()

    vi.stubGlobal('useKV', () => fakeKv)

    const { enforceConsentsRateLimit, consentsRateLimitRule }
      = await importLimiter()
    const { event } = createEvent()

    for (let attempt = 0; attempt < consentsRateLimitRule.max; attempt += 1) {
      await enforceConsentsRateLimit(event, logger)
    }

    await expect(enforceConsentsRateLimit(event, logger)).rejects.toBeTruthy()

    vi.setSystemTime(new Date('2026-10-09T12:01:00.000Z'))

    await expect(enforceConsentsRateLimit(event, logger))
      .resolves
      .toBeUndefined()
  })

  it('keeps separate counters per client IP', async () => {
    const fakeKv = createFakeKv()

    vi.stubGlobal('useKV', () => fakeKv)

    const { enforceConsentsRateLimit, consentsRateLimitRule }
      = await importLimiter()
    const { event } = createEvent()

    for (let attempt = 0; attempt < consentsRateLimitRule.max; attempt += 1) {
      await enforceConsentsRateLimit(event, logger)
    }

    mocks.getRequestHeader.mockImplementation((_event, name) => {
      return name === 'cf-connecting-ip' ? '198.51.100.9' : undefined
    })

    await expect(enforceConsentsRateLimit(event, logger))
      .resolves
      .toBeUndefined()
  })

  it('degrades open and logs when there is no client IP', async () => {
    mocks.getRequestHeader.mockReturnValue(undefined)

    const { enforceConsentsRateLimit } = await importLimiter()
    const { event } = createEvent()

    await expect(enforceConsentsRateLimit(event, logger))
      .resolves
      .toBeUndefined()

    expect(mocks.loggerSet).toHaveBeenCalledWith({
      consentRateLimit: { skipped: 'no-client-ip' },
    })
  })

  it('degrades open and logs when the KV binding is missing', async () => {
    vi.stubGlobal('useKV', () => {
      throw new Error('KV binding missing in runtime environment.')
    })

    const { enforceConsentsRateLimit } = await importLimiter()
    const { event } = createEvent()

    await expect(enforceConsentsRateLimit(event, logger))
      .resolves
      .toBeUndefined()

    expect(mocks.loggerSet).toHaveBeenCalledWith({
      consentRateLimit: {
        skipped: 'storage-unavailable',
        error: 'KV binding missing in runtime environment.',
      },
    })
  })

  it('degrades open and logs when a KV call fails', async () => {
    vi.stubGlobal('useKV', () => {
      return {
        get: async () => {
          throw new Error('KV unavailable')
        },
        put: async () => undefined,
      }
    })

    const { enforceConsentsRateLimit } = await importLimiter()
    const { event } = createEvent()

    await expect(enforceConsentsRateLimit(event, logger))
      .resolves
      .toBeUndefined()

    expect(mocks.loggerSet).toHaveBeenCalledWith({
      consentRateLimit: {
        skipped: 'storage-unavailable',
        error: 'KV unavailable',
      },
    })
  })
})
