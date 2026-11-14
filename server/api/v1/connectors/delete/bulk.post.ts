import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import {
  CONNECTOR_DELETE_BATCH,
  CONNECTOR_REVOKE_DEADLINE_MS,
} from '#shared/utils/connectors-policy'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { revokeStoredConnectorCredentials } from '~~/server/utils/connectors/revoke'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'
import {
  deleteConnector,
  getConnector,
} from '~~/server/utils/connectors/store'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  ids: z.array(z.string().regex(/^[A-Za-z0-9]{1,64}$/))
    .min(1)
    .max(CONNECTOR_DELETE_BATCH),
})

/**
 * Deletes connectors (POST, because a DELETE body may be stripped at the
 * edge). Each one owned by the user has its tokens revoked best effort, one
 * after another, then its row, credentials and settings are removed; audit
 * rows stay. Deleting withdraws the consent, which is logged per connector.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event)
  const body = await readConnectorBody(event, bodySchema)
  const logger = useRequestLogger(event)
  const db = useDb()
  const deleted: string[] = []
  const withdrawnHosts: string[] = []
  const revocationDeadline = new AbortController()
  const timer = setTimeout(() => {
    revocationDeadline.abort()
  }, CONNECTOR_REVOKE_DEADLINE_MS)

  try {
    for (const connectorId of new Set(body.ids)) {
      const connector = await getConnector(db, userId, connectorId)

      if (!connector) {
        continue
      }

      await revokeStoredConnectorCredentials(db, userId, connectorId, {
        signal: revocationDeadline.signal,
      })

      const result = await deleteConnector(db, userId, connectorId)

      if (!result.connectorDeleted) {
        continue
      }

      deleted.push(connectorId)

      if (connector.consentedAt) {
        withdrawnHosts.push(new URL(connector.origin).host)
      }
    }
  } finally {
    clearTimeout(timer)
  }

  if (withdrawnHosts.length > 0) {
    logger.set({
      attributes: {
        legalConsent: {
          action: 'connector-withdrawn',
          reason: 'deleted',
          hosts: withdrawnHosts,
        },
      },
    })
  }

  logger.set({
    attributes: {
      connectors: { step: 'delete', ids: deleted, deleted: deleted.length },
    },
  })

  return { deleted }
})
