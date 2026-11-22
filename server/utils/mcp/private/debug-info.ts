import type { KVNamespace } from '@cloudflare/workers-types'
import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'evlog'
import { parsePersistedChatFailureNotice } from '#shared/utils/chat-failure-text'
import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import { resolveConnectorToolMode } from '#shared/utils/connectors-policy'
import { isAwaitingApprovalToolPart } from '#shared/utils/tool-approval-parts'
import { MCP_SERVER_VERSION } from '~~/config/mcp-server'
import * as schema from '~~/server/db/schema'
import { listChatGenerationLeases } from '~~/server/utils/chats/generation-in-progress'
import { listChatConnectorStates } from '~~/server/utils/connectors/chat-selection'
import { listConnectors } from '~~/server/utils/connectors/store'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { resolveMcpSiteUrl } from '~~/server/utils/mcp/auth'
import { listMyFeatures } from '~~/server/utils/mcp/private/features'
import { toIsoTimestamp } from '~~/server/utils/mcp/private/text'
import { toReportLabel } from '~~/server/utils/usage/report-text'

type DbClient = ReturnType<typeof useDb>
type DebugKv = Pick<KVNamespace, 'get' | 'put' | 'delete' | 'list'>

export const DEBUG_INFO_DEFAULT_MESSAGES = 10
export const DEBUG_INFO_MAX_MESSAGES = 20
export const DEBUG_INFO_MAX_CONNECTORS = 20

const LABEL_MAX_CHARS = 80

export type DebugMessageStatus
  = | 'sent'
    | 'complete'
    | 'empty'
    | 'awaiting-approval'
    | 'failed'

export type DebugConnectorChatState = 'default' | 'on' | 'off'

export interface DebugMessageFailure {
  message: string
  ref: string | null
}

export interface DebugMessage {
  id: string | null
  role: string
  createdAt: string | null
  status: DebugMessageStatus
  model: string | null
  provider: string | null
  totalTokens: number | null
  reasoning: string | null
  toolCalls: number
  toolErrors: number
  toolsDenied: number
  pendingApprovals: number
  failure: DebugMessageFailure | null
}

export interface DebugConnector {
  id: string
  title: string
  host: string
  mode: string
  enabled: boolean
  status: string
  chatState: DebugConnectorChatState
  lastErrorCode: string | null
}

export interface DebugFeature {
  key: string
  title: string
  stage: string
  active: boolean
  optedIn: boolean
  variant: string | null
}

export interface DebugChat {
  slug: string
  url: string
  projectId: string | null
  branchedFromShare: boolean
  memoryExcluded: boolean
  createdAt: string | null
  activityAt: string | null
  pendingApprovals: number
  generationLeases: string[] | null
  messages: DebugMessage[]
}

export interface DebugInfo {
  generatedAt: string
  app: {
    buildId: string | null
    mcpServerVersion: string
  }
  chat: DebugChat | null
  connectors: DebugConnector[] | null
  connectorsNote: string | null
  features: DebugFeature[] | null
  contact: string
}

export interface DebugMessageRow {
  publicId: string | null
  role: string
  parts: unknown
  usage: {
    model?: unknown
    provider?: unknown
    totalTokens?: unknown
  } | null
  reasoning: string | null
  createdAt: Date
}

export interface DebugInfoOptions {
  slug: string | null
  maxMessages: number
  siteUrl: string
  buildId: string | null
  supportEmail: string
  includeConnectors: boolean
  connectorsNote?: string | null
  includeFeatures: boolean
  now?: Date
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A short single-line label for a value that came from user input or a
 * stored column, so a connector title or a model id can never add lines or
 * run long inside the report block.
 */
export function toDebugLabel(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const label = toReportLabel(value)

  if (!label) {
    return null
  }

  return label.length > LABEL_MAX_CHARS
    ? `${label.slice(0, LABEL_MAX_CHARS)}...`
    : label
}

function isToolPart(part: Record<string, unknown>): boolean {
  return typeof part.type === 'string'
    && (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))
}

function findFailure(
  parts: Record<string, unknown>[],
): DebugMessageFailure | null {
  for (const part of parts) {
    if (part.type !== 'text' || typeof part.text !== 'string') {
      continue
    }

    const notice = parsePersistedChatFailureNotice(part.text)

    if (notice) {
      return {
        message: toReportLabel(notice.message),
        ref: toDebugLabel(notice.requestId),
      }
    }
  }

  return null
}

