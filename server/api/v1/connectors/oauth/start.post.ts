import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import { CONNECTOR_NEW_TOOL_MODE } from '#shared/utils/connectors-policy'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import {
  assertCurrentConsentVersion,
  connectorConsentSchema,
  connectorTargetShape,
  connectorToolModeSchema,
  resolveConnectTarget,
} from '~~/server/utils/connectors/connect-target'
import { connectorErrorCodeOf } from '~~/server/utils/connectors/errors'
import { startConnectorDraftOAuth } from '~~/server/utils/connectors/oauth-flow'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'
import { requireLegalConsent } from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { resolveRequestPublicOrigin } from '~~/server/utils/request-public-origin'

const bodySchema = z.object({
  ...connectorTargetShape,
  toolMode: connectorToolModeSchema.optional(),
  consent: connectorConsentSchema,
})

/**
 * Starts the OAuth sign-in of a connector that does not exist yet
 * (docs/connectors.md section 5.2) and returns the authorization URL for
 * the browser to open. Nothing is stored in D1: the pending connector waits
 * in the encrypted KV state and is created by the callback after the token
 * exchange. Closing the sign-in page, refusing it or letting it expire
 * leaves nothing behind.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event, { oauth: true })
  const body = await readConnectorBody(event, bodySchema)
  const db = useDb()
  const logger = useRequestLogger(event)
  const target = await resolveConnectTarget(event, db, body)

  assertCurrentConsentVersion(body.consent)
  await requireLegalConsent(userId, db)

  event.res.headers.set('cache-control', 'no-store')

  try {
    return await startConnectorDraftOAuth({
      db,
      kv: useKV(),
      userId,
      target,
      toolMode: body.toolMode ?? CONNECTOR_NEW_TOOL_MODE,
      consent: {
        issuerHost: body.consent.issuerHost,
        version: body.consent.version,
      },
      origin: resolveRequestPublicOrigin(event),
      logger,
    })
  } catch (exception) {
    logger.set({
      attributes: {
        connectors: {
          step: 'oauth-start',
          code: connectorErrorCodeOf(exception, 'CONNECTOR_DISCOVERY_FAILED'),
          stored: false,
        },
      },
    })

    throw exception
  }
})
