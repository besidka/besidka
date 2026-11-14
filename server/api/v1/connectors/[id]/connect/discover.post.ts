import { defineEventHandler } from 'nuxt/server'
import { findConnectorPreset } from '~~/config/connectors-catalog'
import { issuerHostOf } from '~~/server/utils/connectors/consent'
import {
  connectorErrorCodeOf,
  createConnectorError,
} from '~~/server/utils/connectors/errors'
import { discoverConnectorAuth } from '~~/server/utils/connectors/oauth-metadata'
import {
  requireConnectorAccess,
  requireOwnedConnector,
} from '~~/server/utils/connectors/route'
import {
  readConnectorCredentials,
  readConnectorUrl,
  updateConnector,
} from '~~/server/utils/connectors/store'
import { assertNotCrossSiteRequest } from '~~/server/utils/cross-site-guard'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * The Connect button's first step (docs/connectors.md section 5.2): one
 * unauthenticated MCP request, then protected-resource and
 * authorization-server discovery when the server asks for OAuth. Returns
 * what the consent screen names: the server host, the issuer host when it
 * differs, the auth kind and the preset notice.
 */
export default defineEventHandler(async (event) => {
  assertNotCrossSiteRequest(event)

  const userId = await requireConnectorAccess(event)
  const connector = await requireOwnedConnector(event, userId)
  const logger = useRequestLogger(event)
  const db = useDb()
  const serverUrl = await readConnectorUrl(db, userId, connector.id)

  if (!serverUrl) {
    throw createConnectorError('CONNECTOR_NOT_FOUND')
  }

  event.res.headers.set('cache-control', 'no-store')

  let discovery: Awaited<ReturnType<typeof discoverConnectorAuth>>

  try {
    discovery = await discoverConnectorAuth(serverUrl, logger)
  } catch (exception) {
    logger.set({
      attributes: {
        connectors: {
          step: 'discover',
          code: connectorErrorCodeOf(exception, 'CONNECTOR_DISCOVERY_FAILED'),
        },
      },
    })

    throw exception
  }

  const credentials = await readConnectorCredentials(db, userId, connector.id)

  if (!credentials) {
    await updateConnector(db, userId, connector.id, discovery.authType === 'none'
      ? { authType: 'none', status: 'ready', lastError: null }
      : { authType: discovery.authType })
  }

  const host = new URL(connector.origin).host
  const issuerHost = discovery.authType === 'oauth'
    ? issuerHostOf(discovery.oauth.issuer)
    : null

  logger.set({
    attributes: {
      connectors: { step: 'discover', authType: discovery.authType },
    },
  })

  return {
    authType: discovery.authType,
    host,
    issuerHost,
    issuerDiffers: issuerHost !== null && issuerHost !== host,
    notice: connector.presetId
      ? findConnectorPreset(connector.presetId)?.notice ?? null
      : null,
  }
})
