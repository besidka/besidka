import { defineEventHandler } from 'nuxt/server'
import {
  connectorErrorCodeOf,
  createConnectorError,
} from '~~/server/utils/connectors/errors'
import { startConnectorOAuth } from '~~/server/utils/connectors/oauth-flow'
import {
  requireConnectorAccess,
  requireOwnedConnector,
} from '~~/server/utils/connectors/route'
import { readConnectorUrl } from '~~/server/utils/connectors/store'
import { assertNotCrossSiteRequest } from '~~/server/utils/cross-site-guard'
import { requireLegalConsent } from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { resolveRequestPublicOrigin } from '~~/server/utils/request-public-origin'

/**
 * Starts the OAuth sign-in of a connector and returns the authorization URL
 * for the browser to open (`window.location.assign`). The redirect URI and
 * the CIMD client id use the same origin, so a flow started on a preview
 * host ends there.
 */
export default defineEventHandler(async (event) => {
  assertNotCrossSiteRequest(event)

  const userId = await requireConnectorAccess(event, { oauth: true })
  const connector = await requireOwnedConnector(event, userId)
  const logger = useRequestLogger(event)
  const db = useDb()

  await requireLegalConsent(userId, db)

  const serverUrl = await readConnectorUrl(db, userId, connector.id)

  if (!serverUrl) {
    throw createConnectorError('CONNECTOR_NOT_FOUND')
  }

  event.res.headers.set('cache-control', 'no-store')

  try {
    return await startConnectorOAuth({
      db,
      kv: useKV(),
      userId,
      connector,
      serverUrl,
      origin: resolveRequestPublicOrigin(event),
      logger,
    })
  } catch (exception) {
    logger.set({
      attributes: {
        connectors: {
          step: 'oauth-start',
          code: connectorErrorCodeOf(exception, 'CONNECTOR_DISCOVERY_FAILED'),
        },
      },
    })

    throw exception
  }
})
