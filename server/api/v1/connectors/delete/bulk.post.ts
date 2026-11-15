import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import {
  CONNECTOR_DELETE_BATCH,
  CONNECTOR_REVOKE_DEADLINE_MS,
} from '#shared/utils/connectors-policy'
import { deleteConnectorIconCache } from '~~/server/utils/connectors/icon'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { revokeCredentialsBatch } from '~~/server/utils/connectors/revoke'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'
import {
  deleteConnector,
  getConnector,
  readConnectorCredentials,
} from '~~/server/utils/connectors/store'
import type { ConnectorCredentials } from '~~/server/utils/connectors/store'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  ids: z.array(z.string().regex(/^[A-Za-z0-9]{1,64}$/))
    .min(1)
    .max(CONNECTOR_DELETE_BATCH),
})

/**
 * Deletes connectors (POST, because a DELETE body may be stripped at the
 * edge). The owned connectors and their credentials are read first; their
 * tokens are then revoked best effort, at most four connectors at a time
 * under a 10 s deadline, and the rows, credentials and settings are removed
 * one by one; audit rows stay. Deleting withdraws the consent, which is
 * logged with the hosts.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event)
  const body = await readConnectorBody(event, bodySchema)
  const logger = useRequestLogger(event)
  const db = useDb()
  const kv = useKV()
  const deleted: string[] = []
  const withdrawnHosts: string[] = []
  const owned: Array<{ id: string, host: string, consented: boolean }> = []
  const credentials: ConnectorCredentials[] = []

  for (const connectorId of new Set(body.ids)) {
    const connector = await getConnector(db, userId, connectorId)

    if (!connector) {
      continue
    }

    owned.push({
      id: connectorId,
      host: new URL(connector.origin).host,
      consented: connector.consentedAt !== null,
    })

    const stored = await readConnectorCredentials(db, userId, connectorId)

    if (stored) {
      credentials.push(stored)
    }
  }

  const revocationDeadline = new AbortController()
  const timer = setTimeout(() => {
    revocationDeadline.abort()
  }, CONNECTOR_REVOKE_DEADLINE_MS)

  try {
    await revokeCredentialsBatch(credentials, {
      signal: revocationDeadline.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  for (const connector of owned) {
    const result = await deleteConnector(db, userId, connector.id)

    if (!result.connectorDeleted) {
      continue
    }

    deleted.push(connector.id)
    await deleteConnectorIconCache(kv, connector.id)

    if (connector.consented) {
      withdrawnHosts.push(connector.host)
    }
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
