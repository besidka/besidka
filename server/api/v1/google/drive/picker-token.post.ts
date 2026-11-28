import { defineEventHandler } from 'nuxt/server'
import {
  isConnectorsFeatureActive,
  requireGoogleAccess,
} from '~~/server/utils/google/route'
import { createGooglePickerToken } from '~~/server/utils/google/picker-token'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * Hands the browser a short-lived access token for Google's Picker, with the
 * public API key and the project number the Picker needs. Besidka's own
 * client only, never the refresh token, never cached, never logged. The
 * flag, the same-origin write guard and 30 requests a minute apply.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireGoogleAccess(event, {
    write: true,
    rateLimit: 'picker',
  })
  const config = useRuntimeConfig().public

  event.res.headers.set('cache-control', 'no-store')
  event.res.headers.set('pragma', 'no-cache')
  event.res.headers.set('referrer-policy', 'no-referrer')

  return await createGooglePickerToken({
    db: useDb(),
    kv: useKV(),
    userId,
    clientMode: 'besidka',
    apiKey: String(config.googlePickerApiKey || ''),
    projectNumber: String(config.googleCloudProjectNumber || ''),
    isConnectorsActive: await isConnectorsFeatureActive(event),
    logger: useRequestLogger(event),
  })
})
