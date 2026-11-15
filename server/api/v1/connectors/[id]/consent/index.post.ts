import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import {
  CONNECTOR_CONSENT_VERSION,
  CONNECTOR_ISSUER_HOST_MAX_LENGTH,
} from '#shared/utils/connectors-policy'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import {
  requireConnectorAccess,
  requireOwnedConnector,
} from '~~/server/utils/connectors/route'
import { updateConnector } from '~~/server/utils/connectors/store'
import { requireLegalConsent } from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const HOST_PATTERN = /^[a-z0-9.-]+(?::\d{1,5})?$/

const bodySchema = z.object({
  accepted: z.literal(true),
  version: z.string().min(1).max(32),
  issuerHost: z.string().max(CONNECTOR_ISSUER_HOST_MAX_LENGTH)
    .regex(HOST_PATTERN)
    .nullable(),
})

/**
 * Records the per-connector consent (docs/connectors.md section 2, item 5;
 * pre-check question 2): the origin, the issuer host the screen named, the
 * text version and the time. The sign-up consent must be current too. The
 * OAuth start compares the stored issuer host with a fresh discovery, so a
 * consent given for one issuer never covers another.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event)
  const connector = await requireOwnedConnector(event, userId)
  const body = await readConnectorBody(event, bodySchema)

  await requireLegalConsent(userId)

  if (body.version !== CONNECTOR_CONSENT_VERSION) {
    throw createConnectorError('CONNECTOR_CONSENT_OUTDATED')
  }

  const updated = await updateConnector(useDb(), userId, connector.id, {
    consentOrigin: connector.origin,
    consentIssuer: body.issuerHost,
    consentVersion: CONNECTOR_CONSENT_VERSION,
    consentedAt: new Date(),
    consentWithdrawnAt: null,
  })

  if (!updated) {
    throw createError({
      message: 'Connector not found',
      status: 404,
      why: 'The connector was deleted',
      fix: 'Reload the page',
    })
  }

  useRequestLogger(event).set({
    attributes: {
      legalConsent: {
        action: 'connector-granted',
        connectorId: connector.id,
        host: new URL(connector.origin).host,
        issuerHost: body.issuerHost ?? '',
        version: CONNECTOR_CONSENT_VERSION,
      },
    },
  })

  return { connector: updated }
})
