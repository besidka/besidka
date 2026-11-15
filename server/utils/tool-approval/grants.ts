import { and, eq } from 'drizzle-orm'
import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { z } from 'zod'
import type {
  ToolApprovalGrantItem,
} from '#shared/types/tool-approval-grants.d'
import * as schema from '~~/server/db/schema'
import { buildExposedToolName } from '~~/server/utils/connectors/tool-definitions'
import {
  getConnector,
  listConnectorChatSettings,
  listConnectors,
  readConnectorToolBaseline,
} from '~~/server/utils/connectors/store'
import type { ConnectorRecord } from '~~/server/utils/connectors/store'
import {
  assertConnectorWriteRequest,
  enforceConnectorRateLimit,
} from '~~/server/utils/connectors/route'
import { requireFeature } from '~~/server/utils/features/guards'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { decodePublicId } from '~~/server/utils/custom-db-types'
import { hasAlwaysAskToolName } from '~~/server/utils/tool-approval/policy'

type DbClient = ReturnType<typeof useDb>

interface ToolSettingRow {
  toolName: string
  definitionHash: string
  approval: string
  approvedDefinitionHash: string | null
}

function grantItem(
  scope: ToolApprovalGrantItem['scope'],
  connector: ConnectorRecord,
  toolName: string,
): ToolApprovalGrantItem {
  return {
    scope,
    connectorId: connector.id,
    connectorTitle: connector.title || connector.slug,
    toolName,
  }
}

async function chatGrantItems(
  connector: ConnectorRecord,
  settings: readonly ToolSettingRow[],
  alwaysAllowTools: Record<string, string>,
): Promise<ToolApprovalGrantItem[]> {
  const items: ToolApprovalGrantItem[] = []

  for (const setting of settings) {
    const exposedName = await buildExposedToolName(
      connector.slug,
      setting.toolName,
    )

    if (
      Object.hasOwn(alwaysAllowTools, exposedName)
      && alwaysAllowTools[exposedName] === setting.definitionHash
      && !hasAlwaysAskToolName(setting.toolName)
    ) {
      items.push(grantItem('chat', connector, setting.toolName))
    }
  }

  return items
}

function alwaysGrantItems(
  connector: ConnectorRecord,
  settings: readonly ToolSettingRow[],
): ToolApprovalGrantItem[] {
  return settings
    .filter((setting) => {
      return setting.approval === 'always'
        && setting.approvedDefinitionHash === setting.definitionHash
        && !hasAlwaysAskToolName(setting.toolName)
    })
    .map(setting => grantItem('always', connector, setting.toolName))
}

function besidkaGrantItem(
  scope: ToolApprovalGrantItem['scope'],
  toolName: string,
): ToolApprovalGrantItem {
  return {
    scope,
    connectorId: '',
    connectorTitle: 'Besidka',
    toolName,
    source: 'besidka',
  }
}

/**
 * The Besidka approvals that apply in this chat: its "Allow in this chat"
 * grants whose registry hash still matches, and, while the chat's Besidka
 * row is on, every tool set to Always allow. Registry names only.
 */
async function listBesidkaGrantItems(
  db: DbClient,
  userId: number,
  chatPublicId: string,
): Promise<ToolApprovalGrantItem[]> {
  const { readBesidkaChatSettings } = await import(
    '~~/server/utils/besidka-tools/chat-settings'
  )
  const settings = await readBesidkaChatSettings(db, userId, chatPublicId)
  const permissions = await import(
    '~~/server/utils/besidka-tools/permissions'
  )
  const { listChatExposedBesidkaTools } = await import(
    '~~/server/utils/besidka-tools/registry'
  )
  const { hashBesidkaChatTool, toBesidkaChatToolName } = await import(
    '~~/server/utils/besidka-tools/chat-adapter'
  )
  const modes = await permissions.loadBesidkaToolPermissionModes(userId, db)
  const items: ToolApprovalGrantItem[] = []

  for (const besidkaTool of listChatExposedBesidkaTools()) {
    const exposedName = toBesidkaChatToolName(besidkaTool.name)
    const chatHash = Object.hasOwn(settings.alwaysAllowTools, exposedName)
      ? settings.alwaysAllowTools[exposedName]
      : null
    const isAskEveryTime = besidkaTool.chat.tier === 'ask-every-time'

    if (
      chatHash
      && !isAskEveryTime
      && chatHash === await hashBesidkaChatTool(besidkaTool)
    ) {
      items.push(besidkaGrantItem('chat', besidkaTool.name))
    }

    if (
      settings.enabled
      && permissions.pickBesidkaPermissionMode(besidkaTool.name, modes)
      === 'allow'
    ) {
      items.push(besidkaGrantItem('always', besidkaTool.name))
    }
  }

  return items
}

/**
 * The approvals the user gave that still apply in this chat: "Allow in this
 * chat" grants of this chat, and "Always allow" grants of the connectors
 * this chat has on, then the Besidka ones (`listBesidkaGrantItems`). A
 * grant whose stored hash no longer matches the tool's reviewed definition,
 * or on a tool whose name now makes it always-ask, is left out, because the
 * send ignores it too. Only names leave the server, never hashes.
 */
