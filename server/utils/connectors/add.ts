import { createError } from 'evlog'
import type { ConnectorCreatedVia } from '#shared/utils/connectors-policy'
import { deriveConnectorSlugBase } from '#shared/utils/connectors-slug'
import { findConnectorPreset } from '~~/config/connectors-catalog'
import { createConnector } from '~~/server/utils/connectors/store'
import type { ConnectorRecord } from '~~/server/utils/connectors/store'
import { parseSafeOutboundUrl } from '~~/server/utils/net/safe-url'

type DbClient = ReturnType<typeof useDb>

export interface AddConnectorInput {
  userId: number
  url?: string
  title?: string
  presetId?: string
  source: { via: 'app' } | { via: 'mcp', clientId: string }
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

function resolveCreatedVia(
  input: AddConnectorInput,
  isPreset: boolean,
): ConnectorCreatedVia {
  if (input.source.via === 'mcp') {
    return 'mcp'
  }

  return isPreset ? 'preset' : 'app'
}

/**
 * Adds a connector without any network request (docs/connectors.md section
 * 5.1), for the app route and for the MCP tool alike: the URL is checked
 * syntactically, a preset's own URL replaces the input, and the row starts
 * disabled in `needs-auth`. Anything added over MCP is recorded as `mcp`
 * with the OAuth client that added it, even from a preset.
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

  const rawUrl = preset?.url ?? input.url

  if (!rawUrl) {
    throw invalidAddress()
  }

  const parsed = parseSafeOutboundUrl(rawUrl)

  if (!parsed.ok) {
    throw invalidAddress()
  }

  const title = input.title?.trim() || preset?.title || parsed.url.hostname
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
