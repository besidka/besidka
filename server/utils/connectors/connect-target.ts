import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { z } from 'zod'
import {
  CONNECTOR_CONSENT_VERSION,
  CONNECTOR_ISSUER_HOST_MAX_LENGTH,
  CONNECTOR_TITLE_MAX_LENGTH,
  CONNECTOR_TOOL_MODES,
  CONNECTOR_URL_MAX_LENGTH,
} from '#shared/utils/connectors-policy'
import {
  findActiveRegistryEntry,
  resolveConnectorTarget,
} from '~~/server/utils/connectors/add'
import type {
  ResolvedConnectorTarget,
} from '~~/server/utils/connectors/add'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import { requireFeature } from '~~/server/utils/features/guards'

type DbClient = ReturnType<typeof useDb>

const REGISTRY_ENTRY_ID_MAX_LENGTH = 300
const HOST_PATTERN = /^[a-z0-9.-]+(?::\d{1,5})?$/

export const connectorTargetShape = {
  url: z.string().min(1).max(CONNECTOR_URL_MAX_LENGTH).optional(),
  title: z.string().max(CONNECTOR_TITLE_MAX_LENGTH).optional(),
  presetId: z.string().min(1).max(32).optional(),
  registryId: z.string().min(1).max(REGISTRY_ENTRY_ID_MAX_LENGTH).optional(),
}

export const connectorTargetSchema = z.object(connectorTargetShape)

export const connectorConsentSchema = z.object({
  accepted: z.literal(true),
  version: z.string().min(1).max(32),
  issuerHost: z.string().max(CONNECTOR_ISSUER_HOST_MAX_LENGTH)
    .regex(HOST_PATTERN)
    .nullable(),
})

export const connectorToolModeSchema = z.enum(CONNECTOR_TOOL_MODES)

export type ConnectorTargetBody = z.infer<typeof connectorTargetSchema>
export type ConnectorConsentBody = z.infer<typeof connectorConsentSchema>

/**
 * Reads the address of the connector the user is about to connect: a preset
 * id, a directory entry id (looked up in the local MCP Registry copy, which
 * needs `connectors.registry`) or a typed address. Pure apart from that one
 * lookup: nothing is stored and no request goes to the server.
 */
export async function resolveConnectTarget(
  event: RequestEvent,
  db: DbClient,
  body: ConnectorTargetBody,
): Promise<ResolvedConnectorTarget> {
  if (!body.registryId || body.presetId) {
    return resolveConnectorTarget({
      url: body.url,
      title: body.title,
      presetId: body.presetId,
      source: { via: 'app' },
    })
  }

  await requireFeature(event, 'connectors.registry')

  const entry = await findActiveRegistryEntry(db, body.registryId)

  if (!entry) {
    throw createError({
      message: 'Unknown directory entry',
      status: 400,
      why: 'No active entry of the MCP Registry copy has this id',
      fix: 'Search the directory again',
    })
  }

  return resolveConnectorTarget({
    url: body.url,
    title: body.title,
    source: { via: 'registry', entry },
  })
}

export function assertCurrentConsentVersion(
  consent: ConnectorConsentBody,
): void {
  if (consent.version !== CONNECTOR_CONSENT_VERSION) {
    throw createConnectorError('CONNECTOR_CONSENT_OUTDATED')
  }
}
