import { getQuery, getRequestHeader, sendRedirect } from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'
import { GOOGLE_BYO_RESULT_QUERY_KEY } from '#shared/utils/google-byo'
import {
  GOOGLE_CONNECT_DEFAULT_RETURN_PATH,
  GOOGLE_CONNECT_RESULT_QUERY_KEY,
} from '#shared/utils/google-connections'
import type { GoogleConnectResult } from '#shared/utils/google-connections'
import type { GoogleClientMode } from '#shared/utils/google-scopes'
import {
  isCallbackBudgetExhausted,
  recordCallbackFailure,
} from '~~/server/utils/connectors/callback-limit'
import { isWellFormedOAuthState } from '~~/server/utils/connectors/oauth-state'
import {
  completeGoogleConnection,
  GoogleConnectionError,
  startGoogleConnection,
} from '~~/server/utils/google/connection'
import { consumeGoogleOAuthState } from '~~/server/utils/google/oauth-state'
import { googleCallbackClientKey } from '~~/server/utils/google/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { resolveRequestPublicOrigin } from '~~/server/utils/request-public-origin'

const FOUND = 302
const URL_PARSE_BASE = 'http://localhost'

const RESULT_QUERY_KEYS: Readonly<Record<GoogleClientMode, string>> = {
  besidka: GOOGLE_CONNECT_RESULT_QUERY_KEY,
  byo: GOOGLE_BYO_RESULT_QUERY_KEY,
}

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function withResult(
  returnTo: string,
  clientMode: GoogleClientMode,
  result: GoogleConnectResult,
): string {
  const url = new URL(returnTo, URL_PARSE_BASE)

  url.searchParams.set(RESULT_QUERY_KEYS[clientMode], result)

  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Google's redirect target for one client mode, after the route's own
 * gate. Always answers with a redirect to the checked return path plus
 * `?google=<result>` (`?google-byo=<result>` for the bring-your-own
 * client), a fixed value, never Google's text, a token, the code or an
 * email. The state must exist, be unused, be under ten minutes old, belong
 * to the signed-in user and carry the client mode of this callback path:
 * a bring-your-own state is refused on Besidka's callback and the reverse,
 * so a code is only ever exchanged with the client that asked for it. The
 * state is deleted on first read. When Google sent no refresh token and
 * none can be kept, it sends the user back to Google once with
 * `prompt=consent` (a new state) instead of changing anything. Failures
 * count against a per-IP budget (a SHA-256 of the IP). The request path is
 * logged without its query (`server/plugins/evlog-request-observability.ts`).
 */
export async function handleGoogleOAuthCallback(
  event: RequestEvent,
  input: { userId: number, clientMode: GoogleClientMode },
) {
  const { userId, clientMode } = input
  const logger = useRequestLogger(event)
  const query = getQuery(event)
  const state = queryString(query.state)
  const defaultReturn = GOOGLE_CONNECT_DEFAULT_RETURN_PATH

  function finish(
    returnTo: string,
    result: GoogleConnectResult,
    reason: string,
  ) {
    logger.set({
      attributes: {
        google: { step: 'callback', clientMode, outcome: result, reason },
      },
    })

    return sendRedirect(
      event,
      withResult(returnTo, clientMode, result),
      FOUND,
    )
  }

  event.res.headers.set('cache-control', 'no-store')
  event.res.headers.set('referrer-policy', 'no-referrer')

  if (!isWellFormedOAuthState(state)) {
    return finish(defaultReturn, 'error', 'state-malformed')
  }

  const kv = useKV()
  const clientKey = await googleCallbackClientKey(
    getRequestHeader(event, 'cf-connecting-ip'),
  )

  if (await isCallbackBudgetExhausted(kv, clientKey)) {
    return finish(defaultReturn, 'error', 'rate-limited')
  }

  const oauthState = await consumeGoogleOAuthState(kv, state)

  if (!oauthState) {
    await recordCallbackFailure(kv, clientKey)

    return finish(defaultReturn, 'expired', 'state-unknown')
  }

  if (oauthState.userId !== userId) {
    await recordCallbackFailure(kv, clientKey)

    return finish(defaultReturn, 'error', 'state-user-mismatch')
  }

  if (oauthState.clientMode !== clientMode) {
    await recordCallbackFailure(kv, clientKey)

    return finish(defaultReturn, 'error', 'state-mode-mismatch')
  }

  const googleError = queryString(query.error)

  if (googleError) {
    return finish(
      oauthState.returnTo,
      googleError === 'access_denied' ? 'denied' : 'error',
      googleError === 'access_denied' ? 'denied' : 'google-error',
    )
  }

  const code = queryString(query.code)

  if (!code) {
    await recordCallbackFailure(kv, clientKey)

    return finish(oauthState.returnTo, 'error', 'code-missing')
  }

  try {
    const db = useDb()
    const completion = await completeGoogleConnection({
      db,
      oauthState,
      code,
      logger,
    })

    if (completion.kind === 'done') {
      return finish(oauthState.returnTo, completion.result, completion.result)
    }

    const restart = await startGoogleConnection({
      db,
      kv,
      userId,
      clientMode: oauthState.clientMode,
      origin: resolveRequestPublicOrigin(event),
      returnTo: oauthState.returnTo,
      logger,
      capabilityScopes: oauthState.requestedScopes,
      forceConsent: true,
    })

    return sendRedirect(event, restart.authorizationUrl, FOUND)
  } catch (exception) {
    await recordCallbackFailure(kv, clientKey)

    return finish(
      oauthState.returnTo,
      'error',
      exception instanceof GoogleConnectionError
        ? exception.code
        : 'GOOGLE_CONNECT_FAILED',
    )
  }
}
