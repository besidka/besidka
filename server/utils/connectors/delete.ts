import {
  CONNECTOR_REVOKE_DEADLINE_MS,
} from '#shared/utils/connectors-policy'
import { deleteConnectorIconCache } from '~~/server/utils/connectors/icon'
import { revokeCredentialsBatch } from '~~/server/utils/connectors/revoke'
import {
  deleteConnector,
  getConnector,
  isConnectorIdDecodable,
  readConnectorCredentials,
} from '~~/server/utils/connectors/store'
import type { ConnectorCredentials } from '~~/server/utils/connectors/store'
import type { LoggerLike } from '~~/server/utils/files/logger'

type DbClient = ReturnType<typeof useDb>

export interface DeleteConnectorsResult {
  deleted: string[]
  notFound: string[]
}

/**
 * Deletes connectors for the app route and for the MCP tool alike. The
 * owned connectors and their credentials are read first; their tokens are
 * then revoked best effort, at most four connectors at a time under a 10 s
 * deadline, and the rows, credentials and settings are removed one by one;
 * audit rows stay. Deleting withdraws the consent, which is logged with the
 * hosts. An id that is not the user's is reported as not found, never why.
 */
export async function deleteConnectorsWithRevocation(
  db: DbClient,
  userId: number,
  connectorIds: readonly string[],
  logger: LoggerLike,
): Promise<DeleteConnectorsResult> {
  const kv = useKV()
  const deleted: string[] = []
  const notFound: string[] = []
  const withdrawnHosts: string[] = []
  const owned: Array<{ id: string, host: string, consented: boolean }> = []
  const credentials: ConnectorCredentials[] = []

  for (const connectorId of new Set(connectorIds)) {
    if (!isConnectorIdDecodable(connectorId)) {
      notFound.push(connectorId)

      continue
    }

    const connector = await getConnector(db, userId, connectorId)

    if (!connector) {
      notFound.push(connectorId)

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
      notFound.push(connector.id)

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

  return { deleted, notFound }
}
