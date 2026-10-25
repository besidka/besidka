import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'

const GATEWAY_MODELS_RATE_LIMIT = { window: 60, max: 20 }
const GATEWAY_MODELS_RATE_LIMIT_KEY_PREFIX = 'gateway-catalog:rate-limit'

export async function enforceGatewayModelsRateLimit(
  event: RequestEvent,
  userId: string,
): Promise<void> {
  const storage = createAuthRateLimitStorage(
    useKV(),
    GATEWAY_MODELS_RATE_LIMIT_KEY_PREFIX,
  )
  const result = await storage.consume(userId, GATEWAY_MODELS_RATE_LIMIT)

  if (result.allowed) {
    return
  }

  if (result.retryAfter !== null) {
    event.res.headers.set('Retry-After', String(result.retryAfter))
  }

  throw createError({
    message: 'Too many requests',
    status: 429,
    why: 'Gateway catalog rate limit exceeded',
    fix: 'Wait a moment before retrying',
  })
}
