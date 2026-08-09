import { createError, useLogger } from 'evlog'
import type { H3Event } from 'h3'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { getCachedGatewayCatalog } from '~~/server/utils/gateways/catalog'

const GATEWAY_MODELS_RATE_LIMIT = { window: 60, max: 20 }
const GATEWAY_MODELS_RATE_LIMIT_KEY_PREFIX = 'gateway-catalog:rate-limit'

async function enforceGatewayModelsRateLimit(
  event: H3Event,
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
    setResponseHeader(event, 'Retry-After', result.retryAfter)
  }

  throw createError({
    message: 'Too many requests',
    status: 429,
    why: 'Gateway catalog rate limit exceeded',
    fix: 'Wait a moment before retrying',
  })
}

export default defineEventHandler(async (event) => {
  const params = await getValidatedRouterParams(event, z.object({
    gateway: z.enum(['vercel', 'cloudflare', 'openrouter']),
  }).safeParse)

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  if (params.data.gateway === 'cloudflare') {
    throw createError({
      message: 'Cloudflare AI Gateway is not yet supported',
      status: 400,
      why: 'Cloudflare AI Gateway catalog support ships in a later PR',
      fix: 'Use "vercel" or "openrouter" for now',
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  await enforceGatewayModelsRateLimit(event, session.user.id)

  const logger = useLogger(event)
  const models = await getCachedGatewayCatalog(params.data.gateway, {
    logger,
  })

  return {
    gateway: params.data.gateway,
    models,
  }
})
