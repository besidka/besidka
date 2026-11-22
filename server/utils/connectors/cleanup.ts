import { and, eq, inArray } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { deleteConnectorIconCache } from '~~/server/utils/connectors/icon'
import { deleteCatalogSnapshot } from '~~/server/utils/connectors/tool-cache'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'

type DbClient = ReturnType<typeof useDb>

const MAX_BATCH_QUERY_PARAMS = 90

export interface PurgeUserConnectorsResult {
  connectorsDeleted: number
  connectorCredentialsDeleted: number
  connectorToolSettingsDeleted: number
  connectorChatSettingsDeleted: number
  connectorToolCallsDeleted: number
}

export interface ConnectorChatCleanupResult {
  rowsDeleted: number
}

function chunkItems<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

async function deleteIconCaches(connectorIds: readonly string[]) {
  try {
    const kv = useKV()

    for (const connectorId of connectorIds) {
      await deleteConnectorIconCache(kv, connectorId)
      await deleteCatalogSnapshot(kv, connectorId)
    }
  } catch {
    return
  }
}

/**
 * Chats are deleted: their per-chat connector choices go with them. The
 * table has no foreign key to `chats`, so nothing cascades. Best effort,
 * never throws: a leftover row only names a chat that no longer exists.
 */
export async function cleanupConnectorsForDeletedChats(
  db: DbClient,
  input: { userId: number, chatIds: string[], logger: LoggerLike },
): Promise<ConnectorChatCleanupResult> {
  const result: ConnectorChatCleanupResult = { rowsDeleted: 0 }

  try {
    for (const chunk of chunkItems(
      [...new Set(input.chatIds)],
      MAX_BATCH_QUERY_PARAMS,
    )) {
      const rows = await db.delete(schema.connectorChatSettings)
        .where(and(
          eq(schema.connectorChatSettings.userId, input.userId),
          inArray(schema.connectorChatSettings.chatPublicId, chunk),
        ))
        .returning({ id: schema.connectorChatSettings.id })

      result.rowsDeleted += rows.length
    }
  } catch (exception) {
    input.logger.set({
      attributes: {
        connectors: {
          cleanup: {
            chatDelete: {
              ...result,
              error: exceptionMessage(exception),
            },
          },
        },
      },
    })

    return result
  }

  if (result.rowsDeleted > 0) {
    input.logger.set({
      attributes: { connectors: { cleanup: { chatDelete: result } } },
    })
  }

  return result
}

/**
 * Account deletion. None of the connector tables has a foreign key to
 * `users`, so every user-keyed row is deleted explicitly, the audit rows
 * included (they outlive a deleted connector, never the account). Errors
 * are rethrown so the account deletion aborts and stays retryable.
 */
export async function purgeUserConnectors(
  db: DbClient,
  userId: number,
  logger: LoggerLike,
): Promise<PurgeUserConnectorsResult> {
  const chatSettings = await db.delete(schema.connectorChatSettings)
    .where(eq(schema.connectorChatSettings.userId, userId))
    .returning({ id: schema.connectorChatSettings.id })
  const toolSettings = await db.delete(schema.connectorToolSettings)
    .where(eq(schema.connectorToolSettings.userId, userId))
    .returning({ id: schema.connectorToolSettings.id })
  const credentials = await db.delete(schema.connectorCredentials)
    .where(eq(schema.connectorCredentials.userId, userId))
    .returning({ id: schema.connectorCredentials.id })
  const connectors = await db.delete(schema.connectors)
    .where(eq(schema.connectors.userId, userId))
    .returning({ id: schema.connectors.id })
  await deleteIconCaches(connectors.map((connector) => {
    return encodePublicId(connector.id)
  }))
  const toolCalls = await db.delete(schema.connectorToolCalls)
    .where(eq(schema.connectorToolCalls.userId, userId))
    .returning({ id: schema.connectorToolCalls.id })
  const result: PurgeUserConnectorsResult = {
    connectorsDeleted: connectors.length,
    connectorCredentialsDeleted: credentials.length,
    connectorToolSettingsDeleted: toolSettings.length,
    connectorChatSettingsDeleted: chatSettings.length,
    connectorToolCallsDeleted: toolCalls.length,
  }

  logger.set({ attributes: { connectors: { cleanup: { purge: result } } } })

  return result
}
