import { createError } from 'evlog'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  defineEventHandler,
  setResponseStatus,
} from 'nuxt/server'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

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
  const db = useDb()
  const consents = await db
    .select({ scopes: schema.oauthConsents.scopes })
    .from(schema.oauthConsents)
    .where(and(
      eq(schema.oauthConsents.userId, userId),
      eq(schema.oauthConsents.clientId, clientId),
    ))

  if (!consents.length) {
    throw createError({
      message: 'Connected app not found',
      status: 404,
    })
  }

  try {
    await db.batch([
      db.delete(schema.oauthAccessTokens).where(and(
        eq(schema.oauthAccessTokens.userId, userId),
        eq(schema.oauthAccessTokens.clientId, clientId),
      )),
      db.delete(schema.oauthRefreshTokens).where(and(
        eq(schema.oauthRefreshTokens.userId, userId),
        eq(schema.oauthRefreshTokens.clientId, clientId),
      )),
      db.delete(schema.oauthConsents).where(and(
        eq(schema.oauthConsents.userId, userId),
        eq(schema.oauthConsents.clientId, clientId),
      )),
    ])
  } catch (exception) {
    throw createError({
      message: 'Failed to disconnect the app',
      status: 500,
      why: exceptionMessage(exception),
    })
  }

  const revokedScopes = [...new Set(consents.flatMap((consent) => {
    return Array.isArray(consent.scopes) ? consent.scopes as string[] : []
  }))]

  logger.set({
    userId,
    attributes: {
      legalConsent: {
        action: 'oauth_revoked',
        oauthClientId: clientId,
        scopes: revokedScopes,
      },
    },
  })

  return setResponseStatus(event, 204, 'Connected app revoked')
})
