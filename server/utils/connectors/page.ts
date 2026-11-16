import { eq, inArray } from 'drizzle-orm'
import { resolveConnectorToolMode } from '#shared/utils/connectors-policy'
import type {
  ConnectorConsentState,
  ConnectorPageItem,
  ConnectorPageToolCounts,
} from '#shared/types/connectors.d'
import * as schema from '~~/server/db/schema'
import { isConnectorConsentCurrent } from '~~/server/utils/connectors/consent'
import {
  CONNECTOR_BASELINE_MARKER_TOOL_NAME,
  listConnectors,
} from '~~/server/utils/connectors/store'
import type { ConnectorRecord } from '~~/server/utils/connectors/store'
import { hasAlwaysAskToolName } from '~~/server/utils/tool-approval/policy'

type DbClient = ReturnType<typeof useDb>

const APP_NAME_MAX_LENGTH = 80

interface ToolSettingCountRow {
  connectorId: string
  toolName: string
  enabled: boolean
  approval: string
  definitionHash: string
  approvedDefinitionHash: string | null
}

function emptyCounts(): ConnectorPageToolCounts {
  return { isBaselined: false, total: 0, enabled: 0, alwaysAllowed: 0 }
}

export function isAlwaysGrantActive(setting: {
  toolName: string
  approval: string
  definitionHash: string
  approvedDefinitionHash: string | null
}): boolean {
  return setting.approval === 'always'
    && setting.approvedDefinitionHash === setting.definitionHash
    && !hasAlwaysAskToolName(setting.toolName)
}

/**
 * The consent shown on the page, without the issuer check the gate adds for
 * OAuth (the page names the issuer host the consent was given for).
 */
export function connectorConsentState(
  connector: ConnectorRecord,
): ConnectorConsentState {
  if (!connector.consentedAt) {
    return 'missing'
  }

  if (
    connector.consentWithdrawnAt
    && connector.consentWithdrawnAt.getTime()
    >= connector.consentedAt.getTime()
  ) {
    return 'withdrawn'
  }

  return isConnectorConsentCurrent(connector) ? 'current' : 'outdated'
}

function countTools(
  rows: readonly ToolSettingCountRow[],
): Map<string, ConnectorPageToolCounts> {
  const counts = new Map<string, ConnectorPageToolCounts>()

  for (const row of rows) {
    const current = counts.get(row.connectorId) ?? emptyCounts()

    current.isBaselined = true

    if (row.toolName !== CONNECTOR_BASELINE_MARKER_TOOL_NAME) {
      current.total += 1
      current.enabled += row.enabled ? 1 : 0
      current.alwaysAllowed += isAlwaysGrantActive(row) ? 1 : 0
    }

    counts.set(row.connectorId, current)
  }

  return counts
}

async function readAppNames(
  db: DbClient,
  connectors: readonly ConnectorRecord[],
): Promise<Map<string, string>> {
  const clientIds = [...new Set(connectors
    .map(connector => connector.createdByClientId)
    .filter((clientId): clientId is string => !!clientId))]

  if (clientIds.length === 0) {
    return new Map()
  }

  const rows = await db.select({
    clientId: schema.oauthClients.clientId,
    name: schema.oauthClients.name,
  })
    .from(schema.oauthClients)
    .where(inArray(schema.oauthClients.clientId, clientIds))

  return new Map(rows
    .filter(row => !!row.name?.trim())
    .map((row) => {
      return [row.clientId, row.name!.trim().slice(0, APP_NAME_MAX_LENGTH)]
    }))
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

export function toConnectorPageItem(
  connector: ConnectorRecord,
  extras: {
    tools?: ConnectorPageToolCounts
    appName?: string | null
  } = {},
): ConnectorPageItem {
  return {
    id: connector.id,
    slug: connector.slug,
    title: connector.title,
    host: new URL(connector.origin).host,
    status: connector.status,
    enabled: connector.enabled,
    toolMode: resolveConnectorToolMode(connector.toolMode),
    authType: connector.authType,
    createdVia: connector.createdVia,
    presetId: connector.presetId,
    addedByApp: connector.createdVia === 'mcp'
      ? extras.appName ?? 'an app connected over MCP'
      : null,
    consent: {
      state: connectorConsentState(connector),
      issuerHost: connector.consentIssuer,
      givenAt: toIso(connector.consentedAt),
    },
    note: connector.lastError
      ? { code: connector.lastError.code, message: connector.lastError.message }
      : null,
    tools: extras.tools ?? emptyCounts(),
    createdAt: connector.createdAt.toISOString(),
    updatedAt: connector.updatedAt.toISOString(),
    lastConnectedAt: toIso(connector.lastConnectedAt),
  }
}

/**
 * The account's connectors for the Connectors page: the picker summary plus
 * the consent state, the fixed-text note, the app that added a connector
 * over MCP and the reviewed tool counts. Never the URL, credentials or a
 * hash.
 */
export async function listConnectorPageItems(
  db: DbClient,
  userId: number,
): Promise<ConnectorPageItem[]> {
  const connectors = await listConnectors(db, userId)

  if (connectors.length === 0) {
    return []
  }

  const settings = await db.select({
    connectorId: schema.connectorToolSettings.connectorId,
    toolName: schema.connectorToolSettings.toolName,
    enabled: schema.connectorToolSettings.enabled,
    approval: schema.connectorToolSettings.approval,
    definitionHash: schema.connectorToolSettings.definitionHash,
    approvedDefinitionHash:
      schema.connectorToolSettings.approvedDefinitionHash,
  })
    .from(schema.connectorToolSettings)
    .where(eq(schema.connectorToolSettings.userId, userId))
  const counts = countTools(settings)
  const appNames = await readAppNames(db, connectors)

  return connectors.map((connector) => {
    return toConnectorPageItem(connector, {
      tools: counts.get(connector.id),
      appName: connector.createdByClientId
        ? appNames.get(connector.createdByClientId) ?? null
        : null,
    })
  })
}
