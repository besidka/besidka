import { listConnectors } from '~~/server/utils/connectors/store'

type DbClient = ReturnType<typeof useDb>

/**
 * The owner's connector titles by slug, so the context panel can name a
 * connector in the "Used" group. A connector deleted since the call is
 * missing, and the panel shows its slug instead.
 */
export async function loadChatContextConnectors(
  db: DbClient,
  userId: number,
): Promise<ReadonlyMap<string, string>> {
  const connectors = await listConnectors(db, userId)

  return new Map(connectors.map((connector) => {
    return [connector.slug, connector.title]
  }))
}
