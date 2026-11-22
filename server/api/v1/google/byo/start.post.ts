import { defineEventHandler } from 'nuxt/server'
import { createError } from 'evlog'
import { z } from 'zod'
import { resolveSafeNextPath } from '#shared/utils/auth-redirect'
import {
  GOOGLE_BYO_CAPABILITIES,
  GOOGLE_CALENDAR_FEATURE_FLAG,
  getGoogleByoScopes,
} from '#shared/utils/google-byo'
import { GOOGLE_CONNECT_DEFAULT_RETURN_PATH } from '#shared/utils/google-connections'
import { getCapabilityScopes } from '#shared/utils/google-scopes'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import {
  checkGoogleByoAccess,
  requireGoogleByoAccess,
} from '~~/server/utils/google/byo-access'
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
 * `/api/v1/google/byo/callback`. The `calendar` capability is refused with a
 * 403 unless `google.calendar` is also active for the owner (the flag and
 * its Labs opt-in), and while it is not active the two Calendar scopes are
 * left out of the request even when the stored grant holds them, so they are
 * never requested without it.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireGoogleByoAccess(event, {
    write: true,
    rateLimit: 'write',
  })
  const body = await readConnectorBody(event, bodySchema)
  const logger = useRequestLogger(event)

  const calendarVerdict = await checkGoogleByoAccess({
    db: useDb(),
    userId,
    logger,
    requiredFlags: [GOOGLE_CALENDAR_FEATURE_FLAG],
  })
  const isCalendarAllowed = calendarVerdict === 'allowed'

  if (body.capabilities.includes('calendar') && !isCalendarAllowed) {
    logger.set({ attributes: { google: { byoGate: calendarVerdict } } })

    throw createError({
      message: 'Google Calendar is not turned on',
      status: 403,
      why: 'The calendar capability needs the Google Calendar flag and '
        + 'its opt-in',
      fix: 'Turn on Google Calendar in Labs, then connect again',
    })
  }

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
    ...(isCalendarAllowed
      ? {}
      : { excludedScopes: getCapabilityScopes(['calendar']) }),
    logger,
  })
})
