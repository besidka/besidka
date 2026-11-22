import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { deleteGoogleByoClient } from '~~/server/utils/google/byo-client'
import { disconnectGoogleConnection } from '~~/server/utils/google/connection'
import { requireGoogleAccess } from '~~/server/utils/google/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * Deletes the stored own Google OAuth client. Removal only, so it needs the
 * session and the same-origin guard but neither the admin role nor
 * `google.byo`, like Disconnect: a former admin can always remove the
 * secret they left behind. A connection made with the client ends first,
 * exactly like Disconnect: the grant is revoked at Google (best effort;
 * revoking needs no client secret), the tokens are cleared and the
 * access-ended cleanup runs. If the connection cannot even be read, the
 * request fails and nothing is deleted, so no live token is ever left
 * without its client.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireGoogleAccess(event, {
    write: true,
    rateLimit: 'write',
    feature: false,
  })
  const db = useDb()
  const logger = useRequestLogger(event)
  const disconnection = await disconnectGoogleConnection({
    db,
    userId,
    clientMode: 'byo',
    logger,
  })
  const deleted = await deleteGoogleByoClient(db, userId)

  logger.set({
    attributes: {
      google: {
        byoClient: deleted ? 'deleted' : 'missing',
        connectionEnded: disconnection.disconnected,
      },
    },
  })

  event.res.headers.set('cache-control', 'no-store')

  if (!deleted && !disconnection.disconnected) {
    throw createError({
      message: 'No Google OAuth client is saved',
      status: 404,
      why: 'There is no client of your own to delete',
      fix: 'Reload the page',
    })
  }

  return {
    deleted,
    connectionEnded: disconnection.disconnected,
    revoked: disconnection.revoked,
  }
})
