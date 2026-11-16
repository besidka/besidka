import type { KVNamespace } from '@cloudflare/workers-types'

const MINUTE_MS = 60_000
const FLUSH_INTERVAL_MS = 1000
const KEY_TTL_SECONDS = 120

interface MinuteCounter {
  minute: number
  known: number
  pending: number
  lastFlushAt: number
}

export interface IconRateLimitResult {
  allowed: boolean
  retryAfter: number | null
}

const countersByKv = new WeakMap<KVNamespace, Map<string, MinuteCounter>>()

function countersFor(kv: KVNamespace): Map<string, MinuteCounter> {
  let counters = countersByKv.get(kv)

  if (!counters) {
    counters = new Map()
    countersByKv.set(kv, counters)
  }

  return counters
}

async function readStoredCount(kv: KVNamespace, key: string): Promise<number> {
  try {
    const count = Number(await kv.get(key))

    return Number.isFinite(count) && count > 0 ? count : 0
  } catch {
    return 0
  }
}

async function flush(
  kv: KVNamespace,
  key: string,
  counter: MinuteCounter,
  now: number,
): Promise<void> {
  counter.lastFlushAt = now

  try {
    await kv.put(key, String(counter.known + counter.pending), {
      expirationTtl: KEY_TTL_SECONDS,
    })
    counter.known += counter.pending
    counter.pending = 0
  } catch {
    return
  }
}

/**
 * The icon routes' per-user budget, counted in a KV key per user and
 * calendar minute. An icon burst loads dozens of images at once and KV takes
 * about one write a second per key, so the count is kept in the isolate and
 * written at most once a second; the KV value only adds what other isolates
 * counted. It is a flood guard, not exact accounting, and it fails open: a
 * KV error never blocks an icon (the outbound fetch behind it has its own
 * cache and lock).
 */
export async function consumeIconRateLimit(
  kv: KVNamespace,
  prefix: string,
  userId: number,
  max: number,
  now: number = Date.now(),
): Promise<IconRateLimitResult> {
  const minute = Math.floor(now / MINUTE_MS)
  const key = `${prefix}:${userId}:${minute}`
  const counters = countersFor(kv)
  let counter = counters.get(key)

  if (!counter) {
    for (const [staleKey, stale] of counters) {
      if (stale.minute < minute) {
        counters.delete(staleKey)
      }
    }

    counter = {
      minute,
      known: await readStoredCount(kv, key),
      pending: 0,
      lastFlushAt: 0,
    }
    counters.set(key, counter)
  }

  if (counter.known + counter.pending >= max) {
    const msToNextMinute = (minute + 1) * MINUTE_MS - now

    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil(msToNextMinute / 1000)),
    }
  }

  counter.pending += 1

  if (now - counter.lastFlushAt >= FLUSH_INTERVAL_MS) {
    await flush(kv, key, counter, now)
  }

  return { allowed: true, retryAfter: null }
}
