import type { KVNamespace } from '@cloudflare/workers-types'
import { exceptionSummary } from '~~/server/utils/evlog-attributes'
import { resolveServerLogger } from '~~/server/utils/files/logger'

interface AuthRateLimitRule {
  window: number
  max: number
}

interface AuthRateLimitValue {
  key: string
  count: number
  lastRequest: number
  windowStart?: number
}

interface AuthRateLimitConsumeResult {
  allowed: boolean
  retryAfter: number | null
}

interface MemoryRateLimitBucket {
  count: number
  windowStart: number
  expiresAt: number
}

type KvRateLimitOperation = 'read' | 'write'

interface AuthRateLimitStorageOptions {
  denyOnKvError?: boolean
}

export const KV_ERROR_RETRY_AFTER_SECONDS = 1

interface AuthRateLimitStorage {
  get: (key: string) => Promise<AuthRateLimitValue | null>
  set: (key: string, value: AuthRateLimitValue) => Promise<void>
  consume: (
    key: string,
    rule: AuthRateLimitRule,
  ) => Promise<AuthRateLimitConsumeResult>
}

export const authRateLimitDefaults: AuthRateLimitRule = {
  window: 60,
  max: 60,
}

export const authRateLimitRules: Record<string, AuthRateLimitRule> = {
  '/sign-in/email': { window: 300, max: 10 },
  '/sign-up/email': { window: 900, max: 5 },
  '/sign-in/social': { window: 300, max: 20 },
  '/callback/*': { window: 300, max: 30 },
  '/request-password-reset': { window: 900, max: 3 },
  '/reset-password': { window: 900, max: 5 },
  '/reset-password/*': { window: 900, max: 10 },
  '/send-verification-email': { window: 900, max: 3 },
  '/change-password': { window: 900, max: 5 },
  '/verify-password': { window: 300, max: 5 },
  '/change-email': { window: 900, max: 3 },
  '/delete-user': { window: 900, max: 3 },
  '/delete-user/*': { window: 900, max: 10 },
  '/verify-email': { window: 300, max: 20 },
  '/two-factor/verify-totp': { window: 300, max: 5 },
  '/two-factor/verify-otp': { window: 300, max: 5 },
  '/two-factor/verify-backup-code': { window: 900, max: 5 },
  '/two-factor/generate-backup-codes': { window: 900, max: 3 },
  '/two-factor/enable': { window: 900, max: 5 },
  '/two-factor/disable': { window: 900, max: 5 },
  '/two-factor/get-totp-uri': { window: 900, max: 5 },
  '/two-factor/send-otp': { window: 900, max: 5 },
  '/two-factor/*': { window: 300, max: 10 },
  '/passkey/verify-authentication': { window: 300, max: 10 },
  '/passkey/verify-registration': { window: 900, max: 10 },
  '/passkey/delete-passkey': { window: 900, max: 10 },
  '/passkey/*': { window: 60, max: 20 },
  '/link-social': { window: 300, max: 10 },
  '/unlink-account': { window: 900, max: 5 },
  '/list-accounts': { window: 60, max: 30 },
  '/revoke-session': { window: 300, max: 20 },
  '/revoke-sessions': { window: 900, max: 5 },
  '/revoke-other-sessions': { window: 900, max: 5 },
  '/oauth2/register': { window: 60, max: 60 },
  '/oauth2/token': { window: 60, max: 300 },
  '/oauth2/authorize': { window: 60, max: 60 },
  '/oauth2/consent': { window: 60, max: 20 },
  '/oauth2/revoke': { window: 60, max: 120 },
  '/oauth2/introspect': { window: 60, max: 120 },
}

export const authRateLimitExemptPaths: readonly string[] = [
  '/get-session',
  '/.well-known/**',
]

/**
 * The `customRules` passed to Better Auth: the exempt paths first, as
 * `false`, so Better Auth never counts them and never writes KV for them,
 * then every limited path in table order.
 */
export function buildAuthRateLimitCustomRules(): Record<
  string,
  AuthRateLimitRule | false
> {
  const exemptRules = Object.fromEntries(
    authRateLimitExemptPaths.map(path => [path, false] as const),
  )

  return { ...exemptRules, ...authRateLimitRules }
}

export const authRateLimitMaxWindow = Math.max(
  ...Object.values(authRateLimitRules).map(rule => rule.window),
)

const MEMORY_RATE_LIMIT_MAX_BUCKETS = 10_000

const memoryRateLimitBuckets = new Map<string, MemoryRateLimitBucket>()

