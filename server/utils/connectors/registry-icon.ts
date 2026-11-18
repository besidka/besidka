import type { KVNamespace } from '@cloudflare/workers-types'
import { eq } from 'drizzle-orm'
import {
  CONNECTOR_ICON_TIMEOUT_MS,
  REGISTRY_BASE_URL,
  REGISTRY_SERVERS_PATH,
} from '#shared/utils/connectors-policy'
import * as schema from '~~/server/db/schema'
import {
  parseDeclaredConnectorIcons,
  resolveConnectorIcon,
} from '~~/server/utils/connectors/icon'
import type {
  ConnectorIconDependencies,
  ConnectorIconImage,
  DeclaredConnectorIcon,
} from '~~/server/utils/connectors/icon'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { safeFetch } from '~~/server/utils/net/safe-fetch'

export const REGISTRY_ICON_NOT_FOUND = 'not-found'

type RegistryDatabase = ReturnType<typeof useDb>

async function hashIconKeyPart(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value.toLowerCase()),
  )

  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * The KV key part of the favicon and page-link result for one host, shared
 * by every directory entry and every user's connector on that host.
 */
export async function registryOriginIconKey(origin: string): Promise<string> {
  return `registry-origin:${await hashIconKeyPart(origin)}`
}

/**
 * The `icons` of one registry entry, read live from the registry (the local
 * copy keeps no icons): one `latest` lookup through `safeFetch`, only on an
 * icon cache miss. Any failure is an empty list, so the host favicon is used.
 */
export async function fetchRegistryEntryIconSources(
  name: string,
  logger?: LoggerLike,
): Promise<DeclaredConnectorIcon[]> {
  try {
    const response = await safeFetch(
      `${REGISTRY_BASE_URL}${REGISTRY_SERVERS_PATH}/${
        encodeURIComponent(name)}/versions/latest`,
      {
        purpose: 'registry',
        headers: { accept: 'application/json' },
        timeoutMs: CONNECTOR_ICON_TIMEOUT_MS,
        logger,
      },
    )

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)

      return []
    }

    const body = await response.json() as { server?: unknown }

    return parseDeclaredConnectorIcons(body.server)
  } catch {
    return []
  }
}

/**
 * The icon of one active entry of the local registry copy, for a directory
 * card. The client sends only the registry id; the host and the registry
 * name come from the row, never from the request. Resolution order and the
 * KV copy (keyed by a hash of the registry name, so versions share it) are
 * those of `resolveConnectorIcon`, with the entry's own registry `icons`
 * tried first. The host steps are cached and locked once per origin (a hash
 * of the origin), so many entries on one host fetch it once. Returns
 * `not-found` for an unknown or inactive id.
 */
export async function resolveRegistryEntryIcon(
  db: RegistryDatabase,
  kv: KVNamespace,
  registryId: string,
  options: {
    logger?: LoggerLike
    dependencies?: ConnectorIconDependencies
    readRemoteSources?: (name: string) => Promise<DeclaredConnectorIcon[]>
  } = {},
): Promise<
  | ConnectorIconImage
  | null
  | 'busy'
  | typeof REGISTRY_ICON_NOT_FOUND
> {
  const [entry] = await db.select({
    name: schema.mcpRegistryServers.name,
    remoteUrl: schema.mcpRegistryServers.remoteUrl,
    status: schema.mcpRegistryServers.status,
  })
    .from(schema.mcpRegistryServers)
    .where(eq(schema.mcpRegistryServers.id, registryId))
    .limit(1)

  if (!entry || entry.status !== 'active') {
    return REGISTRY_ICON_NOT_FOUND
  }

  let origin: string

  try {
    origin = new URL(entry.remoteUrl).origin
  } catch {
    return null
  }

  const readRemoteSources = options.readRemoteSources
    ?? ((name: string) => fetchRegistryEntryIconSources(name, options.logger))

  return await resolveConnectorIcon(
    kv,
    {
      id: `registry:${await hashIconKeyPart(entry.name)}`,
      origin,
      originKey: await registryOriginIconKey(origin),
      readRemoteSources: () => readRemoteSources(entry.name),
    },
    { logger: options.logger, dependencies: options.dependencies },
  )
}
