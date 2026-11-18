import { CURATED_CONNECTORS } from '~~/config/connectors-directory'
import type { CuratedConnector } from '~~/config/connectors-directory'
import { eq } from 'drizzle-orm'
import { createError } from 'evlog'
import {
  CONNECTOR_TITLE_MAX_LENGTH,
} from '#shared/utils/connectors-policy'
import type { ConnectorCreatedVia } from '#shared/utils/connectors-policy'
import { sanitizeConnectorText } from '#shared/utils/connectors-text'
import {
  deriveConnectorSlugBase,
  deriveConnectorSlugBaseFromTitle,
} from '#shared/utils/connectors-slug'
import { findConnectorPreset } from '~~/config/connectors-catalog'
import * as schema from '~~/server/db/schema'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import { createConnector } from '~~/server/utils/connectors/store'
import type { ConnectorRecord } from '~~/server/utils/connectors/store'
import { parseSafeOutboundUrl } from '~~/server/utils/net/safe-url'

type DbClient = ReturnType<typeof useDb>

export interface ConnectorTargetInput {
  url?: string
  title?: string
  presetId?: string
  source:
    | { via: 'app' }
    | { via: 'mcp', clientId: string }
    | { via: 'registry', entry: RegistryEntryAddress }
}

export type AddConnectorInput = ConnectorTargetInput & { userId: number }

export interface ResolvedConnectorTarget {
  url: string
  host: string
  title: string
  presetId: string | null
  slugBase: string
  allowOAuth: boolean
  createdVia: ConnectorCreatedVia
  createdByClientId: string | null
}

export interface RegistryEntryAddress {
  remoteUrl: string
  title: string | null
}

export interface AddedConnector {
  connector: ConnectorRecord
  host: string
}

function invalidAddress() {
  return createError({
    message: 'This address is not allowed',
    status: 400,
    why: 'The connector address is not a public https URL with a host name',
    fix: 'Use the https address of the MCP server',
  })
}

const OWN_MCP_PATH = '/mcp'

function isOwnMcpPath(rawUrl: string): boolean {
  try {
    const pathname = new URL(rawUrl).pathname.replace(/\/+$/, '')

    return pathname.toLowerCase() === OWN_MCP_PATH
  } catch {
    return false
  }
}

function resolveCreatedVia(
  input: ConnectorTargetInput,
  isPreset: boolean,
): ConnectorCreatedVia {
  if (input.source.via === 'mcp') {
    return 'mcp'
  }

  if (input.source.via === 'registry' && !isPreset) {
    return 'registry'
  }

  return isPreset ? 'preset' : 'app'
}

/**
 * The address and title of an active entry of the local MCP Registry copy
 * (a curated title wins, so `com.notion/mcp` becomes "Notion"), or null for
 * an unknown or inactive id.
 */
export async function findActiveRegistryEntry(
  db: DbClient,
  registryId: string,
): Promise<RegistryEntryAddress | null> {
  const [entry] = await db.select({
    name: schema.mcpRegistryServers.name,
    remoteUrl: schema.mcpRegistryServers.remoteUrl,
    title: schema.mcpRegistryServers.title,
    status: schema.mcpRegistryServers.status,
  })
    .from(schema.mcpRegistryServers)
    .where(eq(schema.mcpRegistryServers.id, registryId))
    .limit(1)

  if (entry?.status !== 'active') {
    return null
  }

  const curated = (CURATED_CONNECTORS as readonly CuratedConnector[])
    .find(item => item.registryName === entry.name)

  return { remoteUrl: entry.remoteUrl, title: curated?.title ?? entry.title }
}

/**
 * Turns what the user picked (a preset, a directory entry or an address)
 * into the connector to create: the URL is checked syntactically, a preset's
 * own URL (or a directory entry's, from the local MCP Registry copy)
 * replaces the input, and the title, slug base and `createdVia` follow.
 * Pure: no request is made and nothing is stored. Anything added over MCP is
 * recorded as `mcp` with the OAuth client that added it, even from a preset;
 * a directory entry as `registry`.
 */
export function resolveConnectorTarget(
  input: ConnectorTargetInput,
): ResolvedConnectorTarget {
  const preset = input.presetId ? findConnectorPreset(input.presetId) : null

  if (input.presetId && !preset) {
    throw createError({
      message: 'Unknown preset',
      status: 400,
      why: 'No catalog entry has this id',
      fix: 'Pick a preset from the list',
    })
  }

  const registryEntry = input.source.via === 'registry'
    ? input.source.entry
    : null
  const rawUrl = preset?.url ?? registryEntry?.remoteUrl ?? input.url

  if (!rawUrl) {
    throw invalidAddress()
  }

  const parsed = parseSafeOutboundUrl(rawUrl)

  if (!parsed.ok) {
    if (parsed.reason === 'own-host' && isOwnMcpPath(rawUrl)) {
      throw createConnectorError('CONNECTOR_OWN_SERVER')
    }

    throw invalidAddress()
  }

  const typedTitle = sanitizeConnectorText(
    input.title ?? '',
    CONNECTOR_TITLE_MAX_LENGTH,
  )
  const registryTitle = sanitizeConnectorText(
    registryEntry?.title ?? '',
    CONNECTOR_TITLE_MAX_LENGTH,
  )
  const title = typedTitle || preset?.title || registryTitle
    || parsed.url.hostname
  const slugBase = preset?.id
    ?? deriveConnectorSlugBaseFromTitle(registryTitle)
    ?? deriveConnectorSlugBaseFromTitle(typedTitle)
    ?? deriveConnectorSlugBase(parsed.url.hostname)

  return {
    url: parsed.url.toString(),
    host: parsed.url.host,
    title,
    presetId: preset?.id ?? null,
    slugBase,
    allowOAuth: !preset || preset.auth.includes('oauth'),
    createdVia: resolveCreatedVia(input, preset !== null),
    createdByClientId: input.source.via === 'mcp'
      ? input.source.clientId
      : null,
  }
}

/**
 * Adds a connector over MCP (docs/connectors.md section 5.1): no request is
 * made to the address, and the row starts disabled in `needs-auth`. The app
 * never uses this: it creates a connector only after a connect succeeded
 * (`POST /api/v1/connectors`, the OAuth callback).
 */
export async function addConnector(
  db: DbClient,
  input: AddConnectorInput,
): Promise<AddedConnector> {
  const target = resolveConnectorTarget(input)
  const connector = await createConnector(db, {
    userId: input.userId,
    title: target.title,
    url: target.url,
    slugBase: target.slugBase,
    createdVia: target.createdVia,
    presetId: target.presetId,
    createdByClientId: target.createdByClientId,
  })

  return { connector, host: target.host }
}
