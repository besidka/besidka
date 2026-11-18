import { and, eq } from 'drizzle-orm'
import { defineEventHandler } from 'nuxt/server'
import * as schema from '~~/server/db/schema'
import {
  ICON_BUSY_CACHE_SECONDS,
  iconImageResponse,
  iconMissResponse,
} from '~~/server/utils/connectors/icon-response'
import {
  CONNECTOR_ICON_BUSY,
  resolveConnectorIcon,
} from '~~/server/utils/connectors/icon'
import {
  fetchRegistryEntryIconSources,
  registryOriginIconKey,
} from '~~/server/utils/connectors/registry-icon'
import {
  requireConnectorAccess,
  requireOwnedConnector,
} from '~~/server/utils/connectors/route'
import { readConnectorUrl } from '~~/server/utils/connectors/store'
import type { ConnectorRecord } from '~~/server/utils/connectors/store'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

function isConsentWithdrawn(connector: ConnectorRecord): boolean {
  return !!connector.consentWithdrawnAt
    && (!connector.consentedAt
      || connector.consentWithdrawnAt.getTime()
      >= connector.consentedAt.getTime())
}

async function findRegistryName(
  userId: number,
  connector: ConnectorRecord,
): Promise<string | null> {
  try {
    const url = await readConnectorUrl(useDb(), userId, connector.id)

    if (!url) {
      return null
    }

    const [entry] = await useDb().select({
      name: schema.mcpRegistryServers.name,
    })
      .from(schema.mcpRegistryServers)
      .where(and(
        eq(schema.mcpRegistryServers.remoteUrl, url),
        eq(schema.mcpRegistryServers.status, 'active'),
      ))
      .limit(1)

    return entry?.name ?? null
  } catch {
    return null
  }
}

/**
 * The icon of one of the user's connectors, for its row, the picker, the
 * detail panel and the reasoning steps. The browser never loads a remote
 * image: this route serves the copy Besidka kept from the app's own origin,
 * in this order: the registry `icons` when the connector's address is a
 * directory entry, the icons the server declared when it was connected,
 * then the favicon or page icon of its host or of the site it belongs to
 * (kept once per host and shared with the directory). It answers only to
 * the owner and works before the connector is connected (an anonymous
 * request from Besidka's servers, no user data); a connector whose consent
 * was withdrawn and a missing icon answer 404, so the client shows a letter.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event, {
    write: false,
    icon: true,
  })
  const connector = await requireOwnedConnector(event, userId)

  if (isConsentWithdrawn(connector)) {
    return iconMissResponse()
  }

  const kv = useKV()
  const logger = useRequestLogger(event)
  const registryName = await findRegistryName(userId, connector)
  const image = await resolveConnectorIcon(
    kv,
    {
      id: connector.id,
      origin: connector.origin,
      originKey: await registryOriginIconKey(connector.origin),
      ...(registryName
        ? {
          readRemoteSources: () => {
            return fetchRegistryEntryIconSources(registryName, logger)
          },
        }
        : {}),
    },
    { logger },
  )

  if (image === CONNECTOR_ICON_BUSY) {
    return iconMissResponse(ICON_BUSY_CACHE_SECONDS)
  }

  return image ? iconImageResponse(image) : iconMissResponse()
})
