import {
  defineEventHandler,
  getQuery,
  getRequestHeader,
  sendRedirect,
} from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'
import { CONNECTOR_PAGE_PATH } from '#shared/utils/connectors-policy'
import {
  callbackClientKey,
  isCallbackBudgetExhausted,
  recordCallbackFailure,
} from '~~/server/utils/connectors/callback-limit'
import { connectorErrorCodeOf } from '~~/server/utils/connectors/errors'
import { completeConnectorOAuth } from '~~/server/utils/connectors/oauth-flow'
import { isWellFormedOAuthState } from '~~/server/utils/connectors/oauth-state'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { resolveRequestPublicOrigin } from '~~/server/utils/request-public-origin'

const FOUND = 302

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function redirectWithError(event: RequestEvent, code: string) {
  useRequestLogger(event).set({
    attributes: { connectors: { step: 'oauth-callback', code } },
  })

  return sendRedirect(
    event,
    `${CONNECTOR_PAGE_PATH}?error=${encodeURIComponent(code)}`,
    FOUND,
  )
}

/**
 * The OAuth redirect target. Always answers with a redirect to the
 * Connectors page, `?connected=<id>` or `?error=<code>` with a fixed code,
 * never upstream text and never a 429 page. It does not spend the user's
 * shared connector limit: a malformed state is refused before any KV read,
 * and failures count against a separate per-IP budget. The code, the state
 * and `iss` are never logged by evlog; the request path is logged without
 * its query (`server/plugins/evlog-request-observability.ts`).
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event, {
    oauth: true,
    rateLimit: false,
    write: false,
  })
  const query = getQuery(event)
  const state = queryString(query.state)

  event.res.headers.set('cache-control', 'no-store')
  event.res.headers.set('referrer-policy', 'no-referrer')

  if (!isWellFormedOAuthState(state)) {
    return redirectWithError(event, 'CONNECTOR_OAUTH_STATE_INVALID')
  }

  const kv = useKV()
  const clientKey = await callbackClientKey(
    getRequestHeader(event, 'cf-connecting-ip'),
  )

  if (await isCallbackBudgetExhausted(kv, clientKey)) {
    return redirectWithError(event, 'CONNECTOR_OAUTH_RATE_LIMITED')
  }

  try {
    const result = await completeConnectorOAuth({
      db: useDb(),
      kv,
      userId,
      origin: resolveRequestPublicOrigin(event),
      query: {
        state,
        code: queryString(query.code),
        iss: queryString(query.iss),
        error: queryString(query.error),
      },
      logger: useRequestLogger(event),
    })

    return sendRedirect(
      event,
      `${CONNECTOR_PAGE_PATH}?connected=${encodeURIComponent(result.connectorId)}`,
      FOUND,
    )
  } catch (exception) {
    await recordCallbackFailure(kv, clientKey)

    return redirectWithError(
      event,
      connectorErrorCodeOf(exception, 'CONNECTOR_OAUTH_TOKEN_FAILED'),
    )
  }
})
