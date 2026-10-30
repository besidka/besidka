import { createError } from 'evlog'
import {
  defineEventHandler,
  setResponseStatus,
} from 'nuxt/server'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { revokeConnectedApp } from '~~/server/utils/oauth/revoke-connected-app'
import type { RevokedConnectedApp } from '~~/server/utils/oauth/revoke-connected-app'

const CLIENT_ID_MAX_LENGTH = 256

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const params = z.object({
    clientId: z.string().min(1).max(CLIENT_ID_MAX_LENGTH),
  }).safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const userId = parseInt(session.user.id)
  const { clientId } = params.data
  let revoked: RevokedConnectedApp | null

  try {
    revoked = await revokeConnectedApp(useDb(), userId, clientId)
  } catch (exception) {
    throw createError({
      message: 'Failed to disconnect the app',
      status: 500,
      why: exceptionMessage(exception),
    })
  }

  if (!revoked) {
    throw createError({
      message: 'Connected app not found',
      status: 404,
    })
  }

  logger.set({
    userId,
    attributes: {
      legalConsent: {
        action: 'oauth_revoked',
        oauthClientId: clientId,
        scopes: revoked.scopes,
      },
    },
  })

  return setResponseStatus(event, 204, 'Connected app revoked')
})
