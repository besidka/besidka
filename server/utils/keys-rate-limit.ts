import { createError } from 'evlog'
import type { H3Event } from 'h3'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'

interface KeysRateLimitRule {
  window: number
  max: number
}

/**
 * Shared rate-limit enforcement for the `/api/v1/profiles/keys/*` routes,
 * reusing the KV-backed `createAuthRateLimitStorage()` factory. Each call
 * site passes its own `keyPrefix` so every route/provider/method
 * combination gets an independent bucket keyed by `session.user.id` — a
 * card's POST-then-refresh-GET flow, or two independent routes each firing
 * a GET on page load, must never share a bucket with each other or
 * false-429 normal usage.
 */
export async function enforceKeysRateLimit(
  event: H3Event,
  userId: string,
  keyPrefix: string,
  rule: KeysRateLimitRule,
): Promise<void> {
  const storage = createAuthRateLimitStorage(useKV(), keyPrefix)
  const result = await storage.consume(userId, rule)

  if (result.allowed) {
    return
  }

  if (result.retryAfter !== null) {
    setResponseHeader(event, 'Retry-After', result.retryAfter)
  }

  throw createError({
    message: 'Too many requests',
    status: 429,
    why: 'Key management rate limit exceeded',
    fix: 'Wait a moment before retrying',
  })
}
