import { createError } from 'evlog'
import {
  CONNECTOR_MCP_DELETE_BATCH,
  CONNECTOR_MCP_LIST_LIMIT,
  CONNECTOR_MCP_TOOLS_BATCH,
  CONNECTOR_PAGE_PATH,
} from '#shared/utils/connectors-policy'
import type {
  ConnectorCreatedVia,
  ConnectorStatus,
  ConnectorToolApproval,
} from '#shared/utils/connectors-policy'
import { addConnector } from '~~/server/utils/connectors/add'
import { deleteConnectorsWithRevocation } from '~~/server/utils/connectors/delete'
import {
  countConnectorToolCallsSince,
  countConnectorToolSettings,
  getConnector,
  isConnectorIdDecodable,
  listConnectorToolSettings,
  listConnectors,
  reduceConnectorToolSettings,
} from '~~/server/utils/connectors/store'
import type {
  ConnectorRecord,
  ConnectorToolCounts,
} from '~~/server/utils/connectors/store'
import {
  evaluateFeature,
  getFeatureEvaluationConfig,
  isFeatureActive,
  loadFeatureRules,
  loadUserFeatureState,
} from '~~/server/utils/features/evaluate'
import type { FeatureKv } from '~~/server/utils/features/evaluate'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  clampMcpLimit,
  createInvalidMcpCursorError,
} from '~~/server/utils/mcp/private/chats'
import { toIsoTimestamp } from '~~/server/utils/mcp/private/text'
import { readable } from '~~/server/utils/mcp/readable-error'

type DbClient = ReturnType<typeof useDb>

export const MCP_CONNECTOR_LIST_DEFAULT_LIMIT = 20
export const MCP_CONNECTOR_LIST_MAX_LIMIT = CONNECTOR_MCP_LIST_LIMIT
export const MCP_CONNECTOR_TOOLS_MAX = CONNECTOR_MCP_TOOLS_BATCH
export const MCP_CONNECTOR_DELETE_MAX = CONNECTOR_MCP_DELETE_BATCH
export const MCP_CONNECTOR_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/
export const MCP_CONNECTORS_UNAVAILABLE_MESSAGE
  = 'Connectors are not available for this account.'

const CONNECTORS_FLAG = 'connectors'
const LIST_CURSOR_PREFIX = 'connectors:'
const MAX_LIST_OFFSET = 1000
const CALLS_WINDOW_DAYS = 30
const MILLISECONDS_PER_DAY = 86_400_000

export interface McpConnectorContext {
  db: DbClient
  kv: FeatureKv
  userId: number
  clientId: string
  logger: LoggerLike
  siteUrl: string
}

export interface McpConnectorSummary {
  id: string
  title: string
  host: string
  status: ConnectorStatus
  enabled: boolean
  toolCount: number
  enabledToolCount: number
  drifted: boolean
  createdVia: ConnectorCreatedVia
  updatedAt: string | null
}

export interface McpConnectorTool {
  name: string
  enabled: boolean
  approval: ConnectorToolApproval
  serverReadOnly: boolean
}

export interface McpConnectorDetail extends McpConnectorSummary {
  tools: McpConnectorTool[]
  usage: { callsLast30d: number }
}

export interface McpConnectorListInput {
  cursor?: string
  limit?: number
}

export interface McpConnectorAddInput {
  url?: string
  title?: string
  presetId?: string
}

export interface McpConnectorToolChange {
  name: string
  enabled?: false
  approval?: 'ask'
}

export interface McpConnectorToolsInput {
  id: string
  tools: McpConnectorToolChange[]
}

function createUnavailableError() {
  return createError({
    message: MCP_CONNECTORS_UNAVAILABLE_MESSAGE,
    status: 404,
    why: 'feature_unavailable',
  })
}

function createInvalidInputError(message: string) {
  return createError({ status: 400, message })
}

function createNotFoundError() {
  return createError({
    status: 404,
    message: 'Connector not found. Use list_connectors to see your '
      + 'connectors and their ids.',
  })
}

