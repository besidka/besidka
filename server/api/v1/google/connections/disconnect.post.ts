import { createError } from 'evlog'
import { defineEventHandler, getRequestHeader } from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'
import { z } from 'zod'
import { GOOGLE_CLIENT_MODES } from '#shared/utils/google-scopes'
import type { GoogleClientMode } from '#shared/utils/google-scopes'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { disconnectGoogleConnection } from '~~/server/utils/google/connection'
import { requireGoogleAccess } from '~~/server/utils/google/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  clientMode: z.enum(GOOGLE_CLIENT_MODES).optional(),
}).optional()

/**
 * The client mode to disconnect. A request without a body (the Google
 * Drive card sends none, and a fetch may omit `Content-Length` or send 0)
 * means Besidka's client, so the existing Disconnect never depends on a
 * body.
 */
async function readClientMode(event: RequestEvent): Promise<GoogleClientMode> {
  const length = Number(getRequestHeader(event, 'content-length') ?? '')

  if (!Number.isFinite(length) || length <= 0) {
    return 'besidka'
  }

  const body = await readConnectorBody(event, bodySchema)

  return body?.clientMode ?? 'besidka'
}

/**
 * Disconnects one Google connection: Besidka's client by default, or the
 * owner's own client with `{ clientMode: 'byo' }`. Revokes the grant at
 * Google (best effort; revoking needs no client secret), clears the tokens
 * and runs the access-ended cleanup before answering. Needs a session and
 * the same-origin guard but no flag and no admin role: ending access only
 * ever removes it, so a user can always end a connection. `revoked` is
 * false when Google did not confirm the revoke; `filesPending` is true
 * when the deletion of Google file copies could not finish and the hourly
 * sweep completes it.
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
    clientMode: await readClientMode(event),
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
