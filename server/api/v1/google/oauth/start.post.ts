import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import { resolveSafeNextPath } from '#shared/utils/auth-redirect'
import { GOOGLE_CONNECT_DEFAULT_RETURN_PATH } from '#shared/utils/google-connections'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { startGoogleConnection } from '~~/server/utils/google/connection'
import { requireGoogleAccess } from '~~/server/utils/google/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { resolveRequestPublicOrigin } from '~~/server/utils/request-public-origin'

const RETURN_TO_MAX_LENGTH = 200

const bodySchema = z.object({
  returnTo: z.string().max(RETURN_TO_MAX_LENGTH).optional(),
})

/**
 * Starts connecting Google Drive with Besidka's OAuth client and returns
 * Google's consent URL for the browser to open. The redirect URI is built
 * from this request's public origin, so a pull-request preview gets its
 * own callback; `returnTo` must pass `resolveSafeNextPath`, otherwise the
 * Google tab of the API Keys page is used.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireGoogleAccess(event, {
    write: true,
    rateLimit: 'write',
  })
  const body = await readConnectorBody(event, bodySchema)

  event.res.headers.set('cache-control', 'no-store')

  return await startGoogleConnection({
    db: useDb(),
    kv: useKV(),
    userId,
    clientMode: 'besidka',
    origin: resolveRequestPublicOrigin(event),
    returnTo: resolveSafeNextPath(body.returnTo)
      ?? GOOGLE_CONNECT_DEFAULT_RETURN_PATH,
    logger: useRequestLogger(event),
  })
})