/**
 * Checks the caller's `connectors` flag without a request, including the
 * user's Labs toggle, like the app routes. Any failure is the same generic
 * 404 and runs before an id is looked at, so a tool never reveals whether
 * an id exists. The flag is checked here and not with the toolkit's
 * per-tool `enabled` guard, which would hide the tools from anonymous
 * `tools/list`.
 */
export async function assertMcpConnectorsAvailable(
  context: Pick<McpConnectorContext, 'db' | 'kv' | 'userId' | 'logger'>,
): Promise<void> {
  const [rules, userState] = await Promise.all([
    loadFeatureRules(context.kv, context.db, context.logger),
    loadUserFeatureState(context.db, context.userId),
  ])
  const resolution = await evaluateFeature(CONNECTORS_FLAG, {
    rules,
    userState,
    config: getFeatureEvaluationConfig(),
  })

  if (!isFeatureActive(CONNECTORS_FLAG, resolution, userState)) {
    throw createUnavailableError()
  }
}

function encodeListCursor(offset: number): string {
  return btoa(`${LIST_CURSOR_PREFIX}${offset}`)
}

function decodeListCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0
  }

  let decoded: string

  try {
    decoded = atob(cursor)
  } catch {
    throw createInvalidMcpCursorError()
  }

  const offset = decoded.startsWith(LIST_CURSOR_PREFIX)
    ? Number(decoded.slice(LIST_CURSOR_PREFIX.length))
    : Number.NaN

  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_LIST_OFFSET) {
    throw createInvalidMcpCursorError()
  }

  return offset
}

function toConnectorSummary(
  connector: ConnectorRecord,
  counts: ConnectorToolCounts | undefined,
): McpConnectorSummary {
  return {
    id: connector.id,
    title: connector.title,
    host: new URL(connector.origin).host,
    status: connector.status,
    enabled: connector.enabled,
    toolCount: counts?.total ?? 0,
    enabledToolCount: counts?.enabled ?? 0,
    drifted: connector.status === 'drifted',
    createdVia: connector.createdVia,
    updatedAt: toIsoTimestamp(connector.updatedAt),
  }
}

type ToolSettingRows = Awaited<ReturnType<typeof listConnectorToolSettings>>

function toToolList(rows: ToolSettingRows): McpConnectorTool[] {
  return rows.map((row) => {
    return {
      name: row.toolName,
      enabled: row.enabled,
      approval: row.approval,
      serverReadOnly: row.serverReadOnly,
    }
  })
}

function assertConnectorId(connectorId: string): void {
  if (
    !MCP_CONNECTOR_ID_PATTERN.test(connectorId)
    || !isConnectorIdDecodable(connectorId)
  ) {
    throw createNotFoundError()
  }
}

export async function listMcpConnectors(
  context: McpConnectorContext,
  input: McpConnectorListInput,
): Promise<{ connectors: McpConnectorSummary[], nextCursor: string | null }> {
  await assertMcpConnectorsAvailable(context)

  const offset = decodeListCursor(input.cursor)
  const limit = clampMcpLimit(
    input.limit,
    MCP_CONNECTOR_LIST_DEFAULT_LIMIT,
    MCP_CONNECTOR_LIST_MAX_LIMIT,
  )
  const [connectors, counts] = await Promise.all([
    listConnectors(context.db, context.userId),
    countConnectorToolSettings(context.db, context.userId),
  ])
  const page = connectors.slice(offset, offset + limit)
  const nextOffset = offset + page.length

  return {
    connectors: page.map((connector) => {
      return toConnectorSummary(connector, counts.get(connector.id))
    }),
    nextCursor: nextOffset < connectors.length
      ? encodeListCursor(nextOffset)
      : null,
  }
}

