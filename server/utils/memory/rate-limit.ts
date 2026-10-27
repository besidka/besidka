import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'

interface MemoryRateLimitRule {
  window: number
  max: number
  why: string
}

export const MEMORY_RATE_LIMITS = {
  'write': {
    window: 60,
    max: 60,
    why: 'Too many memory changes in a short time.',
  },
  'instruct-preview': {
    window: 60,
    max: 6,
    why: 'Too many memory previews in a short time.',
  },
  'instruct-apply': {
    window: 60,
    max: 30,
    why: 'Too many memory changes in a short time.',
  },
  'legal-consent': {
    window: 60,
    max: 20,
    why: 'Too many consent changes in a short time.',
  },
  'share-check': {
    window: 60,
    max: 20,
    why: 'Too many share checks in a short time.',
  },
} as const satisfies Record<string, MemoryRateLimitRule>

export type MemoryRateLimitBucket = keyof typeof MEMORY_RATE_LIMITS

const MEMORY_RATE_LIMIT_KEY_PREFIX = 'memory-rate-limit'

/**
 * The one per-user KV limiter for the memory routes, one counter per named
 * bucket, on the same storage as the knowledge write limiter (no extra
 * Workers binding, works on preview deployments). `write` (60 per minute) is
 * shared by every route that changes memory entries or starts paid memory
 * work: entry create, edit and delete, reset, delete-extracted, import,
 * extract-now, backfill start and excluding a chat from memory. "Tell
 * Besidka what to remember" has its own buckets: `instruct-preview` runs a
 * model on the user's key, so it is limited harder than `instruct-apply`.
 * `legal-consent` covers the consent and transfer-consent grant and withdraw
 * routes, and `share-check` the share personal-data check (it may call
 * TypeSafe AI on the user's key). Answers 429 with a `Retry-After` header
 * when the event is given; a KV failure propagates, so
 * the limit fails closed.
 */
export async function enforceMemoryRateLimit(
  bucket: MemoryRateLimitBucket,
  userId: number,
  event?: RequestEvent,
): Promise<void> {
  const rule = MEMORY_RATE_LIMITS[bucket]
  const storage = createAuthRateLimitStorage(
    useKV(),
    `${MEMORY_RATE_LIMIT_KEY_PREFIX}:${bucket}`,
  )
  const result = await storage.consume(String(userId), {
    window: rule.window,
    max: rule.max,
  })

  if (result.allowed) {
    return
  }

  if (event && result.retryAfter !== null) {
    event.res.headers.set('Retry-After', String(result.retryAfter))
  }

  throw createError({
    message: 'Too many requests',
    status: 429,
    why: rule.why,
    fix: 'Wait a moment before retrying.',
  })
}