export async function listChatToolApprovalGrants(
  db: DbClient,
  userId: number,
  chatPublicId: string,
): Promise<ToolApprovalGrantItem[]> {
  const chatSettings = await listConnectorChatSettings(
    db,
    userId,
    chatPublicId,
  )
  const besidkaItems = await listBesidkaGrantItems(db, userId, chatPublicId)

  if (chatSettings.length === 0) {
    return besidkaItems
  }

  const connectors = new Map((await listConnectors(db, userId))
    .map(connector => [connector.id, connector]))
  const items: ToolApprovalGrantItem[] = []

  for (const chatSetting of chatSettings) {
    const connector = connectors.get(chatSetting.connectorId)
    const alwaysAllowTools = chatSetting.alwaysAllowTools ?? {}
    const hasChatGrants = Object.keys(alwaysAllowTools).length > 0

    if (!connector || (!chatSetting.enabled && !hasChatGrants)) {
      continue
    }

    const { settings } = await readConnectorToolBaseline(
      db,
      userId,
      connector.id,
    )

    if (hasChatGrants) {
      items.push(
        ...await chatGrantItems(connector, settings, alwaysAllowTools),
      )
    }

    if (chatSetting.enabled) {
      items.push(...alwaysGrantItems(connector, settings))
    }
  }

  return [...items, ...besidkaItems]
}

/**
 * Clears every "Allow in this chat" grant of this chat, for connectors and
 * Besidka tools, and keeps each connector switched on or off as it was.
 * Returns how many settings rows were cleared.
 */
export async function resetChatToolApprovalGrants(
  db: DbClient,
  userId: number,
  chatPublicId: string,
): Promise<number> {
  const connectorRows = await db.update(schema.connectorChatSettings)
    .set({ alwaysAllowTools: {} })
    .where(and(
      eq(schema.connectorChatSettings.userId, userId),
      eq(schema.connectorChatSettings.chatPublicId, chatPublicId),
    ))
    .returning({ id: schema.connectorChatSettings.id })
  const besidkaRows = await db.update(schema.besidkaChatSettings)
    .set({ alwaysAllowTools: {} })
    .where(and(
      eq(schema.besidkaChatSettings.userId, userId),
      eq(schema.besidkaChatSettings.chatPublicId, chatPublicId),
    ))
    .returning({ id: schema.besidkaChatSettings.id })

  return connectorRows.length + besidkaRows.length
}

export function isDecodableConnectorId(connectorId: string): boolean {
  try {
    const id = decodePublicId(connectorId)

    return Number.isSafeInteger(id) && id > 0
  } catch {
    return false
  }
}

/**
 * Sets one connector tool back to "Needs approval": the setting keeps its
 * reviewed definition hash and loses the approved one. The connector id is
 * decoded and looked up through the user's own connectors first, so an id
 * that does not decode or belongs to someone else changes nothing. Returns
 * whether a row of this user was changed.
 */
export async function revokeAlwaysToolApprovalGrant(
  db: DbClient,
  userId: number,
  input: { connectorId: string, toolName: string },
): Promise<boolean> {
  if (!isDecodableConnectorId(input.connectorId)) {
    return false
  }

  const connector = await getConnector(db, userId, input.connectorId)

  if (!connector) {
    return false
  }

  const rows = await db.update(schema.connectorToolSettings)
    .set({ approval: 'ask', approvedDefinitionHash: null })
    .where(and(
      eq(schema.connectorToolSettings.userId, userId),
      eq(schema.connectorToolSettings.connectorId, input.connectorId),
      eq(schema.connectorToolSettings.toolName, input.toolName),
    ))
    .returning({ id: schema.connectorToolSettings.id })

  return rows.length > 0
}

/**
 * The gate of the chat approval routes, in this order: the same-origin write
 * guard (POST only), a session, the `tool-approvals` flag (404 when off),
 * the connector write limit (POST only), and the chat, which must belong to
 * the user (404 otherwise, also for a malformed slug).
 */
export async function requireChatToolApprovalAccess(
  event: RequestEvent,
  options: { write: boolean },
): Promise<{ userId: number, chatPublicId: string }> {
  const params = z.object({
    slug: z.ulid(),
  }).safeParse(getDecodedRouterParams(event))

  if (options.write) {
    assertConnectorWriteRequest(event)
  }

  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  await requireFeature(event, 'tool-approvals')

  const userId = parseInt(session.user.id)

  if (options.write) {
    await enforceConnectorRateLimit(event, userId)
  }

  if (params.error) {
    throw chatNotFoundError()
  }

  const chat = await useDb().query.chats.findFirst({
    where: { slug: params.data.slug, userId },
    columns: { id: true },
  })

  if (!chat) {
    throw chatNotFoundError()
  }

  useRequestLogger(event).set({ userId })

  return { userId, chatPublicId: chat.id }
}

function chatNotFoundError() {
  return createError({
    message: 'Chat not found.',
    status: 404,
  })
}
