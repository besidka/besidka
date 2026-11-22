import { defineEventHandler } from 'nuxt/server'
import type { GoogleConnectionSummary } from '#shared/utils/google-connections'
import { requireGoogleAccess } from '~~/server/utils/google/route'
import {
  readGoogleConnection,
  toGoogleConnectionSummary,
} from '~~/server/utils/google/store'

/**
 * The Google connection of Besidka's client mode as the API Keys page
 * shows it: status, the Google account's email, the granted capabilities
 * and when it was connected. A `revoked` row (a disconnect whose cleanup
 * is still running) reads as not connected. Never returns a token.
 */
export default defineEventHandler(async (event): Promise<{
  connection: GoogleConnectionSummary | null
}> => {
  const userId = await requireGoogleAccess(event, {
    write: false,
    rateLimit: 'read',
  })
  const record = await readGoogleConnection(useDb(), userId, 'besidka')

  event.res.headers.set('cache-control', 'private, no-store')

  if (!record || record.status === 'revoked') {
    return { connection: null }
  }

  return { connection: toGoogleConnectionSummary(record) }
})
