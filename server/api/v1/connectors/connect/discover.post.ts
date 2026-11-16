import { defineEventHandler } from 'nuxt/server'
import {
  connectorTargetSchema,
  resolveConnectTarget,
} from '~~/server/utils/connectors/connect-target'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { issuerHostOf } from '~~/server/utils/connectors/consent'
import { connectorErrorCodeOf } from '~~/server/utils/connectors/errors'
import { discoverConnectorAuth } from '~~/server/utils/connectors/oauth-metadata'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'
import { findConnectorPreset } from '~~/config/connectors-catalog'
import { assertConnectorCapacity } from '~~/server/utils/connectors/store'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * The first step of adding a connector (docs/connectors.md sections 5.1 and
 * 5.2): nothing exists yet, so nothing is stored here, not a row, not a KV
 * entry. The address is checked, the per-user cap is checked before any
 * request goes out, and the same unauthenticated probe and OAuth discovery
 * as the Connect step run. The answer names what the consent screen shows:
 * the host, the issuer host when it differs, the auth kind, the notice of a
 * preset and the title and preset the connector would get.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event)
  const body = await readConnectorBody(event, connectorTargetSchema)
  const db = useDb()
  const logger = useRequestLogger(event)
  const target = await resolveConnectTarget(event, db, body)

  event.res.headers.set('cache-control', 'no-store')

  await assertConnectorCapacity(db, userId)

  let discovery: Awaited<ReturnType<typeof discoverConnectorAuth>>

  try {
    discovery = await discoverConnectorAuth(target.url, logger, {
      allowOAuth: target.allowOAuth,
    })
  } catch (exception) {
    logger.set({
      attributes: {
        connectors: {
          step: 'create-discover',
          code: connectorErrorCodeOf(exception, 'CONNECTOR_DISCOVERY_FAILED'),
          stored: false,
        },
      },
    })

    throw exception
  }

  const issuerHost = discovery.authType === 'oauth'
    ? issuerHostOf(discovery.oauth.issuer)
    : null
  const preset = target.presetId
    ? findConnectorPreset(target.presetId)
    : undefined

  logger.set({
    attributes: {
      connectors: {
        host: target.host,
        step: 'create-discover',
        authType: discovery.authType,
        stored: false,
      },
    },
  })

  return {
    authType: discovery.authType,
    host: target.host,
    title: target.title,
    presetId: target.presetId,
    issuerHost,
    issuerDiffers: issuerHost !== null && issuerHost !== target.host,
    notice: preset?.notice ?? null,
    headerName: preset?.headerName ?? null,
  }
})
