import { defineEventHandler, sendRedirect } from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'
import { GOOGLE_BYO_RESULT_QUERY_KEY } from '#shared/utils/google-byo'
import { GOOGLE_CONNECT_DEFAULT_RETURN_PATH } from '#shared/utils/google-connections'
import { requireGoogleByoAccess } from '~~/server/utils/google/byo-access'
import { handleGoogleOAuthCallback } from '~~/server/utils/google/callback'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const FOUND = 302

async function passGate(event: RequestEvent): Promise<number | null> {
  try {
    return await requireGoogleByoAccess(event, {
      write: false,
      rateLimit: 'none',
      navigation: true,
    })
  } catch (exception) {
    const status = (exception as { status?: unknown }).status

    useRequestLogger(event).set({
      attributes: {
        google: {
          step: 'callback',
          clientMode: 'byo',
          outcome: 'error',
          reason: 'gate-refused',
          gateStatus: typeof status === 'number' ? status : null,
        },
      },
    })

    return null
  }
}

/**
 * Google's redirect target for the owner's own OAuth client, on its own
 * path so the owner's client registers its own redirect URI and a code
 * from it can never reach Besidka's callback. The admin and `google.byo`
 * gate runs again here, and once more when the code is exchanged. The
 * browser arrives through a top-level navigation, so a refused gate (signed
 * out, no longer admin, flag off) redirects to the Google tab with
 * `?google-byo=error` instead of showing a raw error page; the state is not
 * read, and it expires within ten minutes. Google reaches this path
 * through a cross-site redirect, so it skips the cross-site read guard;
 * the single-use state bound to the user and to the `byo` mode protects
 * it. See `handleGoogleOAuthCallback`.
 */
export default defineEventHandler(async (event) => {
  const userId = await passGate(event)

  if (userId === null) {
    event.res.headers.set('cache-control', 'no-store')
    event.res.headers.set('referrer-policy', 'no-referrer')

    const url = new URL(GOOGLE_CONNECT_DEFAULT_RETURN_PATH, 'http://localhost')

    url.searchParams.set(GOOGLE_BYO_RESULT_QUERY_KEY, 'error')

    return sendRedirect(event, `${url.pathname}${url.search}`, FOUND)
  }

  return await handleGoogleOAuthCallback(event, {
    userId,
    clientMode: 'byo',
  })
})
