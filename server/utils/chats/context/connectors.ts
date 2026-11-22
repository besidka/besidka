import type { ChatContextConnector } from '~~/server/utils/chats/context/sections'
import { listConnectors } from '~~/server/utils/connectors/store'

type DbClient = ReturnType<typeof useDb>

/**
 * The owner's connectors by slug (id and title), so the context panel can
 * name a connector in the "Used" group and link to it on the Connectors
 * page. A connector deleted since the call is missing, and the panel shows
 * its slug instead.
 */
export async function loadChatContextConnectors(
  db: DbClient,
  userId: number,
): Promise<ReadonlyMap<string, ChatContextConnector>> {
  const connectors = await listConnectors(db, userId)

  return new Map(connectors.map((connector) => {
    return [connector.slug, { id: connector.id, title: connector.title }]
  }))
}
