import type { KVNamespace } from '@cloudflare/workers-types'
import {
  GOOGLE_SHEETS_APP_REQUESTS_PER_MINUTE,
  GOOGLE_SHEETS_USER_REQUESTS_PER_MINUTE,
} from '#shared/utils/google-sheets'

const MINUTE_MS = 60_000
const FLUSH_INTERVAL_MS = 1000
const KEY_TTL_SECONDS = 120
const USER_PREFIX = 'google-sheets-rate-limit:user'
const APP_KEY = 'google-sheets-rate-limit:app'

interface MinuteCounter {
  minute: number
  known: number
  pending: number
  lastFlushAt: number
}

export type SheetsLimitScope = 'user' | 'app'

export interface SheetsReservation {
  granted: number
  limitedBy: SheetsLimitScope | null
  kvUnavailable: boolean
}

export type SheetsRequestReserver = (
  count: number,
) => Promise<SheetsReservation>

const countersByKv = new WeakMap<KVNamespace, Map<string, MinuteCounter>>()

function countersFor(kv: KVNamespace): Map<string, MinuteCounter> {
  let counters = countersByKv.get(kv)

  if (!counters) {
    counters = new Map()
    countersByKv.set(kv, counters)
  }

  return counters
}

async function readStoredCount(
  kv: KVNamespace,
  key: string,
): Promise<{ count: number, isAvailable: boolean }> {
  try {
    const count = Number(await kv.get(key))

    return {
      count: Number.isFinite(count) && count > 0 ? count : 0,
      isAvailable: true,
    }
  } catch {
    return { count: 0, isAvailable: false }
  }
}

async function counterFor(
  kv: KVNamespace,
  key: string,
  minute: number,
): Promise<{ counter: MinuteCounter, isAvailable: boolean }> {
  const counters = countersFor(kv)
  const existing = counters.get(key)

  if (existing) {
    return { counter: existing, isAvailable: true }
  }

  for (const [staleKey, stale] of counters) {
    if (stale.minute < minute) {
      counters.delete(staleKey)
    }
  }

  const stored = await readStoredCount(kv, key)
  const counter: MinuteCounter = {
    minute,
    known: stored.count,
    pending: 0,
    lastFlushAt: 0,
  }

  counters.set(key, counter)

  return { counter, isAvailable: stored.isAvailable }
}

async function flush(
  kv: KVNamespace,
  key: string,
  counter: MinuteCounter,
  now: number,
): Promise<boolean> {
  counter.lastFlushAt = now

  try {
    await kv.put(key, String(counter.known + counter.pending), {
      expirationTtl: KEY_TTL_SECONDS,
    })
    counter.known += counter.pending
    counter.pending = 0

    return true
  } catch {
    return false
  }
}

/**
 * Reserves up to `count` Sheets requests against the per-user budget (30 a
 * minute) and the app-wide budget (200 a minute) in one step, so an import
 * asks twice (the metadata request, then the sheets it will read) and never
 * once per request. The counts live in the isolate and are written to a KV
 * key per bucket and calendar minute at most once a second, because KV
 * takes about one write a second per key and the app-wide key is shared by
 * every user. The stored value is read once, when an isolate first counts a
 * bucket in a minute, and overwritten by that isolate's own total after
 * that, so isolates share the count only best effort (a later write by one
 * isolate can hide what another counted). It is a flood guard per isolate,
 * not exact accounting. A KV error never refuses a request
 * (the isolate's own count still applies) and is reported as
 * `kvUnavailable`, separate from a refusal, which names the bucket that
 * ran out. The caller never retries a refused or Google-refused request.
 */
export async function reserveSheetsRequests(
  kv: KVNamespace,
  userId: number,
  count: number,
  now: number = Date.now(),
): Promise<SheetsReservation> {
  const minute = Math.floor(now / MINUTE_MS)
  const buckets: Array<{
    scope: SheetsLimitScope
    key: string
    max: number
  }> = [
    {
      scope: 'user',
      key: `${USER_PREFIX}:${userId}:${minute}`,
      max: GOOGLE_SHEETS_USER_REQUESTS_PER_MINUTE,
    },
    {
      scope: 'app',
      key: `${APP_KEY}:${minute}`,
      max: GOOGLE_SHEETS_APP_REQUESTS_PER_MINUTE,
    },
  ]
  let granted = count
  let limitedBy: SheetsLimitScope | null = null
  let kvUnavailable = false
  const loaded: Array<{ key: string, counter: MinuteCounter }> = []

  for (const bucket of buckets) {
    const { counter, isAvailable } = await counterFor(kv, bucket.key, minute)
    const available = Math.max(bucket.max - counter.known - counter.pending, 0)

    kvUnavailable = kvUnavailable || !isAvailable
    loaded.push({ key: bucket.key, counter })

    if (available < granted) {
      granted = available
      limitedBy = bucket.scope
    }
  }

  if (granted <= 0) {
    return { granted: 0, limitedBy, kvUnavailable }
  }

  for (const { key, counter } of loaded) {
    counter.pending += granted

    if (now - counter.lastFlushAt >= FLUSH_INTERVAL_MS) {
      const isFlushed = await flush(kv, key, counter, now)

      kvUnavailable = kvUnavailable || !isFlushed
    }
  }

  return {
    granted,
    limitedBy: granted < count ? limitedBy : null,
    kvUnavailable,
  }
}

export function createSheetsRequestReserver(
  kv: KVNamespace,
  userId: number,
): SheetsRequestReserver {
  return count => reserveSheetsRequests(kv, userId, count)
}
