import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAuthSecondaryStorage,
} from '../../../server/utils/auth-secondary-storage'

interface PutOptions {
  expirationTtl?: number
}

function createFakeKV() {
  const store = new Map<string, string>()
  const putCalls: Array<{
    key: string
    value: string
    options?: PutOptions
  }> = []

  return {
    store,
    putCalls,
    async get(key: string) {
      return store.get(key) ?? null
    },
    async put(key: string, value: string, options?: PutOptions) {
      store.set(key, value)
      putCalls.push({ key, value, options })
    },
    async delete(key: string) {
      store.delete(key)
    },
  }
}

describe('createAuthSecondaryStorage', () => {
  let kv: ReturnType<typeof createFakeKV>
  let storage: ReturnType<typeof createAuthSecondaryStorage>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    kv = createFakeKV()
    storage = createAuthSecondaryStorage(kv as never, 'auth')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('prefixes keys for get, set and delete', async () => {
    await storage.set('session:1', 'value', 300)

    expect(kv.store.get('auth:session:1')).toBe('value')
    expect(kv.putCalls[0]?.options).toEqual({ expirationTtl: 300 })
    expect(await storage.get('session:1')).toBe('value')

    await storage.delete('session:1')

    expect(kv.store.has('auth:session:1')).toBe(false)
  })

  it('clamps set TTL to the KV minimum and omits it when absent', async () => {
    await storage.set('short', 'a', 5)
    await storage.set('forever', 'b')

    expect(kv.putCalls[0]?.options).toEqual({ expirationTtl: 60 })
    expect(kv.putCalls[1]?.options).toBeUndefined()
  })

  it('returns the value and deletes it in getAndDelete', async () => {
    await storage.set('verification:abc', '{"value":"x"}')

    expect(await storage.getAndDelete('verification:abc'))
      .toBe('{"value":"x"}')
    expect(kv.store.has('auth:verification:abc')).toBe(false)
    expect(await storage.getAndDelete('verification:abc')).toBeNull()
  })

  it('does not write when getAndDelete finds nothing', async () => {
    const deleteSpy = vi.spyOn(kv, 'delete')

    expect(await storage.getAndDelete('missing')).toBeNull()
    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it('creates a counter at 1 and increments within the window', async () => {
    expect(await storage.increment('counter', 120)).toBe(1)
    expect(await storage.increment('counter', 120)).toBe(2)
    expect(await storage.increment('counter', 120)).toBe(3)
  })

  it('keeps the original expiry when incrementing', async () => {
    await storage.increment('counter', 120)
    vi.advanceTimersByTime(30_000)
    await storage.increment('counter', 120)

    expect(kv.putCalls[0]?.options).toEqual({ expirationTtl: 120 })
    expect(kv.putCalls[1]?.options).toEqual({ expirationTtl: 90 })
  })

  it('starts a fresh counter once the window has elapsed', async () => {
    await storage.increment('counter', 60)
    await storage.increment('counter', 60)
    vi.advanceTimersByTime(61_000)

    expect(await storage.increment('counter', 60)).toBe(1)
  })

  it('restarts the counter when the stored value is corrupt', async () => {
    kv.store.set('auth:counter', 'not-json')

    expect(await storage.increment('counter', 60)).toBe(1)
  })
})
