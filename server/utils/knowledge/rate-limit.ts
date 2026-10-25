import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'

const KNOWLEDGE_WRITE_RATE_LIMIT = { window: 60, max: 60 }
const KNOWLEDGE_WRITE_RATE_LIMIT_KEY_PREFIX = 'knowledge-write:rate-limit'

/**
 * Per-user KV limiter for the mutating knowledge routes: 60 requests per
 * 60 seconds (the same storage as the gateway catalog limiter, so it needs
 * no extra Workers binding and also works on preview deployments). Answers
 * 429 with a `Retry-After` header when the event is given.
 */
export async function enforceKnowledgeWriteRateLimit(
  userId: number,
  event?: RequestEvent,
): Promise<void> {
  const storage = createAuthRateLimitStorage(
    useKV(),
    KNOWLEDGE_WRITE_RATE_LIMIT_KEY_PREFIX,
  )
  const result = await storage.consume(
    String(userId),
    KNOWLEDGE_WRITE_RATE_LIMIT,
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
    why: 'Too many project knowledge changes in a short time',
    fix: 'Wait a moment before retrying',
  })
}
