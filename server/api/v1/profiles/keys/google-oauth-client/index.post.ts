import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import {
  GOOGLE_OAUTH_CLIENT_ID_MAX_LENGTH,
  GOOGLE_OAUTH_CLIENT_SECRET_MAX_LENGTH,
  isGoogleOAuthClientId,
  isGoogleOAuthClientSecret,
} from '#shared/utils/google-byo'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { requireGoogleByoAccess } from '~~/server/utils/google/byo-access'
import {
  isGoogleByoClientReplacement,
  saveGoogleByoClient,
} from '~~/server/utils/google/byo-client'
import { isBesidkaGoogleClientId } from '~~/server/utils/google/client'
import { disconnectGoogleConnection } from '~~/server/utils/google/connection'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  clientId: z.string().trim().max(GOOGLE_OAUTH_CLIENT_ID_MAX_LENGTH),
  clientSecret: z.string().trim().max(GOOGLE_OAUTH_CLIENT_SECRET_MAX_LENGTH),
})

function invalidClientId() {
  return createError({
    message: 'This is not a Google OAuth client id',
    status: 400,
    why: 'A client id of a Web OAuth client ends with '
      + '.apps.googleusercontent.com',
    fix: 'Copy the client id from Clients in the Google Auth Platform',
  })
}

function invalidClientSecret() {
  return createError({
    message: 'This is not a Google OAuth client secret',
    status: 400,
    why: 'A client secret is 20 to 128 visible characters with no spaces',
    fix: 'Copy the client secret of the same client and paste it again',
  })
}

function besidkaClientRefused() {
  return createError({
    message: 'This is Besidka\'s own Google client',
    status: 400,
    why: 'Your own client must come from a Google Cloud project of yours, '
      + 'not from the client Besidka uses for sign-in or Google Drive',
    fix: 'Create a Web client in your own Google Cloud project and paste its '
      + 'client id and secret',
  })
}

/**
 * Saves or replaces the owner's own Google OAuth client (admin and
 * `google.byo` only) as one encrypted `keys` row of the
 * `google-oauth-client` kind. Besidka's own sign-in or Drive client is
 * refused. The secret is write-only: the answer only says it was saved.
 * Saving a different client id first ends the connection made with the old
 * client (revoke, tokens cleared), because its refresh token belongs to
 * that client; a new secret for the same client keeps the connection.
 * Neither value is logged or echoed in an error.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireGoogleByoAccess(event, {
    write: true,
    rateLimit: 'write',
  })
  const body = await readConnectorBody(event, bodySchema)

  if (!isGoogleOAuthClientId(body.clientId)) {
    throw invalidClientId()
  }

  if (!isGoogleOAuthClientSecret(body.clientSecret)) {
    throw invalidClientSecret()
  }

  if (isBesidkaGoogleClientId(body.clientId)) {
    throw besidkaClientRefused()
  }

  const db = useDb()
  const logger = useRequestLogger(event)
  const isReplacement = await isGoogleByoClientReplacement(
    db,
    userId,
    body.clientId,
  )
  let connectionEnded = false

  if (isReplacement) {
    const disconnection = await disconnectGoogleConnection({
      db,
      userId,
      clientMode: 'byo',
      logger,
    })

    connectionEnded = disconnection.disconnected
  }

  await saveGoogleByoClient(db, userId, {
    clientId: body.clientId,
    clientSecret: body.clientSecret,
  })

  logger.set({
    attributes: {
      google: {
        byoClient: 'saved',
        clientReplaced: isReplacement,
        connectionEnded,
      },
    },
  })

  event.res.headers.set('cache-control', 'no-store')

  return { saved: true, connectionEnded }
})
