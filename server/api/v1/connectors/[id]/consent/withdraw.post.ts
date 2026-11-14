import { defineEventHandler } from 'nuxt/server'
import {
  requireConnectorAccess,
  requireOwnedConnector,
} from '~~/server/utils/connectors/route'
import { updateConnector } from '~~/server/utils/connectors/store'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * Withdraws the per-connector consent and turns the connector off, so
 * nothing more is sent to the server until the user consents again.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event)
  const connector = await requireOwnedConnector(event, userId)
  const updated = await updateConnector(useDb(), userId, connector.id, {
    enabled: false,
    consentWithdrawnAt: new Date(),
  })

  useRequestLogger(event).set({
    attributes: {
      legalConsent: {
        action: 'connector-withdrawn',
        connectorId: connector.id,
        host: new URL(connector.origin).host,
      },
    },
  })

  return { connector: updated }
})