function hasVisibleText(parts: Record<string, unknown>[]): boolean {
  return parts.some((part) => {
    return part.type === 'text'
      && typeof part.text === 'string'
      && part.text.trim().length > 0
  })
}

function resolveStatus(
  role: string,
  parts: Record<string, unknown>[],
  failure: DebugMessageFailure | null,
  pendingApprovals: number,
): DebugMessageStatus {
  if (role !== 'assistant') {
    return 'sent'
  }

  if (failure) {
    return 'failed'
  }

  if (pendingApprovals > 0) {
    return 'awaiting-approval'
  }

  const hasToolPart = parts.some(isToolPart)

  return hasVisibleText(parts) || hasToolPart ? 'complete' : 'empty'
}

function countTotalTokens(usage: DebugMessageRow['usage']): number | null {
  const total = usage?.totalTokens

  return typeof total === 'number' && Number.isFinite(total) ? total : null
}

/**
 * The ids and counters of one stored message. Built from an allow-list: the
 * text, tool input and output, tool error text and file names of the message
 * never enter the result. A failure is reported only when a text part is one
 * of the fixed failure notices Besidka itself writes.
 */
export function summarizeDebugMessage(row: DebugMessageRow): DebugMessage {
  const parts = Array.isArray(row.parts)
    ? row.parts.filter(isRecord)
    : []
  const toolParts = parts.filter(isToolPart)
  const pendingApprovals = toolParts.filter(isAwaitingApprovalToolPart).length
  const failure = row.role === 'assistant' ? findFailure(parts) : null

  return {
    id: row.publicId,
    role: row.role,
    createdAt: toIsoTimestamp(row.createdAt),
    status: resolveStatus(row.role, parts, failure, pendingApprovals),
    model: toDebugLabel(row.usage?.model),
    provider: toDebugLabel(row.usage?.provider),
    totalTokens: countTotalTokens(row.usage),
    reasoning: toDebugLabel(row.reasoning),
    toolCalls: toolParts.length,
    toolErrors: toolParts.filter((part) => {
      return part.state === 'output-error'
    }).length,
    toolsDenied: toolParts.filter((part) => {
      return part.state === 'output-denied'
    }).length,
    pendingApprovals,
    failure,
  }
}

function resolveHost(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return 'unknown'
  }
}

function resolveChatState(
  connectorId: string,
  states: { onIds: string[], offIds: string[] },
): DebugConnectorChatState {
  if (states.offIds.includes(connectorId)) {
    return 'off'
  }

  return states.onIds.includes(connectorId) ? 'on' : 'default'
}

async function loadConnectors(
  db: DbClient,
  userId: number,
  chatPublicId: string | null,
): Promise<DebugConnector[]> {
  const connectors = await listConnectors(db, userId)
  const states = chatPublicId
    ? await listChatConnectorStates(db, userId, chatPublicId)
    : { onIds: [], offIds: [] }

  return connectors.slice(0, DEBUG_INFO_MAX_CONNECTORS).map((connector) => {
    return {
      id: connector.id,
      title: toDebugLabel(connector.title) ?? '',
      host: resolveHost(connector.origin),
      mode: resolveConnectorToolMode(connector.toolMode),
      enabled: connector.enabled,
      status: connector.status,
      chatState: resolveChatState(connector.id, states),
      lastErrorCode: toDebugLabel(connector.lastError?.code),
    }
  })
}

async function loadFeatures(
  db: DbClient,
  kv: DebugKv,
  userId: number,
  logger: LoggerLike,
): Promise<DebugFeature[]> {
  const { features } = await listMyFeatures(db, kv, userId, logger)

  return features.map((feature) => {
    return {
      key: feature.key,
      title: feature.title,
      stage: feature.stage,
      active: feature.active,
      optedIn: feature.optedIn,
      variant: toDebugLabel(feature.variant),
    }
  })
}

async function loadGenerationLeases(
  kv: DebugKv,
  chatPublicId: string,
): Promise<string[] | null> {
  try {
    return await listChatGenerationLeases(chatPublicId, kv)
  } catch {
    return null
  }
}

