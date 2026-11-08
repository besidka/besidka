import type { RequestEvent } from 'nuxt/server'
import { createError } from 'evlog'
import { getRequestHeader } from 'nuxt/server'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { resolveRateLimitKey } from '~~/server/utils/consents-rate-limit'
import type { useRequestLogger } from '~~/server/utils/logging/request-logger'

export const ARTIFACT_REPORT_RATE_LIMIT = { window: 3600, max: 5 }

const ARTIFACT_REPORT_RATE_LIMIT_KEY_PREFIX = 'artifact-report:rate-limit'

function resolveReporterKey(
  event: RequestEvent,
  userId: number | null,
): string | null {
  if (userId !== null) {
    return `user:${userId}`
  }

  const clientIp = getRequestHeader(event, 'cf-connecting-ip')

  return clientIp ? `ip:${resolveRateLimitKey(clientIp)}` : null
}

/**
 * KV limiter for artifact reports: 5 per hour per signed-in user, otherwise
 * per client IP (IPv6 by /64). Uses the same KV storage as the knowledge
 * and gateway catalog limiters, so it needs no extra Workers binding. Fails
 * open, with a note on the logger, when neither a user nor an IP is known.
 */
export async function enforceArtifactReportRateLimit(
  event: RequestEvent,
  userId: number | null,
  logger: ReturnType<typeof useRequestLogger>,
): Promise<void> {
  const key = resolveReporterKey(event, userId)

  if (!key) {
    logger.set({ artifactReportRateLimit: { skipped: 'no-client-key' } })

    return
  }

  const storage = createAuthRateLimitStorage(
    useKV(),
    ARTIFACT_REPORT_RATE_LIMIT_KEY_PREFIX,
  )
  const result = await storage.consume(key, ARTIFACT_REPORT_RATE_LIMIT)

  if (result.allowed) {
    return
  }

  if (result.retryAfter !== null) {
    event.res.headers.set('Retry-After', String(result.retryAfter))
  }

  throw createError({
    message: 'Too many reports',
    status: 429,
    why: 'Too many reports from this client in the last hour',
    fix: 'Wait before sending another report',
  })
}
