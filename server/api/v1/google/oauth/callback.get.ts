import { defineEventHandler } from 'nuxt/server'
import { handleGoogleOAuthCallback } from '~~/server/utils/google/callback'
import { requireGoogleAccess } from '~~/server/utils/google/route'

/**
 * Google's redirect target for Besidka's client. Google reaches it through
 * a cross-site top-level redirect, so it skips the cross-site read guard
 * (`navigation: true`); the single-use state bound to the user and the
 * client mode protects it instead. See `handleGoogleOAuthCallback`.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireGoogleAccess(event, {
    write: false,
    rateLimit: 'none',
    navigation: true,
  })

  return await handleGoogleOAuthCallback(event, {
    userId,
    clientMode: 'besidka',
  })
})
