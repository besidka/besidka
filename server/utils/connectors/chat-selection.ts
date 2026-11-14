import { CONNECTORS_PER_SEND } from '#shared/utils/connectors-policy'
import type { ConnectorStatus } from '#shared/utils/connectors-policy'
import {
  listConnectorChatSettings,
  upsertConnectorChatSettings,
} from '~~/server/utils/connectors/store'
import type { ConnectorRecord } from '~~/server/utils/connectors/store'

type DbClient = ReturnType<typeof useDb>

const SELECTABLE_STATUSES: readonly ConnectorStatus[] = ['ready', 'drifted']

export interface ConnectorSummary {
  id: string
  slug: string
  title: string
  host: string
  status: ConnectorStatus
  enabled: boolean
  authType: ConnectorRecord['authType']
  createdVia: ConnectorRecord['createdVia']
  updatedAt: Date
}

export interface ChatConnectorSelection {
  selected: ConnectorRecord[]
  skipped: ConnectorRecord[]
  overCap: ConnectorRecord[]
  unknownIds: string[]
}

export function isConnectorSelectable(connector: ConnectorRecord): boolean {
  return connector.enabled && SELECTABLE_STATUSES.includes(connector.status)
}

export function toConnectorSummary(connector: ConnectorRecord) {
  return {
    id: connector.id,
    slug: connector.slug,
    title: connector.title,
    host: new URL(connector.origin).host,
    status: connector.status,
    enabled: connector.enabled,
    authType: connector.authType,
    createdVia: connector.createdVia,
    updatedAt: connector.updatedAt,
  } satisfies ConnectorSummary
}

/**
 * Resolves a requested id list against the user's own connectors. Ids that
 * are not the user's are reported as `unknownIds` and never leak a reason;
 * a connector that is off or not connected is `skipped`; connectors past
 * `CONNECTORS_PER_SEND` are `overCap`, in request order.
 */
export function resolveConnectorSelection(
  connectors: readonly ConnectorRecord[],
  requestedIds: readonly string[],
): ChatConnectorSelection {
  const connectorsById = new Map(connectors.map((connector) => {
    return [connector.id, connector]
  }))
  const selected: ConnectorRecord[] = []
  const skipped: ConnectorRecord[] = []
  const overCap: ConnectorRecord[] = []
  const unknownIds: string[] = []
  const seen = new Set<string>()

  for (const requestedId of requestedIds) {
    if (seen.has(requestedId)) {
      continue
    }

    seen.add(requestedId)

    const connector = connectorsById.get(requestedId)

    if (!connector) {
      unknownIds.push(requestedId)

      continue
    }

    if (!isConnectorSelectable(connector)) {
      skipped.push(connector)

      continue
    }

    if (selected.length >= CONNECTORS_PER_SEND) {
      overCap.push(connector)

      continue
    }

    selected.push(connector)
  }

  return { selected, skipped, overCap, unknownIds }
}

export async function listChatConnectorIds(
  db: DbClient,
  userId: number,
  chatPublicId: string,
): Promise<string[]> {
  const rows = await listConnectorChatSettings(db, userId, chatPublicId)

  return rows
    .filter(row => row.enabled)
    .map(row => row.connectorId)
}

/**
 * Stores the chat's connector choice: every selected connector is written
 * as on, and every connector the chat had on that is no longer selected is
 * written as off. The per-tool "always allow" map of an existing row is
 * kept. Writes only rows that change.
 */
export async function persistChatConnectorSelection(
  db: DbClient,
  input: {
    userId: number
    chatPublicId: string
    selectedIds: readonly string[]
  },
): Promise<void> {
  const rows = await listConnectorChatSettings(
    db,
    input.userId,
    input.chatPublicId,
  )
  const rowsByConnectorId = new Map(rows.map((row) => {
    return [row.connectorId, row]
  }))
  const selectedIds = new Set(input.selectedIds)

  for (const connectorId of selectedIds) {
    const row = rowsByConnectorId.get(connectorId)

    if (row?.enabled) {
      continue
    }

    await upsertConnectorChatSettings(db, {
      userId: input.userId,
      chatPublicId: input.chatPublicId,
      connectorId,
      enabled: true,
      alwaysAllowTools: row?.alwaysAllowTools ?? {},
    })
  }

  for (const row of rows) {
    if (!row.enabled || selectedIds.has(row.connectorId)) {
      continue
    }

    await upsertConnectorChatSettings(db, {
      userId: input.userId,
      chatPublicId: input.chatPublicId,
      connectorId: row.connectorId,
      enabled: false,
      alwaysAllowTools: row.alwaysAllowTools,
    })
  }
}
