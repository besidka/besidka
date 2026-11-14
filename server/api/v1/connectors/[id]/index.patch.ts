import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import { CONNECTOR_TITLE_MAX_LENGTH } from '#shared/utils/connectors-policy'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import {
  assertConnectorConsent,
  issuerHostOf,
} from '~~/server/utils/connectors/consent'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import {
  requireConnectorAccess,
  requireOwnedConnector,
} from '~~/server/utils/connectors/route'
import {
  readConnectorCredentials,
  updateConnector,
} from '~~/server/utils/connectors/store'
import type { ConnectorRecord } from '~~/server/utils/connectors/store'
import { requireLegalConsent } from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  enabled: z.boolean().optional(),
  title: z.string().trim().min(1).max(CONNECTOR_TITLE_MAX_LENGTH).optional(),
})

async function assertCanEnable(userId: number, connector: ConnectorRecord) {
  if (connector.status !== 'ready') {
    throw createConnectorError('CONNECTOR_NOT_READY')
  }

  const db = useDb()

  await requireLegalConsent(userId, db)

  if (connector.authType !== 'oauth') {
    assertConnectorConsent(connector)

    return
  }

  const credentials = await readConnectorCredentials(db, userId, connector.id)

  if (!credentials?.issuer) {
    throw createConnectorError('CONNECTOR_NOT_READY')
  }

  assertConnectorConsent(connector, issuerHostOf(credentials.issuer))
}

/**
 * Renames a connector or turns it on or off, in the app only. Turning it on
 * needs a connected connector, a current sign-up consent and a current
 * per-connector consent for its origin and issuer; turning it off is always
 * allowed.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event)
  const connector = await requireOwnedConnector(event, userId)
  const body = await readConnectorBody(event, bodySchema)

  if (body.enabled === true && !connector.enabled) {
    await assertCanEnable(userId, connector)
  }

  const updated = await updateConnector(useDb(), userId, connector.id, {
    title: body.title,
    enabled: body.enabled,
  })

  useRequestLogger(event).set({
    attributes: {
      connectors: {
        step: 'update',
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      },
    },
  })

  return { connector: updated }
})
