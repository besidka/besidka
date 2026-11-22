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

function unclearBody() {
  return createError({
    message: 'Invalid request',
    status: 400,
    why: 'The request has a body that is not JSON',
    fix: 'Send no body, or a JSON body with the client mode',
  })
}

/**
 * The client mode to disconnect, never guessed in the destructive
 * direction. A JSON body is always parsed (and refused with 411 when it
 * declares no `Content-Length`), so `{ clientMode: 'byo' }` can never end
 * Besidka's connection by losing a header. Only a request that clearly
 * has no body (no content type, no transfer encoding, and no or a zero
 * `Content-Length`; the Google Drive card sends none) means Besidka's
 * client. Any other body is refused.
 */
async function readClientMode(event: RequestEvent): Promise<GoogleClientMode> {
  const contentType = getRequestHeader(event, 'content-type') ?? ''

  if (contentType.toLowerCase().includes('application/json')) {
    const body = await readConnectorBody(event, bodySchema)

    return body?.clientMode ?? 'besidka'
  }

  const contentLength = getRequestHeader(event, 'content-length')
  const isBodyless = !contentType
    && !getRequestHeader(event, 'transfer-encoding')
    && (!contentLength || contentLength.trim() === '0')

  if (!isBodyless) {
    throw unclearBody()
  }

  return 'besidka'
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
