import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { getRequestHeader } from 'nuxt/server'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import type {
  useRequestLogger,
} from '~~/server/utils/logging/request-logger'

export const consentsRateLimitRule = { window: 60, max: 60 }

const CONSENTS_RATE_LIMIT_PREFIX = 'consents:rate-limit'

/**
 * Fixed-window limiter for `POST /api/v1/consents`, keyed by client IP and
 * built on the same KV-backed storage as the auth and key-management limiters.
 * The window index is part of the storage key because that storage only
 * resets a bucket after a full idle window; with the index in the key each
 * bucket lives for exactly one window.
 *
 * Fails open (and records why on the logger) when the client IP is unknown or
 * KV is unavailable: a missing receipt is a smaller harm than a consent
 * decision that cannot be logged, and local development has no
 * `cf-connecting-ip`.
 */
export async function enforceConsentsRateLimit(
  event: RequestEvent,
  logger: ReturnType<typeof useRequestLogger>,
): Promise<void> {
  const clientIp = getRequestHeader(event, 'cf-connecting-ip')

  if (!clientIp) {
    logger.set({ consentRateLimit: { skipped: 'no-client-ip' } })

    return
  }

  const windowInMs = consentsRateLimitRule.window * 1000
  const now = Date.now()
  const windowIndex = Math.floor(now / windowInMs)
  let allowed: boolean

  try {
    const storage = createAuthRateLimitStorage(
      useKV(),
      CONSENTS_RATE_LIMIT_PREFIX,
    )
    const result = await storage.consume(
      `${clientIp}:${windowIndex}`,
      consentsRateLimitRule,
    )

    allowed = result.allowed
  } catch (exception) {
    logger.set({
      consentRateLimit: {
        skipped: 'storage-unavailable',
        error: exceptionMessage(exception),
      },
    })

    return
  }

  if (allowed) {
    return
  }

  const retryAfter = Math.ceil(((windowIndex + 1) * windowInMs - now) / 1000)

  event.res.headers.set('Retry-After', String(retryAfter))

  throw createError({
    message: 'Too many consent receipts',
    status: 429,
    why: 'Consent receipt rate limit exceeded for this client',
    fix: 'Wait a minute before submitting another receipt',
  })
}