export async function getMcpConnector(
  context: McpConnectorContext,
  input: { id: string },
): Promise<McpConnectorDetail> {
  await assertMcpConnectorsAvailable(context)
  assertConnectorId(input.id)

  const connector = await getConnector(context.db, context.userId, input.id)

  if (!connector) {
    throw createNotFoundError()
  }

  const since = new Date(
    Date.now() - CALLS_WINDOW_DAYS * MILLISECONDS_PER_DAY,
  )
  const [settings, callsLast30d] = await Promise.all([
    listConnectorToolSettings(context.db, context.userId, connector.id),
    countConnectorToolCallsSince(
      context.db,
      context.userId,
      connector.id,
      since,
    ),
  ])
  const tools = toToolList(settings)

  return {
    ...toConnectorSummary(connector, {
      total: tools.length,
      enabled: tools.filter((tool) => {
        return tool.enabled
      }).length,
    }),
    tools,
    usage: { callsLast30d },
  }
}

export async function addMcpConnector(
  context: McpConnectorContext,
  input: McpConnectorAddInput,
): Promise<{
  id: string
  title: string
  host: string
  status: 'needs-auth'
  enabled: false
  manageUrl: string
}> {
  await assertMcpConnectorsAvailable(context)

  const { connector, host } = await readable(() => {
    return addConnector(context.db, {
      userId: context.userId,
      url: input.url,
      title: input.title,
      presetId: input.presetId,
      source: { via: 'mcp', clientId: context.clientId },
    })
  })

  return {
    id: connector.id,
    title: connector.title,
    host,
    status: 'needs-auth',
    enabled: false,
    manageUrl: `${context.siteUrl}${CONNECTOR_PAGE_PATH}`,
  }
}

export async function updateMcpConnectorTools(
  context: McpConnectorContext,
  input: McpConnectorToolsInput,
): Promise<{ id: string, tools: McpConnectorTool[] }> {
  await assertMcpConnectorsAvailable(context)
  assertConnectorId(input.id)

  const names = new Set<string>()

  for (const change of input.tools) {
    if (names.has(change.name)) {
      throw createInvalidInputError(
        'A tool is listed twice. Send each tool name once.',
      )
    }

    names.add(change.name)

    if (change.enabled === undefined && change.approval === undefined) {
      throw createInvalidInputError(
        'Each tool needs enabled: false or approval: "ask".',
      )
    }

    if (
      (change.enabled !== undefined && change.enabled !== false)
      || (change.approval !== undefined && change.approval !== 'ask')
    ) {
      throw createInvalidInputError(
        'Only enabled: false and approval: "ask" are allowed here. Turning '
        + 'a tool on or allowing it without asking is only possible in the '
        + 'Besidka app.',
      )
    }
  }

  const connector = await getConnector(context.db, context.userId, input.id)

  if (!connector) {
    throw createNotFoundError()
  }

  const { unknownTools } = await reduceConnectorToolSettings(
    context.db,
    context.userId,
    connector.id,
    input.tools.map((change) => {
      return {
        toolName: change.name,
        disable: change.enabled === false,
        askEveryTime: change.approval === 'ask',
      }
    }),
  )

  if (unknownTools.length > 0) {
    throw createInvalidInputError(
      `${unknownTools.length} of these tools are not on this connector. `
      + 'Use get_connector to see its tool names. Nothing was changed.',
    )
  }

  const settings = await listConnectorToolSettings(
    context.db,
    context.userId,
    connector.id,
  )

  return { id: connector.id, tools: toToolList(settings) }
}

export async function deleteMcpConnectors(
  context: McpConnectorContext,
  input: { ids: string[] },
): Promise<{ deleted: string[], notFound: string[] }> {
  await assertMcpConnectorsAvailable(context)

  const wellFormedIds = input.ids.filter((id) => {
    return MCP_CONNECTOR_ID_PATTERN.test(id)
  })
  const malformedIds = input.ids.filter((id) => {
    return !MCP_CONNECTOR_ID_PATTERN.test(id)
  })
  const result = await deleteConnectorsWithRevocation(
    context.db,
    context.userId,
    wellFormedIds,
    context.logger,
  )

  return {
    deleted: result.deleted,
    notFound: [...new Set([...result.notFound, ...malformedIds])],
  }
}
