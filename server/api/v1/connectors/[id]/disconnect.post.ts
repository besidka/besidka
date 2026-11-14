import { defineEventHandler } from 'nuxt/server'
import { revokeStoredConnectorCredentials } from '~~/server/utils/connectors/revoke'
import {
  requireConnectorAccess,
  requireOwnedConnector,
} from '~~/server/utils/connectors/route'
import {
  deleteConnectorCredentials,
  updateConnector,
} from '~~/server/utils/connectors/store'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * Signs a connector out: RFC 7009 revocation when the issuer supports it
 * (best effort), then the credentials are deleted and the connector is off
 * and in `needs-auth`. The consent stays.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event)
  const connector = await requireOwnedConnector(event, userId)
  const db = useDb()
  const revocation = await revokeStoredConnectorCredentials(
    db,
    userId,
    connector.id,
  )
  const credentialsDeleted = await deleteConnectorCredentials(
    db,
    userId,
    connector.id,
  )
  const updated = await updateConnector(db, userId, connector.id, {
    enabled: false,
    status: 'needs-auth',
    lastError: null,
  })

  useRequestLogger(event).set({
    attributes: {
      connectors: {
        step: 'disconnect',
        revocationAttempted: revocation.attempted,
        revoked: revocation.revoked,
        credentialsDeleted,
      },
    },
  })

  return { connector: updated }
})
