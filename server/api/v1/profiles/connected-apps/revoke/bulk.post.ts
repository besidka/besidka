import { createError, log } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { enforceMemoryRateLimit } from '~~/server/utils/memory/rate-limit'
import { revokeConnectedApp } from '~~/server/utils/oauth/revoke-connected-app'
import type { RevokedConnectedApp } from '~~/server/utils/oauth/revoke-connected-app'

const CLIENT_ID_MAX_LENGTH = 256
const MAX_BULK_CLIENT_IDS = 20

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const body = await readValidatedBody(event, z.object({
    clientIds: z.array(z.string().min(1).max(CLIENT_ID_MAX_LENGTH))
      .min(1)
      .max(MAX_BULK_CLIENT_IDS),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const userId = parseInt(session.user.id)

  await enforceMemoryRateLimit('legal-consent', userId, event)

  const db = useDb()
  const clientIds = [...new Set(body.data.clientIds)]
  const revokedClientIds: string[] = []
  const notFoundClientIds: string[] = []

  for (const clientId of clientIds) {
    let revoked: RevokedConnectedApp | null

    try {
      revoked = await revokeConnectedApp(db, userId, clientId)
    } catch (exception) {
      throw createError({
        message: 'Failed to disconnect the apps',
        status: 500,
        why: `${revokedClientIds.length} of ${clientIds.length} apps were `
          + `disconnected before this failure: ${exceptionMessage(exception)}`,
        fix: 'Reload the page and try again.',
      })
    }

    if (!revoked) {
      notFoundClientIds.push(clientId)

      continue
    }

    revokedClientIds.push(clientId)
    log.info({
      action: 'oauth_revoked',
      userId,
      attributes: {
        legalConsent: {
          action: 'oauth_revoked',
          oauthClientId: clientId,
          scopes: revoked.scopes,
        },
      },
    })
  }

  logger.set({
    userId,
    attributes: {
      connectedApps: {
        bulkRevokeRequested: clientIds.length,
        bulkRevoked: revokedClientIds.length,
      },
    },
  })

  return { revokedClientIds, notFoundClientIds }
})
