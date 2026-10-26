import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'

export type MemoryInstructRateLimitAction = 'preview' | 'apply'

export const MEMORY_INSTRUCT_RATE_LIMITS: Record<
  MemoryInstructRateLimitAction,
  { window: number, max: number }
> = {
  preview: { window: 60, max: 6 },
  apply: { window: 60, max: 30 },
}

const RATE_LIMIT_KEY_PREFIX = 'memory-instruct:rate-limit'

/**
 * Per-user KV limiter for the memory instruction routes, on the same storage
 * as the knowledge write limiter (no extra Workers binding, works on preview
 * deployments). Preview runs a model on the user's key, so it is limited
 * harder than apply. Answers 429 with a `Retry-After` header when the event is
 * given.
 */
export async function enforceMemoryInstructRateLimit(
  userId: number,
  action: MemoryInstructRateLimitAction,
  event?: RequestEvent,
): Promise<void> {
  const storage = createAuthRateLimitStorage(
    useKV(),
    `${RATE_LIMIT_KEY_PREFIX}:${action}`,
  )
  const result = await storage.consume(
    String(userId),
    MEMORY_INSTRUCT_RATE_LIMITS[action],
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
    why: action === 'preview'
      ? 'Too many memory previews in a short time.'
      : 'Too many memory changes in a short time.',
    fix: 'Wait a moment before retrying.',
  })
}
