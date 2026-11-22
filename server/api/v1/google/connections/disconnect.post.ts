import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { disconnectGoogleConnection } from '~~/server/utils/google/connection'
import { requireGoogleAccess } from '~~/server/utils/google/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * Disconnects Google Drive: revokes the grant at Google (best effort),
 * clears the tokens and deletes the Drive files copied into Besidka
 * before answering. Needs a session and the same-origin guard but not the
 * `google.drive` flag, so a user can always end a connection. `revoked`
 * is false when Google did not confirm the revoke; `filesPending` is true
 * when the deletion could not finish and the hourly sweep completes it.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireGoogleAccess(event, {
    write: true,
    rateLimit: 'write',
    feature: false,
  })
  const result = await disconnectGoogleConnection({
    db: useDb(),
    userId,
    clientMode: 'besidka',
    logger: useRequestLogger(event),
  })

  event.res.headers.set('cache-control', 'no-store')

  if (!result.disconnected) {
    throw createError({
      message: 'Google is not connected',
      status: 404,
      why: 'There is no Google connection to disconnect',
      fix: 'Reload the page',
    })
  }

  return {
    disconnected: true,
    revoked: result.revoked,
    filesDeleted: result.filesDeleted,
    filesPending: result.filesPending,
  }
})
