import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMemoryRateLimits } from '~~/server/utils/auth-rate-limit'
import { enforceKeysRateLimit } from '~~/server/utils/keys-rate-limit'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
}))

vi.mock('~~/server/utils/files/logger', () => ({
  resolveServerLogger: () => ({ set: mocks.loggerSet }),
}))

function createEvent(method: string) {
  return {
    req: { method },
    res: { headers: new Headers() },
  }
}

function createKv(put: (key: string, value: string) => Promise<void>) {
  const store = new Map<string, string>()

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      await put(key, value)
      store.set(key, value)
    }),
    delete: vi.fn(),
  }
}

describe('enforceKeysRateLimit', () => {
  let kv: ReturnType<typeof createKv>

  beforeEach(() => {
    resetMemoryRateLimits()
    mocks.loggerSet.mockClear()
    kv = createKv(async () => {})
    vi.stubGlobal('useKV', () => kv)
  })

  it('counts reads in memory without a KV write', async () => {
    await enforceKeysRateLimit(
      createEvent('GET') as never,
      '7',
      'keys-rate-limit:summary:get',
      { window: 60, max: 300 },
    )

    expect(kv.get).not.toHaveBeenCalled()
    expect(kv.put).not.toHaveBeenCalled()
  })

  it('still returns 429 with Retry-After once reads exceed the limit',
    async () => {
      const rule = { window: 60, max: 2 }
      const event = createEvent('GET')

      await enforceKeysRateLimit(event as never, '7', 'keys:get', rule)
      await enforceKeysRateLimit(event as never, '7', 'keys:get', rule)

      await expect(
        enforceKeysRateLimit(event as never, '7', 'keys:get', rule),
      ).rejects.toMatchObject({ status: 429 })
      expect(event.res.headers.get('Retry-After')).toBe('60')
    })

  it('counts mutations in KV', async () => {
    await enforceKeysRateLimit(
      createEvent('POST') as never,
      '7',
      'keys-rate-limit:openai:post',
      { window: 60, max: 10 },
    )

    expect(kv.put).toHaveBeenCalledTimes(1)
  })

  it('answers 429 with a one-second retry when KV refuses a mutation write',
    async () => {
      kv = createKv(async () => {
        throw new Error('KV PUT failed: 429 Too Many Requests')
      })

      const event = createEvent('DELETE')

      await expect(enforceKeysRateLimit(
        event as never,
        '7',
        'keys-rate-limit:openai:delete',
        { window: 60, max: 10 },
      )).rejects.toMatchObject({ status: 429 })
      expect(event.res.headers.get('Retry-After')).toBe('1')
      expect(mocks.loggerSet).toHaveBeenCalledWith({
        attributes: {
          rateLimit: expect.objectContaining({
            keyPrefix: 'keys-rate-limit:openai:delete',
            kvWriteFailed: true,
            denied: true,
          }),
        },
      })
    })
})