function pruneMemoryRateLimitBuckets(now: number): void {
  for (const [key, bucket] of memoryRateLimitBuckets) {
    if (now >= bucket.expiresAt) {
      memoryRateLimitBuckets.delete(key)
    }
  }

  for (const key of memoryRateLimitBuckets.keys()) {
    if (memoryRateLimitBuckets.size < MEMORY_RATE_LIMIT_MAX_BUCKETS) {
      return
    }

    memoryRateLimitBuckets.delete(key)
  }
}

/**
 * Counts a rate-limit hit in this isolate's memory only. Isolates do not
 * share it, so a client spread over several isolates gets more than `max`.
 * It is meant for low-risk reads that must not cost a KV write per request,
 * never for credential endpoints.
 */
export function consumeMemoryRateLimit(
  key: string,
  rule: AuthRateLimitRule,
  now: number = Date.now(),
): AuthRateLimitConsumeResult {
  const windowInMs = rule.window * 1000
  const bucket = memoryRateLimitBuckets.get(key)

  if (!bucket || now >= bucket.expiresAt) {
    pruneMemoryRateLimitBuckets(now)
    memoryRateLimitBuckets.set(key, {
      count: 1,
      windowStart: now,
      expiresAt: now + windowInMs,
    })

    return { allowed: true, retryAfter: null }
  }

  if (bucket.count >= rule.max) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000)),
    }
  }

  bucket.count += 1

  return { allowed: true, retryAfter: null }
}

export function resetMemoryRateLimits(): void {
  memoryRateLimitBuckets.clear()
}

/**
 * KV-backed rate-limit storage. By default a KV error propagates, so each
 * caller keeps its own failure policy. With `denyOnKvError` a failed KV read
 * or write is logged and the request is refused with a one-second retry
 * instead of a 500. KV answers 429 when one key gets more than one write per
 * second, which is exactly what a brute-force burst produces, so an
 * uncounted hit must never be allowed through.
 */
export function createAuthRateLimitStorage(
  kv: KVNamespace,
  keyPrefix: string,
  options: AuthRateLimitStorageOptions = {},
): AuthRateLimitStorage {
  const ttl = Math.max(60, authRateLimitMaxWindow)

  function storageKey(key: string): string {
    return `${keyPrefix}:${key}`
  }

  async function get(key: string): Promise<AuthRateLimitValue | null> {
    const raw = await kv.get(storageKey(key))

    if (!raw) {
      return null
    }

    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  async function set(
    key: string,
    value: AuthRateLimitValue,
    windowInSeconds: number = 0,
  ): Promise<void> {
    await kv.put(storageKey(key), JSON.stringify(value), {
      expirationTtl: Math.max(ttl, windowInSeconds),
    })
  }

  function consumeAfterKvFailure(
    operation: KvRateLimitOperation,
    exception: unknown,
  ): AuthRateLimitConsumeResult {
    if (!options.denyOnKvError) {
      throw exception
    }

    resolveServerLogger().set({
      attributes: {
        rateLimit: {
          keyPrefix,
          kvReadFailed: operation === 'read',
          kvWriteFailed: operation === 'write',
          denied: true,
          ...exceptionSummary(exception),
        },
      },
    })

    return { allowed: false, retryAfter: KV_ERROR_RETRY_AFTER_SECONDS }
  }

  async function consume(
    key: string,
    rule: AuthRateLimitRule,
  ): Promise<AuthRateLimitConsumeResult> {
    const now = Date.now()
    const windowInMs = rule.window * 1000
    let data: AuthRateLimitValue | null

    try {
      data = await get(key)
    } catch (exception) {
      return consumeAfterKvFailure('read', exception)
    }

    const windowStart = data ? (data.windowStart ?? data.lastRequest) : now

    if (data && now - windowStart < windowInMs && data.count >= rule.max) {
      const retryAfter = Math.max(
        1,
        Math.ceil((windowStart + windowInMs - now) / 1000),
      )

      return { allowed: false, retryAfter }
    }

    const nextValue: AuthRateLimitValue = !data
      || now - windowStart >= windowInMs
      ? { key, count: 1, lastRequest: now, windowStart: now }
      : { key, count: data.count + 1, lastRequest: now, windowStart }

    try {
      await set(key, nextValue, rule.window)
    } catch (exception) {
      return consumeAfterKvFailure('write', exception)
    }

    return { allowed: true, retryAfter: null }
  }

  return { get, set, consume }
}
