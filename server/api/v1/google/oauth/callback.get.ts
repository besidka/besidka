import {
  defineEventHandler,
  getQuery,
  getRequestHeader,
  sendRedirect,
} from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'
import {
  GOOGLE_CONNECT_DEFAULT_RETURN_PATH,
  GOOGLE_CONNECT_RESULT_QUERY_KEY,
} from '#shared/utils/google-connections'
import type { GoogleConnectResult } from '#shared/utils/google-connections'
import {
  isCallbackBudgetExhausted,
  recordCallbackFailure,
} from '~~/server/utils/connectors/callback-limit'
import {
  completeGoogleConnection,
  GoogleConnectionError,
} from '~~/server/utils/google/connection'
import { isWellFormedOAuthState } from '~~/server/utils/connectors/oauth-state'
import { consumeGoogleOAuthState } from '~~/server/utils/google/oauth-state'
import {
  googleCallbackClientKey,
  requireGoogleAccess,
} from '~~/server/utils/google/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const FOUND = 302
const URL_PARSE_BASE = 'http://localhost'

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function withResult(returnTo: string, result: GoogleConnectResult): string {
  const url = new URL(returnTo, URL_PARSE_BASE)

  url.searchParams.set(GOOGLE_CONNECT_RESULT_QUERY_KEY, result)

  return `${url.pathname}${url.search}${url.hash}`
}

function finish(
  event: RequestEvent,
  returnTo: string,
  result: GoogleConnectResult,
  reason: string,
) {
  useRequestLogger(event).set({
    attributes: { google: { step: 'callback', outcome: result, reason } },
  })

  return sendRedirect(event, withResult(returnTo, result), FOUND)
}

/**
 * Google's redirect target. Always answers with a redirect to the checked
 * return path plus `?google=<result>`, a fixed value, never Google's text,
 * a token, the code or an email. The state must exist, be unused, be under
 * ten minutes old and belong to the signed-in user; it is deleted on first
 * read. Failures count against a per-IP budget (a SHA-256 of the IP). The
 * request path is logged without its query
 * (`server/plugins/evlog-request-observability.ts`).
 */
export default defineEventHandler(async (event) => {
  const userId = await requireGoogleAccess(event, {
    write: false,
    rateLimit: 'none',
  })
  const query = getQuery(event)
  const state = queryString(query.state)
  const defaultReturn = GOOGLE_CONNECT_DEFAULT_RETURN_PATH

  event.res.headers.set('cache-control', 'no-store')
  event.res.headers.set('referrer-policy', 'no-referrer')

  if (!isWellFormedOAuthState(state)) {
    return finish(event, defaultReturn, 'error', 'state-malformed')
  }

  const kv = useKV()
  const clientKey = await googleCallbackClientKey(
    getRequestHeader(event, 'cf-connecting-ip'),
  )

  if (await isCallbackBudgetExhausted(kv, clientKey)) {
    return finish(event, defaultReturn, 'error', 'rate-limited')
  }

  const oauthState = await consumeGoogleOAuthState(kv, state)

  if (!oauthState) {
    await recordCallbackFailure(kv, clientKey)

    return finish(event, defaultReturn, 'expired', 'state-unknown')
  }

  if (oauthState.userId !== userId) {
    await recordCallbackFailure(kv, clientKey)

    return finish(event, defaultReturn, 'error', 'state-user-mismatch')
  }

  const googleError = queryString(query.error)

  if (googleError) {
    return finish(
      event,
      oauthState.returnTo,
      googleError === 'access_denied' ? 'denied' : 'error',
      googleError === 'access_denied' ? 'denied' : 'google-error',
    )
  }

  const code = queryString(query.code)

  if (!code) {
    await recordCallbackFailure(kv, clientKey)

    return finish(event, oauthState.returnTo, 'error', 'code-missing')
  }

  try {
    const result = await completeGoogleConnection({
      db: useDb(),
      oauthState,
      code,
      logger: useRequestLogger(event),
    })

    return finish(event, oauthState.returnTo, result, result)
  } catch (exception) {
    await recordCallbackFailure(kv, clientKey)

    return finish(
      event,
      oauthState.returnTo,
      'error',
      exception instanceof GoogleConnectionError
        ? exception.code
        : 'GOOGLE_CONNECT_FAILED',
    )
  }
})
