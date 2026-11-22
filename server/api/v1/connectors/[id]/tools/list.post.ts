import { defineEventHandler } from 'nuxt/server'
import type { ConnectorToolsListing } from '#shared/types/connectors.d'
import {
  CONNECTOR_ERRORS,
  connectorErrorCodeOf,
  isConnectorErrorCode,
} from '~~/server/utils/connectors/errors'
import {
  requireConnectorAccess,
  requireOwnedConnector,
} from '~~/server/utils/connectors/route'
import { planConnectorToolsReview } from '~~/server/utils/connectors/tool-review'
import { requireLegalConsent } from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

function unavailable(code: string): ConnectorToolsListing {
  const text = isConnectorErrorCode(code)
    ? CONNECTOR_ERRORS[code]
    : CONNECTOR_ERRORS.CONNECTOR_UNREACHABLE

  return { state: 'unavailable', code, message: text.message }
}

/**
 * The connector's tools for the Connectors page, compared with the reviewed
 * baseline (docs/connectors.md section 6.1). A POST, not a GET: it can sign
 * in to the server with the stored token, so it runs the same-origin write
 * guard. It shares the looser bucket of the picker toggles (60 a minute).
 * A connector that is not connected, has no current consent or cannot be
 * reached answers `unavailable` with a fixed code and message.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event, { selection: true })
  const connector = await requireOwnedConnector(event, userId)
  const logger = useRequestLogger(event)
  const db = useDb()

  event.res.headers.set('cache-control', 'no-store')

  if (connector.status === 'needs-auth' || !connector.authType) {
    return unavailable('CONNECTOR_NOT_READY')
  }

  await requireLegalConsent(userId, db)

  try {
    const plan = await planConnectorToolsReview({
      db,
      kv: useKV(),
      userId,
      connector,
      logger,
    })

    logger.set({
      attributes: {
        connectors: {
          step: 'tools-list',
          tools: plan.review.counts.total,
          pending: plan.review.counts.pending,
        },
      },
    })

    return plan.review as ConnectorToolsListing
  } catch (exception) {
    const code = connectorErrorCodeOf(exception, 'CONNECTOR_UNREACHABLE')

    logger.set({
      attributes: { connectors: { step: 'tools-list', code } },
    })

    return unavailable(code)
  }
})
