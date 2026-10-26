import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'

interface MemoryRateLimitRule {
  window: number
  max: number
}

export const MEMORY_RATE_LIMITS = {
  write: { window: 60, max: 60 },
} as const satisfies Record<string, MemoryRateLimitRule>

export type MemoryRateLimitBucket = keyof typeof MEMORY_RATE_LIMITS

const MEMORY_RATE_LIMIT_KEY_PREFIX = 'memory-rate-limit'

/**
 * Per-user KV limiter for the memory routes, one counter per named bucket,
 * on the same storage as the knowledge write limiter (no extra Workers
 * binding, works on preview deployments). `write` (60 per minute) is shared
 * by every route that changes memory entries or starts paid memory work:
 * entry create, edit and delete, reset, delete-extracted, import,
 * extract-now and backfill start. Answers 429 with a `Retry-After` header
 * when the event is given; a KV failure propagates, so the limit fails
 * closed like the knowledge one.
 */
export async function enforceMemoryRateLimit(
  bucket: MemoryRateLimitBucket,
  userId: number,
  event?: RequestEvent,
): Promise<void> {
  const storage = createAuthRateLimitStorage(
    useKV(),
    `${MEMORY_RATE_LIMIT_KEY_PREFIX}:${bucket}`,
  )
  const result = await storage.consume(
    String(userId),
    MEMORY_RATE_LIMITS[bucket],
  )

  if (result.allowed) {
    return
  }

  if (event && result.retryAfter !== null) {
    event.res.headers.set('Retry-After', String(result.retryAfter))
  }

  throw createError({
    message: 'Too many requests',
    status: 429,
    why: 'Too many memory changes in a short time',
    fix: 'Wait a moment before retrying',
  })
}
