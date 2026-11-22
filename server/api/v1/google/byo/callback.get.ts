import { defineEventHandler } from 'nuxt/server'
import { requireGoogleByoAccess } from '~~/server/utils/google/byo-access'
import { handleGoogleOAuthCallback } from '~~/server/utils/google/callback'

/**
 * Google's redirect target for the owner's own OAuth client, on its own
 * path so the owner's client registers its own redirect URI and a code
 * from it can never reach Besidka's callback. The admin and `google.byo`
 * gate runs again here, and once more when the code is exchanged. Google
 * reaches it through a cross-site top-level redirect, so it skips the
 * cross-site read guard; the single-use state bound to the user and to the
 * `byo` mode protects it. See `handleGoogleOAuthCallback`.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireGoogleByoAccess(event, {
    write: false,
    rateLimit: 'none',
    navigation: true,
  })

  return await handleGoogleOAuthCallback(event, {
    userId,
    clientMode: 'byo',
  })
})
