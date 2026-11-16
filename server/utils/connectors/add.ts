import { CURATED_CONNECTORS } from '~~/config/connectors-directory'
import type { CuratedConnector } from '~~/config/connectors-directory'
import { eq } from 'drizzle-orm'
import { createError } from 'evlog'
import {
  CONNECTOR_TITLE_MAX_LENGTH,
} from '#shared/utils/connectors-policy'
import type { ConnectorCreatedVia } from '#shared/utils/connectors-policy'
import { sanitizeConnectorText } from '#shared/utils/connectors-text'
import { deriveConnectorSlugBase } from '#shared/utils/connectors-slug'
import { findConnectorPreset } from '~~/config/connectors-catalog'
import * as schema from '~~/server/db/schema'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import {
  assertConnectorCapacity,
  createConnector,
} from '~~/server/utils/connectors/store'
import type { ConnectorRecord } from '~~/server/utils/connectors/store'
import { parseSafeOutboundUrl } from '~~/server/utils/net/safe-url'

type DbClient = ReturnType<typeof useDb>

export interface AddConnectorInput {
  userId: number
  url?: string
  title?: string
  presetId?: string
  source:
    | { via: 'app' }
    | { via: 'mcp', clientId: string }
    | { via: 'registry', entry: RegistryEntryAddress }
  verifyServer?: (target: ConnectorVerifyTarget) => Promise<void>
}

export interface ConnectorVerifyTarget {
  url: string
  allowOAuth: boolean
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
  input: AddConnectorInput,
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
 * Adds a connector (docs/connectors.md section 5.1): the URL is checked
 * syntactically, a preset's own URL (or a directory entry's, from the local
 * MCP Registry copy) replaces the input, and the row starts disabled in
 * `needs-auth`. Without `verifyServer` (the MCP tool) no request is made.
 * With it (the app route) the per-user cap is checked first, so a user at
 * the cap never causes an outbound request, then the callback runs after the
 * URL check and before the insert, and a throw means nothing is stored: a
 * server that never answered as an MCP server never becomes a connector.
 * Anything added over MCP is recorded as `mcp` with the OAuth client that
 * added it, even from a preset; a directory entry as `registry`.
 */
export async function addConnector(
  db: DbClient,
  input: AddConnectorInput,
): Promise<AddedConnector> {
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

  const title = sanitizeConnectorText(
    input.title ?? '',
    CONNECTOR_TITLE_MAX_LENGTH,
  ) || preset?.title || sanitizeConnectorText(
    registryEntry?.title ?? '',
    CONNECTOR_TITLE_MAX_LENGTH,
  ) || parsed.url.hostname

  if (input.verifyServer) {
    await assertConnectorCapacity(db, input.userId)
    await input.verifyServer({
      url: parsed.url.toString(),
      allowOAuth: !preset || preset.auth.includes('oauth'),
    })
  }

  const connector = await createConnector(db, {
    userId: input.userId,
    title,
    url: parsed.url.toString(),
    slugBase: preset?.id ?? deriveConnectorSlugBase(parsed.url.hostname),
    createdVia: resolveCreatedVia(input, preset !== null),
    presetId: preset?.id ?? null,
    createdByClientId: input.source.via === 'mcp'
      ? input.source.clientId
      : null,
  })

  return { connector, host: parsed.url.host }
}