async function loadChat(
  db: DbClient,
  kv: DebugKv,
  userId: number,
  slug: string,
  options: Pick<DebugInfoOptions, 'siteUrl' | 'maxMessages'>,
) {
  const chat = await db.select({
    id: schema.chats.id,
    slug: schema.chats.slug,
    projectId: schema.chats.projectId,
    branchedFromShareSlug: schema.chats.branchedFromShareSlug,
    memoryExcluded: schema.chats.memoryExcluded,
    createdAt: schema.chats.createdAt,
    activityAt: schema.chats.activityAt,
  })
    .from(schema.chats)
    .where(and(
      eq(schema.chats.slug, slug),
      eq(schema.chats.userId, userId),
    ))
    .get()

  if (!chat) {
    throw createError({
      status: 404,
      message: 'Chat not found.',
    })
  }

  const rows = await db.select({
    publicId: schema.messages.publicId,
    role: schema.messages.role,
    parts: schema.messages.parts,
    usage: schema.messages.usage,
    reasoning: schema.messages.reasoning,
    createdAt: schema.messages.createdAt,
  })
    .from(schema.messages)
    .where(eq(schema.messages.chatId, chat.id))
    .orderBy(desc(schema.messages.id))
    .limit(options.maxMessages)
  const messages = rows
    .filter((row) => {
      return isPersistedMessageRole(row.role)
    })
    .map(summarizeDebugMessage)
    .reverse()

  return {
    chatPublicId: chat.id,
    chat: {
      slug: chat.slug,
      url: `${options.siteUrl.replace(/\/+$/, '')}/chats/${chat.slug}`,
      projectId: chat.projectId,
      branchedFromShare: Boolean(chat.branchedFromShareSlug),
      memoryExcluded: chat.memoryExcluded === true,
      createdAt: toIsoTimestamp(chat.createdAt),
      activityAt: toIsoTimestamp(chat.activityAt),
      pendingApprovals: messages.reduce((total, message) => {
        return total + message.pendingApprovals
      }, 0),
      generationLeases: await loadGenerationLeases(kv, chat.id),
      messages,
    } satisfies DebugChat,
  }
}

export function buildDebugContactLine(supportEmail: string): string {
  const email = toDebugLabel(supportEmail)

  return email ? `Send this block to ${email}.` : ''
}

export function resolveDebugRuntime(): Pick<
  DebugInfoOptions,
  'siteUrl' | 'buildId' | 'supportEmail'
> {
  const config = useRuntimeConfig()
  const buildId = config.app?.buildId
  const supportEmail = config.public.supportEmail

  return {
    siteUrl: resolveMcpSiteUrl(),
    buildId: typeof buildId === 'string' ? buildId : null,
    supportEmail: typeof supportEmail === 'string' ? supportEmail : '',
  }
}

/**
 * Ids and metadata that help support or a developer follow one chat: the
 * chat slug and link, the newest messages with their model, status and
 * counters, the connectors and experimental features the caller can see,
 * the build and the time. It never carries message text, tool input or
 * output, keys, tokens, connector addresses beyond the host, share links or
 * other people's data. Connectors and features are left out unless the
 * caller may read them (`connectors:read`, `settings:read`, or a chat).
 */
export async function getDebugInfo(
  db: DbClient,
  kv: DebugKv,
  userId: number,
  options: DebugInfoOptions,
  logger: LoggerLike,
): Promise<DebugInfo> {
  const loaded = options.slug
    ? await loadChat(db, kv, userId, options.slug, options)
    : null
  const connectors = options.includeConnectors
    ? await loadConnectors(db, userId, loaded?.chatPublicId ?? null)
    : null
  const features = options.includeFeatures
    ? await loadFeatures(db, kv, userId, logger)
    : null

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    app: {
      buildId: toDebugLabel(options.buildId),
      mcpServerVersion: MCP_SERVER_VERSION,
    },
    chat: loaded?.chat ?? null,
    connectors,
    connectorsNote: connectors ? null : options.connectorsNote ?? null,
    features,
    contact: buildDebugContactLine(options.supportEmail),
  }
}

function formatYesNo(value: boolean): string {
  return value ? 'yes' : 'no'
}

