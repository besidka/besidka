import { defineEventHandler, getQuery, sendRedirect } from 'nuxt/server'
import { CONNECTOR_PAGE_PATH } from '#shared/utils/connectors-policy'
import { connectorErrorCodeOf } from '~~/server/utils/connectors/errors'
import { completeConnectorOAuth } from '~~/server/utils/connectors/oauth-flow'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { resolveRequestPublicOrigin } from '~~/server/utils/request-public-origin'

const FOUND = 302

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * The OAuth redirect target. Always answers with a redirect to the
 * Connectors page, `?connected=<id>` or `?error=<code>` with a fixed code,
 * never upstream text. The code, the state and `iss` are never logged; the
 * request path is logged without its query
 * (`server/plugins/evlog-request-observability.ts`).
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event, { oauth: true })
  const logger = useRequestLogger(event)
  const query = getQuery(event)

  event.res.headers.set('cache-control', 'no-store')
  event.res.headers.set('referrer-policy', 'no-referrer')

  try {
    const result = await completeConnectorOAuth({
      db: useDb(),
      kv: useKV(),
      userId,
      origin: resolveRequestPublicOrigin(event),
      query: {
        state: queryString(query.state),
        code: queryString(query.code),
        iss: queryString(query.iss),
        error: queryString(query.error),
      },
      logger,
    })

    return sendRedirect(
      event,
      `${CONNECTOR_PAGE_PATH}?connected=${encodeURIComponent(result.connectorId)}`,
      FOUND,
    )
  } catch (exception) {
    const code = connectorErrorCodeOf(exception, 'CONNECTOR_OAUTH_TOKEN_FAILED')

    logger.set({
      attributes: { connectors: { step: 'oauth-callback', code } },
    })

    return sendRedirect(
      event,
      `${CONNECTOR_PAGE_PATH}?error=${encodeURIComponent(code)}`,
      FOUND,
    )
  }
})
