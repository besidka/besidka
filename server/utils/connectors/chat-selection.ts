import {
  CONNECTORS_PER_SEND,
  resolveConnectorToolMode,
} from '#shared/utils/connectors-policy'
import type { ConnectorStatus } from '#shared/utils/connectors-policy'
import {
  deleteConnectorChatSetting,
  listConnectorChatSettings,
  listConnectors,
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

export interface ChatConnectorStates {
  onIds: string[]
  offIds: string[]
}

export interface SendConnectorPlan {
  live: ChatConnectorSelection
  catalog: ConnectorRecord[]
  requestedSkipped: ConnectorRecord[]
}

export async function listChatConnectorStates(
  db: DbClient,
  userId: number,
  chatPublicId: string,
): Promise<ChatConnectorStates> {
  const rows = await listConnectorChatSettings(db, userId, chatPublicId)

  return {
    onIds: rows.filter(row => row.enabled).map(row => row.connectorId),
    offIds: rows.filter(row => !row.enabled).map(row => row.connectorId),
  }
}

export async function listChatConnectorIds(
  db: DbClient,
  userId: number,
  chatPublicId: string,
): Promise<string[]> {
  return (await listChatConnectorStates(db, userId, chatPublicId)).onIds
}

/**
 * Which connectors a send uses (docs/connectors.md section 6.1). An explicit
 * "off in this chat" always wins. A Manual connector joins only when this
 * chat has it on, an Always on connector joins every chat; both are `live`
 * (listed at send start, up to `CONNECTORS_PER_SEND` together, chat-on
 * first). An Auto connector is never live: it goes to the `catalog`, where
 * the model can open it by name. `requestedSkipped` are the chat-on
 * connectors that are off or not connected, for the send's notices.
 */
export function planSendConnectors(input: {
  connectors: readonly ConnectorRecord[]
  onIds: readonly string[]
  offIds: readonly string[]
}): SendConnectorPlan {
  const offIds = new Set(input.offIds)
  const connectorsById = new Map(input.connectors.map((connector) => {
    return [connector.id, connector]
  }))
  const modeOf = (connector: ConnectorRecord) => {
    return resolveConnectorToolMode(connector.toolMode)
  }
  const requestedIds = input.onIds.filter((connectorId) => {
    const connector = connectorsById.get(connectorId)

    return !offIds.has(connectorId)
      && (!connector || modeOf(connector) !== 'auto')
  })
  const alwaysOnIds = input.connectors
    .filter((connector) => {
      return modeOf(connector) === 'always-on'
        && !offIds.has(connector.id)
        && isConnectorSelectable(connector)
    })
    .map(connector => connector.id)
  const live = resolveConnectorSelection(input.connectors, [
    ...requestedIds,
    ...alwaysOnIds,
  ])
  const liveIds = new Set(live.selected.map(connector => connector.id))

  return {
    live,
    catalog: input.connectors.filter((connector) => {
      return modeOf(connector) === 'auto'
        && !offIds.has(connector.id)
        && !liveIds.has(connector.id)
        && isConnectorSelectable(connector)
    }),
    requestedSkipped: live.skipped.filter((connector) => {
      return requestedIds.includes(connector.id)
    }),
  }
}

/**
 * The stored choice of a chat limited to connectors that can be switched on
 * right now, plus the connectors this chat switched off. A row stays on
 * after its connector is turned off, disconnected or loses consent, so the
 * raw list can name connectors a client cannot select. Rows are left
 * untouched, so the choice returns when the connector does.
 */
export async function listSelectableChatConnectorIds(
  db: DbClient,
  userId: number,
  chatPublicId: string,
): Promise<{ connectorIds: string[], offConnectorIds: string[] }> {
  const states = await listChatConnectorStates(db, userId, chatPublicId)

  if (states.onIds.length === 0 && states.offIds.length === 0) {
    return { connectorIds: [], offConnectorIds: [] }
  }

  const connectors = await listConnectors(db, userId)
  const knownIds = new Set(connectors.map(connector => connector.id))

  return {
    connectorIds: resolveConnectorSelection(connectors, states.onIds)
      .selected
      .map(connector => connector.id),
    offConnectorIds: states.offIds.filter(id => knownIds.has(id)),
  }
}

/**
 * Stores the chat's connector choice. A selected Manual connector (or one
 * whose mode is not known, without `connectors`) is written as on; an Auto
 * or Always on connector is never written as on, because for those only an
 * off row means anything. Every Manual connector the chat had on that is no
 * longer selected is written as off, and an Auto or Always on connector is
 * never switched off by being left out, so a client that never sends
 * `offIds` cannot switch them all off. With `offIds`, those connectors are
 * written as off, and an Auto or Always on connector that was off and is no
 * longer listed is available again: its row is deleted, or, when it holds
 * "Allow in this chat" grants, kept with `enabled` back to true. The
 * per-tool "always allow" map of an existing row is kept. Writes only rows
 * that change.
 */
export async function persistChatConnectorSelection(
  db: DbClient,
  input: {
    userId: number
    chatPublicId: string
    selectedIds: readonly string[]
    offIds?: readonly string[]
    connectors?: readonly ConnectorRecord[]
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
  const offIds = new Set(input.offIds ?? [])
  const selectedIds = new Set(
    input.selectedIds.filter(connectorId => !offIds.has(connectorId)),
  )
  const modesById = new Map((input.connectors ?? []).map((connector) => {
    return [connector.id, resolveConnectorToolMode(connector.toolMode)]
  }))
  const isManualOrUnknown = (connectorId: string) => {
    const mode = modesById.get(connectorId)

    return !mode || mode === 'manual'
  }

  async function write(connectorId: string, enabled: boolean) {
    const row = rowsByConnectorId.get(connectorId)

    if (row && row.enabled === enabled) {
      return
    }

    await upsertConnectorChatSettings(db, {
      userId: input.userId,
      chatPublicId: input.chatPublicId,
      connectorId,
      enabled,
      alwaysAllowTools: row?.alwaysAllowTools ?? {},
    })
  }

  for (const connectorId of selectedIds) {
    if (isManualOrUnknown(connectorId)) {
      await write(connectorId, true)
    }
  }

  for (const connectorId of offIds) {
    await write(connectorId, false)
  }

  for (const row of rows) {
    if (selectedIds.has(row.connectorId) || offIds.has(row.connectorId)) {
      continue
    }

    if (row.enabled && isManualOrUnknown(row.connectorId)) {
      await write(row.connectorId, false)

      continue
    }

    if (row.enabled || !input.offIds || isManualOrUnknown(row.connectorId)) {
      continue
    }

    if (Object.keys(row.alwaysAllowTools ?? {}).length > 0) {
      await write(row.connectorId, true)

      continue
    }

    await deleteConnectorChatSetting(db, {
      userId: input.userId,
      chatPublicId: input.chatPublicId,
      connectorId: row.connectorId,
    })
  }
}
