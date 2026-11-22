import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { requireGoogleByoAccess } from '~~/server/utils/google/byo-access'
import { deleteGoogleByoClient } from '~~/server/utils/google/byo-client'
import { disconnectGoogleConnection } from '~~/server/utils/google/connection'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * Deletes the owner's own Google OAuth client (admin and `google.byo`
 * only). A connection made with it ends first, exactly like Disconnect:
 * the grant is revoked at Google (best effort; revoking needs no client
 * secret), the tokens are cleared and the access-ended cleanup runs. Then
 * the stored client id and secret are deleted.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireGoogleByoAccess(event, {
    write: true,
    rateLimit: 'write',
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
