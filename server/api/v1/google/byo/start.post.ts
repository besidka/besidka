import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import { resolveSafeNextPath } from '#shared/utils/auth-redirect'
import {
  GOOGLE_BYO_CAPABILITIES,
  getGoogleByoScopes,
} from '#shared/utils/google-byo'
import { GOOGLE_CONNECT_DEFAULT_RETURN_PATH } from '#shared/utils/google-connections'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { requireGoogleByoAccess } from '~~/server/utils/google/byo-access'
import { startGoogleConnection } from '~~/server/utils/google/connection'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { resolveRequestPublicOrigin } from '~~/server/utils/request-public-origin'

const RETURN_TO_MAX_LENGTH = 200

const bodySchema = z.object({
  capabilities: z
    .array(z.enum(GOOGLE_BYO_CAPABILITIES))
    .min(1)
    .max(GOOGLE_BYO_CAPABILITIES.length),
  returnTo: z.string().max(RETURN_TO_MAX_LENGTH).optional(),
})

/**
 * Starts connecting Google with the owner's own OAuth client and returns
 * Google's consent URL. Admin and `google.byo` only. The body names
 * capabilities (`drive-read`, `gmail-read`, `gmail-compose`, `calendar`),
 * never scope strings; the server maps them through the scope map. The
 * redirect URI is this request's public origin plus
 * `/api/v1/google/byo/callback`.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireGoogleByoAccess(event, {
    write: true,
    rateLimit: 'write',
  })
  const body = await readConnectorBody(event, bodySchema)

  event.res.headers.set('cache-control', 'no-store')

  return await startGoogleConnection({
    db: useDb(),
    kv: useKV(),
    userId,
    clientMode: 'byo',
    origin: resolveRequestPublicOrigin(event),
    returnTo: resolveSafeNextPath(body.returnTo)
      ?? GOOGLE_CONNECT_DEFAULT_RETURN_PATH,
    capabilityScopes: getGoogleByoScopes(body.capabilities),
    logger: useRequestLogger(event),
  })
})
