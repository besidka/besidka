import { defineEventHandler } from 'nuxt/server'
import { isConnectorConsentCurrent } from '~~/server/utils/connectors/consent'
import {
  ICON_BUSY_CACHE_SECONDS,
  iconImageResponse,
  iconMissResponse,
} from '~~/server/utils/connectors/icon-response'
import {
  CONNECTOR_ICON_BUSY,
  resolveConnectorIcon,
} from '~~/server/utils/connectors/icon'
import {
  requireConnectorAccess,
  requireOwnedConnector,
} from '~~/server/utils/connectors/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * The icon of one of the user's connectors, for the reasoning steps. The
 * chat never loads a remote image: this route serves the copy Besidka kept
 * (declared by the server, or its favicon) from the app's own origin. It
 * answers only to the owner, only for a connector with current consent that
 * is connected, and 404s for everything else, a missing icon included, so
 * the client falls back to a letter.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event, {
    write: false,
    icon: true,
  })
  const connector = await requireOwnedConnector(event, userId)
  const isEligible = isConnectorConsentCurrent(connector)
    && (connector.status === 'ready' || connector.status === 'drifted')

  if (!isEligible) {
    return iconMissResponse()
  }

  const image = await resolveConnectorIcon(
    useKV(),
    { id: connector.id, origin: connector.origin },
    { logger: useRequestLogger(event) },
  )

  if (image === CONNECTOR_ICON_BUSY) {
    return iconMissResponse(ICON_BUSY_CACHE_SECONDS)
  }

  return image ? iconImageResponse(image) : iconMissResponse()
})
