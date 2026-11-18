import { defineEventHandler, setResponseStatus } from 'nuxt/server'
import { z } from 'zod'
import {
  CONNECTOR_HEADER_VALUE_MAX_BYTES,
} from '#shared/utils/connectors-policy'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { assertConnectorConsent } from '~~/server/utils/connectors/consent'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import {
  connectorHeaderAuthSchema,
  readConnectorHeaderCredential,
} from '~~/server/utils/connectors/header-auth'
import { revokeStoredConnectorCredentials } from '~~/server/utils/connectors/revoke'
import {
  requireConnectorAccess,
  requireOwnedConnector,
} from '~~/server/utils/connectors/route'
import {
  replaceConnectorCredentials,
  updateConnector,
} from '~~/server/utils/connectors/store'
import { requireLegalConsent } from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  auth: connectorHeaderAuthSchema.optional(),
  headerName: z.string().min(1).max(64).optional(),
  headerValue: z.string().min(1)
    .max(CONNECTOR_HEADER_VALUE_MAX_BYTES)
    .optional(),
})

/**
 * Header or API-key auth (docs/connectors.md sections 4.3 and 5.2): the body
 * is `{ auth: { kind: 'bearer', token } }`, `{ auth: { kind: 'header', name,
 * value } }` or the older `{ headerName, headerValue }`. A bearer token is
 * stored as `Authorization: Bearer <token>`; the name is checked against the
 * pattern and the rejected list, the value is stored encrypted and sent
 * verbatim later. It replaces an OAuth sign-in, whose tokens are revoked
 * first. Neither the name's value nor the value is ever logged or returned.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event)
  const connector = await requireOwnedConnector(event, userId)
  const body = await readConnectorBody(event, bodySchema)

  const credential = readConnectorHeaderCredential({
    auth: body.auth,
    header: body.headerName !== undefined && body.headerValue !== undefined
      ? { name: body.headerName, value: body.headerValue }
      : undefined,
  })

  if (!credential) {
    throw createConnectorError('CONNECTOR_HEADER_INVALID')
  }

  const db = useDb()

  await requireLegalConsent(userId, db)
  assertConnectorConsent(connector)

  const revocation = await revokeStoredConnectorCredentials(
    db,
    userId,
    connector.id,
  )

  await replaceConnectorCredentials(db, {
    userId,
    connectorId: connector.id,
    issuer: '',
    headerName: credential.name,
    headerValue: credential.value,
  })

  const updated = await updateConnector(db, userId, connector.id, {
    authType: 'header',
    status: 'ready',
    lastConnectedAt: new Date(),
    lastError: null,
  })

  useRequestLogger(event).set({
    attributes: {
      connectors: {
        step: 'header-saved',
        revokedPrevious: revocation.revoked,
      },
    },
  })

  setResponseStatus(event, 200)

  return { connector: updated }
})
