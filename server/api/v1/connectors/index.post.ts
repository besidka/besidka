import { defineEventHandler, setResponseStatus } from 'nuxt/server'
import { z } from 'zod'
import {
  CONNECTOR_HEADER_VALUE_MAX_BYTES,
} from '#shared/utils/connectors-policy'
import { findConnectorPreset } from '~~/config/connectors-catalog'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import {
  assertCurrentConsentVersion,
  connectorConsentSchema,
  connectorTargetShape,
  connectorToolModeSchema,
  resolveConnectTarget,
} from '~~/server/utils/connectors/connect-target'
import { isValidConnectorHeader } from '~~/server/utils/connectors/credentials'
import {
  connectorErrorCodeOf,
  createConnectorError,
} from '~~/server/utils/connectors/errors'
import {
  discoverConnectorAuth,
  verifyConnectorCredentialHeader,
} from '~~/server/utils/connectors/oauth-metadata'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'
import {
  assertConnectorCapacity,
  createConnector,
  deleteConnector,
  replaceConnectorCredentials,
} from '~~/server/utils/connectors/store'
import { requireLegalConsent } from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  ...connectorTargetShape,
  toolMode: connectorToolModeSchema.optional(),
  consent: connectorConsentSchema,
  header: z.object({
    name: z.string().min(1).max(64),
    value: z.string().min(1).max(CONNECTOR_HEADER_VALUE_MAX_BYTES),
  }).optional(),
})

/**
 * Adds a connector that needs no sign-in or takes a key in a header
 * (docs/connectors.md section 5.1). It is one step: the address, the consent
 * the user ticked and, for a key, the header, arrive together. The server
 * sends the probe with the key (or without credentials for a server that
 * needs none) and only when the server answers does it insert the connector
 * row, already `ready`, with the consent and the encrypted key. A rejected
 * key, an unreachable server or a closed dialog leaves nothing behind. An
 * OAuth connector is created by the OAuth callback instead.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event)
  const body = await readConnectorBody(event, bodySchema)
  const db = useDb()
  const logger = useRequestLogger(event)
  const target = await resolveConnectTarget(event, db, body)
  const preset = target.presetId
    ? findConnectorPreset(target.presetId)
    : undefined

  event.res.headers.set('cache-control', 'no-store')

  if (
    body.header
    && (!isValidConnectorHeader(body.header.name, body.header.value)
      || (preset && !preset.auth.includes('header')))
  ) {
    throw createConnectorError('CONNECTOR_HEADER_INVALID')
  }

  assertCurrentConsentVersion(body.consent)
  await requireLegalConsent(userId, db)
  await assertConnectorCapacity(db, userId)

  logger.set({
    attributes: {
      legalConsent: {
        action: 'connector-granted',
        host: target.host,
        issuerHost: '',
        version: body.consent.version,
      },
    },
  })

  try {
    if (body.header) {
      await verifyConnectorCredentialHeader(target.url, body.header, logger)
    } else {
      const discovery = await discoverConnectorAuth(target.url, logger, {
        allowOAuth: target.allowOAuth,
      })

      if (discovery.authType !== 'none') {
        throw createConnectorError('CONNECTOR_AUTH_REQUIRED')
      }
    }
  } catch (exception) {
    logger.set({
      attributes: {
        connectors: {
          step: 'create',
          code: connectorErrorCodeOf(exception, 'CONNECTOR_DISCOVERY_FAILED'),
          stored: false,
        },
      },
    })

    throw exception
  }

  const connector = await createConnector(db, {
    userId,
    title: target.title,
    url: target.url,
    slugBase: target.slugBase,
    createdVia: target.createdVia,
    presetId: target.presetId,
    connected: {
      authType: body.header ? 'header' : 'none',
      consent: {
        issuerHost: null,
        version: body.consent.version,
        givenAt: new Date(),
      },
      toolMode: body.toolMode,
    },
  })

  if (body.header) {
    try {
      await replaceConnectorCredentials(db, {
        userId,
        connectorId: connector.id,
        issuer: '',
        headerName: body.header.name,
        headerValue: body.header.value,
      })
    } catch (exception) {
      await deleteConnector(db, userId, connector.id, logger)

      throw exception
    }
  }

  logger.set({
    attributes: {
      connectors: {
        id: connector.id,
        host: target.host,
        step: 'create',
        authType: connector.authType ?? 'none',
        stored: true,
      },
      legalConsent: { connectorId: connector.id },
    },
  })

  setResponseStatus(event, 201)

  return { connector }
})
