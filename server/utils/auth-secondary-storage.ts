import type { KVNamespace } from '@cloudflare/workers-types'
import type { BetterAuthOptions } from 'better-auth'

interface AuthCounterValue {
  count: number
  expiresAt: number
}

type SecondaryStorage = NonNullable<BetterAuthOptions['secondaryStorage']>

const KV_MINIMUM_TTL_SECONDS = 60

/**
 * KV has no atomic primitives, so `getAndDelete` and `increment` are
 * read-then-write approximations. Better Auth only calls `increment` for
 * `rateLimit.storage: 'secondary-storage'`, which this app does not use.
 */
export function createAuthSecondaryStorage(
  kv: KVNamespace,
  keyPrefix: string,
): SecondaryStorage {
  function storageKey(key: string): string {
    return `${keyPrefix}:${key}`
  }

  function parseCounter(raw: string | null): AuthCounterValue | null {
    if (!raw) {
      return null
    }

    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  async function get(key: string): Promise<string | null> {
    return await kv.get(storageKey(key))
  }

  async function getAndDelete(key: string): Promise<string | null> {
    const value = await get(key)

    if (value === null) {
      return null
    }

    await kv.delete(storageKey(key))

    return value
  }

  async function increment(key: string, ttl: number): Promise<number> {
    const now = Date.now()
    const existing = parseCounter(await get(key))
    const isActive = existing !== null && existing.expiresAt > now
    const counter: AuthCounterValue = isActive
      ? { count: existing.count + 1, expiresAt: existing.expiresAt }
      : { count: 1, expiresAt: now + ttl * 1000 }
    const remainingSeconds = Math.ceil((counter.expiresAt - now) / 1000)

    await kv.put(storageKey(key), JSON.stringify(counter), {
      expirationTtl: Math.max(remainingSeconds, KV_MINIMUM_TTL_SECONDS),
    })

    return counter.count
  }

  return {
    get,
    getAndDelete,
    increment,
    set: async (key, value, ttl) => {
      await kv.put(
        storageKey(key),
        value,
        ttl
          ? { expirationTtl: Math.max(ttl, KV_MINIMUM_TTL_SECONDS) }
          : undefined,
      )
    },
    delete: async (key) => {
      await kv.delete(storageKey(key))
    },
  }
}
