import { defineEventHandler } from 'nuxt/server'
import type { GoogleConnectionStatusResponse } from '#shared/utils/google-connections'
import { isDedicatedGoogleClientConfigured } from '~~/server/utils/google/client'
import {
  isGoogleFeatureActive,
  requireGoogleAccess,
} from '~~/server/utils/google/route'
import {
  readGoogleConnection,
  toGoogleConnectionSummary,
} from '~~/server/utils/google/store'

/**
 * The Google connection of Besidka's client mode as the API Keys page
 * shows it: status, the Google account's email, the granted capabilities
 * and when it was connected; `canConnect` says whether `google.drive` is
 * active for the user, and `dedicatedClient` whether Drive runs on its own
 * OAuth client (no ids). Needs only a session, so a connected user always
 * sees the connection. A `revoked` row (a disconnect whose cleanup is still
 * running) reads as not connected. Never returns a token.
 */
export default defineEventHandler(async (
  event,
): Promise<GoogleConnectionStatusResponse> => {
  const userId = await requireGoogleAccess(event, {
    write: false,
    rateLimit: 'read',
    feature: false,
  })
  const record = await readGoogleConnection(useDb(), userId, 'besidka')
  const canConnect = await isGoogleFeatureActive(event)

  event.res.headers.set('cache-control', 'private, no-store')

  return {
    connection: record && record.status !== 'revoked'
      ? toGoogleConnectionSummary(record)
      : null,
    canConnect,
    dedicatedClient: isDedicatedGoogleClientConfigured(),
  }
})
