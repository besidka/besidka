import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { enforceBuiltinCommandRateLimit } from '~~/server/utils/chats/builtin-command-rate-limit'
import { evaluateFeatureForEvent } from '~~/server/utils/features/context'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import {
  DEBUG_INFO_DEFAULT_MESSAGES,
  formatDebugReport,
  getDebugInfo,
  resolveDebugRuntime,
} from '~~/server/utils/mcp/private/debug-info'

export default defineEventHandler(async (event) => {
  const params = z.object({
    slug: z.ulid(),
  }).safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)

  await enforceBuiltinCommandRateLimit(userId, event)

  const logger = useRequestLogger(event)
  const connectorsFeature = await evaluateFeatureForEvent(event, 'connectors', {
    recordExposure: false,
  })

  event.res.headers.set('cache-control', 'private, no-store')

  const info = await getDebugInfo(
    useDb(),
    useKV(),
    userId,
    {
      slug: params.data.slug,
      maxMessages: DEBUG_INFO_DEFAULT_MESSAGES,
      includeConnectors: connectorsFeature.active,
      includeFeatures: true,
      ...resolveDebugRuntime(),
    },
    logger,
  )

  return { report: formatDebugReport(info) }
})