function formatMessageLine(message: DebugMessage, index: number): string[] {
  const details = [
    `${index + 1}. ${message.id ?? 'no-id'}`,
    message.role,
    message.createdAt ?? 'unknown time',
    message.status,
  ]

  if (message.model) {
    details.push(`model=${message.model}`)
  }

  if (message.provider) {
    details.push(`provider=${message.provider}`)
  }

  if (message.totalTokens !== null) {
    details.push(`tokens=${message.totalTokens}`)
  }

  if (message.reasoning && message.reasoning !== 'off') {
    details.push(`reasoning=${message.reasoning}`)
  }

  if (message.toolCalls > 0) {
    details.push(
      `tools=${message.toolCalls}`
      + ` (errors ${message.toolErrors}, denied ${message.toolsDenied},`
      + ` pending approval ${message.pendingApprovals})`,
    )
  }

  const lines = [details.join(' | ')]

  if (message.failure) {
    lines.push(
      `   failure: ${message.failure.message}`
      + (message.failure.ref ? ` (ref: ${message.failure.ref})` : ''),
    )
  }

  return lines
}

function formatGenerationLeaseLine(leases: string[] | null): string {
  if (leases === null) {
    return 'Generation guard: unreadable'
  }

  if (!leases.length) {
    return 'Generation guard: free'
  }

  return `Generation guard: held for message ${leases.join(', ')}`
    + ' (a reply for that message is generating, or its run ended less'
    + ' than 2 minutes ago without releasing it; Stop frees it at once.'
    + ' When a chat model asked for this report, its own reply holds one)'
}

function formatChatLines(chat: DebugChat): string[] {
  return [
    '',
    `Chat: ${chat.slug}`,
    `Chat URL: ${chat.url}`,
    `Project: ${chat.projectId ?? 'none'}`,
    `Branched from a shared chat: ${formatYesNo(chat.branchedFromShare)}`,
    `Excluded from memory: ${formatYesNo(chat.memoryExcluded)}`,
    `Created: ${chat.createdAt ?? 'unknown'}`,
    `Last activity: ${chat.activityAt ?? 'unknown'}`,
    `Pending approvals: ${chat.pendingApprovals}`,
    formatGenerationLeaseLine(chat.generationLeases),
    '',
    `Last ${chat.messages.length} messages, oldest first:`,
    ...chat.messages.flatMap(formatMessageLine),
  ]
}

function formatConnectorLines(connectors: DebugConnector[]): string[] {
  if (!connectors.length) {
    return ['', 'Connectors: none']
  }

  return [
    '',
    'Connectors:',
    ...connectors.map((connector) => {
      return `- ${connector.id} | "${connector.title}" | ${connector.host}`
        + ` | mode=${connector.mode}`
        + ` | enabled=${formatYesNo(connector.enabled)}`
        + ` | status=${connector.status}`
        + ` | in this chat=${connector.chatState}`
        + (connector.lastErrorCode ? ` | error=${connector.lastErrorCode}` : '')
    }),
  ]
}

function formatFeatureLines(features: DebugFeature[]): string[] {
  if (!features.length) {
    return ['', 'Experimental features: none']
  }

  return [
    '',
    'Experimental features:',
    ...features.map((feature) => {
      return `- ${feature.key} | ${feature.stage}`
        + ` | active=${formatYesNo(feature.active)}`
        + ` | opted in=${formatYesNo(feature.optedIn)}`
        + (feature.variant ? ` | variant=${feature.variant}` : '')
    }),
  ]
}

/**
 * The whole result as one plain-text block, so a user can copy it in one go.
 */
export function formatDebugReport(info: DebugInfo): string {
  return [
    'Besidka debug info',
    `Generated: ${info.generatedAt}`,
    `App build: ${info.app.buildId ?? 'unknown'}`,
    `MCP server version: ${info.app.mcpServerVersion}`,
    ...(info.chat ? formatChatLines(info.chat) : ['', 'Chat: none']),
    ...(info.connectors ? formatConnectorLines(info.connectors) : []),
    ...(!info.connectors && info.connectorsNote
      ? ['', info.connectorsNote]
      : []),
    ...(info.features ? formatFeatureLines(info.features) : []),
    ...(info.contact ? ['', info.contact] : []),
  ].join('\n')
}
