import { gatewayIds } from '#shared/utils/gateways'
import { createError } from 'evlog'
import {
  getCachedCloudflareGatewayCatalog,
  getCachedGatewayCatalog,
} from '~~/server/utils/gateways/catalog'
import { enforceGatewayModelsRateLimit } from '~~/server/utils/gateways/catalog-rate-limit'
import { getCloudflareGatewayCredentials } from '~~/server/utils/gateways/cloudflare'
import { defineEventHandler } from 'nuxt/server'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const params = z.object({
    gateway: z.enum(gatewayIds),
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

  await enforceGatewayModelsRateLimit(event, session.user.id)

  const logger = useRequestLogger(event)

  if (params.data.gateway === 'cloudflare') {
    const credentials = await getCloudflareGatewayCredentials(
      session.user.id,
    )

    if (!credentials) {
      throw createError({
        message: 'Cloudflare AI Gateway credentials not found',
        status: 401,
        why: 'No Cloudflare AI Gateway API key is set up for this account.',
        fix: 'Add your Cloudflare AI Gateway credentials in the settings.',
      })
    }

    const models = await getCachedCloudflareGatewayCatalog(credentials, {
      logger,
    })

    return {
      gateway: 'cloudflare' as const,
      models,
    }
  }

  const models = await getCachedGatewayCatalog(params.data.gateway, {
    logger,
  })

  return {
    gateway: params.data.gateway,
    models,
  }
})
