import type { UIMessage } from 'ai'
import type {
  ToolApprovalReason,
  ToolApprovalRemember,
} from '#shared/utils/tool-approval-policy'
import type { ToolApprovalPartData } from '#shared/utils/tool-approval-parts'
import type { ToolApprovalFailure } from '~/composables/tool-approvals'
import {
  isToolApprovalDataPart,
  isToolGrantDataPart,
  readApprovalLink,
} from '#shared/utils/tool-approval-parts'
import {
  getConnectorToolCall,
  parseConnectorToolName,
} from '#shared/utils/connectors-parts'
import { TOOL_APPROVAL_REASONS } from '#shared/utils/tool-approval-policy'
import {
  BESIDKA_TOOL_NAME_PREFIX,
  isBesidkaChatToolName,
} from '#shared/utils/besidka-tool-permissions'
import {
  GOOGLE_EGRESS_REASON_TEXT,
  GOOGLE_TOOL_CHAT_GRANT_LABELS,
  GOOGLE_TOOL_NAME_PREFIX,
  isGoogleToolName,
} from '#shared/utils/google-tool-approvals'
import { formatConnectorArguments } from '~/utils/connector-step'

export type ApprovalStepState
  = | 'pending'
    | 'answered'
    | 'sending'
    | 'approved'
    | 'denied'
    | 'expired'
    | 'interrupted'

export interface ApprovalStepModel {
  approvalId: string
  toolCallId: string
  toolName: string
  connectorSlug: string | null
  isBesidka: boolean
  tool: string
  reason: ToolApprovalReason
  summary: string
  rememberOptions: ToolApprovalRemember[]
  preview: string
  link?: string
  input: unknown
  partState: string
  approved: boolean | null
}

export interface ApprovalStepContext {
  isLastMessage: boolean
  sendingApprovalIds: ReadonlySet<string>
  answeredApprovalIds: ReadonlySet<string>
  failures: Readonly<Record<string, ToolApprovalFailure>>
  isEveryCallAnswered: boolean
}

export interface ApprovalButton {
  remember: ToolApprovalRemember
  label: string
}

const AWAITING_STATES = new Set<string>([
  'approval-requested',
  'approval-responded',
])

const SETTLED_APPROVED_STATES = new Set<string>([
  'output-available',
  'output-error',
])

const REMEMBER_ORDER: readonly ToolApprovalRemember[] = [
  'once',
  'chat',
  'always',
]

const REMEMBER_LABELS: Record<ToolApprovalRemember, string> = {
  once: 'Allow once',
  chat: 'Allow in this chat',
  always: 'Always allow',
}

const NATIVE_APPROVAL_TITLES: Record<string, string> = {
  memory_write: 'Save to memory',
  memory_forget: 'Forget a memory',
  create_artifact: 'Create an artifact',
  update_artifact: 'Update an artifact',
  create_document: 'Create a document',
  run_skill_scripts: 'Run skill scripts',
}

const SUMMARY_ONLY_INPUT_TOOLS = new Set<string>([
  'create_artifact',
  'update_artifact',
  'create_document',
])

const WEB_SOURCE_TOOL_NAMES = new Set<string>([
  'web_search',
  'google_search',
  'url_context',
  'brave_search',
  'exa_search',
])

const REDACTED_MARKER = '[redacted]'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readToolName(part: Record<string, unknown>): string | null {
  if (part.type === 'dynamic-tool') {
    return typeof part.toolName === 'string' ? part.toolName : null
  }

  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    return part.type.slice('tool-'.length)
  }

  return null
}

function isApprovalReason(value: unknown): value is ToolApprovalReason {
  return typeof value === 'string'
    && (TOOL_APPROVAL_REASONS as readonly string[]).includes(value)
}

function readRememberOptions(value: unknown): ToolApprovalRemember[] {
  if (!Array.isArray(value)) {
    return ['once']
  }

  const offered = REMEMBER_ORDER.filter(option => value.includes(option))

  return offered.length > 0 ? offered : ['once']
}

/**
 * The server-written `data-tool-approval` parts of a message, keyed by the
 * tool call they describe.
 */
export function getApprovalDataByToolCallId(
  parts: UIMessage['parts'],
): Map<string, ToolApprovalPartData> {
  const dataByToolCallId = new Map<string, ToolApprovalPartData>()

  for (const part of parts) {
    if (!isToolApprovalDataPart(part)) {
      continue
    }

    const { data } = part

    if (typeof data.toolCallId === 'string') {
      dataByToolCallId.set(data.toolCallId, data)
    }
  }

  return dataByToolCallId
}

/**
 * The approval a tool part carries: a call that waits for the user, or a
 * call the user answered (its result or denial arrived). Null for a tool
 * part that never asked.
 */
export function getApprovalStepModel(
  part: unknown,
  dataByToolCallId: ReadonlyMap<string, ToolApprovalPartData>,
): ApprovalStepModel | null {
  if (!isRecord(part) || typeof part.state !== 'string') {
    return null
  }

  const toolName = readToolName(part)
  const approval = isRecord(part.approval) ? part.approval : null
  const approvalId = typeof approval?.id === 'string' ? approval.id : null
  const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : ''

  if (!toolName || !approvalId) {
    return null
  }

  const data = dataByToolCallId.get(toolCallId)
  const isAwaiting = AWAITING_STATES.has(part.state)
  const isDenied = part.state === 'output-denied'
  const isSettledApproved = SETTLED_APPROVED_STATES.has(part.state)
    && approval?.approved === true

  if (!isAwaiting && !isDenied && !isSettledApproved) {
    return null
  }

  if (!isAwaiting && !data) {
    return null
  }

  const connector = parseConnectorToolName(toolName)
  const isBesidka = isBesidkaChatToolName(toolName)
  const link = readApprovalLink(data?.link)

  return {
    approvalId,
    toolCallId,
    toolName,
    connectorSlug: connector?.slug ?? null,
    isBesidka,
    tool: isBesidka
      ? toolName.slice(BESIDKA_TOOL_NAME_PREFIX.length)
      : connector?.tool ?? toolName,
    reason: isApprovalReason(data?.reason) ? data.reason : 'default',
    summary: typeof data?.summary === 'string' ? data.summary : '',
    rememberOptions: readRememberOptions(data?.rememberOptions),
    preview: typeof data?.preview === 'string' ? data.preview : '',
    ...(link ? { link } : {}),
    input: part.input,
    partState: part.state,
    approved: typeof approval?.approved === 'boolean'
      ? approval.approved
      : null,
  }
}

export function resolveApprovalStepState(
  model: ApprovalStepModel,
  context: ApprovalStepContext,
): ApprovalStepState {
  if (model.partState === 'output-denied') {
    return 'denied'
  }

  if (SETTLED_APPROVED_STATES.has(model.partState)) {
    return 'approved'
  }

  const failure = context.failures[model.approvalId]

  if (failure) {
    return failure
  }

  if (!context.isLastMessage) {
    return 'expired'
  }

  if (model.partState === 'approval-requested') {
    return 'pending'
  }

  if (context.sendingApprovalIds.has(model.approvalId)) {
    return 'sending'
  }

  if (!context.isEveryCallAnswered) {
    return 'answered'
  }

  return context.answeredApprovalIds.has(model.approvalId)
    ? 'sending'
    : 'interrupted'
}

export function getApprovalStepTitle(
  model: ApprovalStepModel,
  connectorTitle: string | undefined,
): string {
  if (model.connectorSlug) {
    return `${connectorTitle || model.connectorSlug} wants to run ${model.tool}`
  }

  if (model.isBesidka) {
    return model.summary.trim() || `Besidka wants to ${
      humanizeBesidkaToolName(model.tool)
    }`
  }

  if (isGoogleToolName(model.toolName)) {
    return model.summary.trim() || `Besidka wants to ${
      humanizeBesidkaToolName(model.tool.slice(GOOGLE_TOOL_NAME_PREFIX.length))
    } on Google`
  }

  return NATIVE_APPROVAL_TITLES[model.tool] ?? `Run ${model.tool}`
}

const PREVIEW_COLLAPSED_MAX_CHARS = 500

/**
 * The start of a content write's text for the approval step; the full text
 * is in View details.
 */
export function clipApprovalPreview(preview: string): {
  text: string
  isClipped: boolean
} {
  const characters = Array.from(preview)

  if (characters.length <= PREVIEW_COLLAPSED_MAX_CHARS) {
    return { text: preview, isClipped: false }
  }

  return {
    text: `${characters.slice(0, PREVIEW_COLLAPSED_MAX_CHARS).join('')}…`,
    isClipped: true,
  }
}

export function humanizeBesidkaToolName(tool: string): string {
  return tool.replaceAll('_', ' ')
}

/**
 * The tooltip of the "Always allow" button. One click answers; there is no
 * second confirmation (owner decision of 2026-11-20).
 */
export function getAlwaysAllowHint(isBesidka: boolean): string {
  return isBesidka
    ? 'Runs without asking in every chat. Change it in Tool permissions.'
    : 'Runs without asking in every chat until the tool changes. '
      + 'Remove it in the chat panel.'
}

/**
 * The line under the title of an approval step. A Besidka step has none:
 * its server-written summary already is the title.
 */
export function getApprovalStepSummaryLine(model: ApprovalStepModel): string {
  if (model.isBesidka || isGoogleToolName(model.toolName)) {
    return ''
  }

  return getApprovalSummaryLine(model.summary)
}

/**
 * The summary line under the title, or an empty string when the summary
 * only restates the title (today's server summaries all do).
 */
export function getApprovalSummaryLine(summary: string): string {
  const text = summary.trim()

  if (!text || text.startsWith('Besidka wants to ')) {
    return ''
  }

  return / wants to run \S+$/.test(text) ? '' : text
}

/**
 * Where untrusted content in this message came from, read from the parts
 * before the approval: the last connector that answered, else the web.
 */
export function getApprovalSourceLabel(
  parts: UIMessage['parts'],
  partIndex: number,
  titlesBySlug: ReadonlyMap<string, string>,
): string {
  for (let index = partIndex - 1; index >= 0; index -= 1) {
    const part = parts[index]

    if (!part) {
      continue
    }

    if (part.type === 'source-url') {
      return 'the web'
    }

    const connectorCall = getConnectorToolCall(part)

    if (connectorCall?.outcome === 'ok') {
      return titlesBySlug.get(connectorCall.slug) || connectorCall.slug
    }

    const toolName = isRecord(part) ? readToolName(part) : null

    if (
      toolName
      && isBesidkaChatToolName(toolName)
      && (part as { state?: unknown }).state === 'output-available'
    ) {
      return 'your Besidka data'
    }

    if (toolName && WEB_SOURCE_TOOL_NAMES.has(toolName)) {
      return 'the web'
    }
  }

  return ''
}

export function getApprovalReasonText(
  reason: ToolApprovalReason,
  sourceLabel: string,
  toolName = '',
): string {
  if (reason === 'untrusted-output') {
    return sourceLabel
      ? `Because this message read content from ${sourceLabel}`
      : 'Because this message read content from outside Besidka'
  }

  if (reason === 'cross-source') {
    return 'Because it would use a different connector'
  }

  if (reason === 'always-ask') {
    return 'Changes or deletes data'
  }

  if (reason === 'consent') {
    return 'Uploads the skill to your Anthropic workspace'
  }

  if (reason === 'google-egress') {
    return GOOGLE_EGRESS_REASON_TEXT
  }

  if (isBesidkaChatToolName(toolName)) {
    return 'Asks before each use. Change it in Tool permissions in Labs.'
  }

  if (parseConnectorToolName(toolName)) {
    return 'Asks before each use. Change it in the connector\'s tool settings.'
  }

  return 'Runs only after you allow it'
}

export function getApprovalButtons(
  rememberOptions: readonly ToolApprovalRemember[],
  toolName?: string,
): ApprovalButton[] {
  const chatLabel = toolName && Object.hasOwn(
    GOOGLE_TOOL_CHAT_GRANT_LABELS,
    toolName,
  )
    ? GOOGLE_TOOL_CHAT_GRANT_LABELS[toolName]
    : undefined

  return REMEMBER_ORDER
    .filter(option => rememberOptions.includes(option))
    .map((remember) => {
      return {
        remember,
        label: remember === 'chat' && chatLabel
          ? chatLabel
          : REMEMBER_LABELS[remember],
      }
    })
}

export function formatApprovalArguments(input: unknown): string {
  return formatConnectorArguments(input)
}

/**
 * True when the arguments shown may differ from what runs: secrets were
 * redacted, the text was cut, or the stored copy keeps only a summary
 * (artifact and document writes keep kind or format and title).
 */
export function isApprovalInputShortened(
  model: ApprovalStepModel,
  argumentsText: string,
): boolean {
  if (argumentsText.includes(REDACTED_MARKER) || argumentsText.endsWith('…')) {
    return true
  }

  return SUMMARY_ONLY_INPUT_TOOLS.has(model.tool) && !model.connectorSlug
}

export function formatApprovalTime(timestamp: number | undefined): string {
  if (!timestamp) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export function formatApprovalOutcome(
  state: 'approved' | 'denied',
  timestamp: number | undefined,
): string {
  const label = state === 'approved' ? 'Allowed' : 'Denied'
  const time = formatApprovalTime(timestamp)

  return time ? `${label} · ${time}` : label
}

export function formatApprovalProgress(
  answeredCount: number,
  totalCount: number,
): string {
  if (totalCount < 2) {
    return ''
  }

  return `${answeredCount} of ${totalCount} answered`
}

const GRANT_MARKER_TEXT = {
  always: 'Ran without asking (Always allowed)',
  chat: 'Ran without asking (Allowed in this chat)',
} as const

/**
 * The line under a tool step that ran without asking because of a grant
 * the user gave, read from the server-written `data-tool-grant` part with
 * the same tool call id, or an empty string.
 */
export function getGrantMarkerText(
  parts: UIMessage['parts'],
  toolCallId: string | undefined,
): string {
  if (!toolCallId) {
    return ''
  }

  const grantPart = parts.find((part) => {
    return isToolGrantDataPart(part) && part.data.toolCallId === toolCallId
  })

  return isToolGrantDataPart(grantPart)
    ? GRANT_MARKER_TEXT[grantPart.data.scope]
    : ''
}

/**
 * The grant line of every tool call of a message that ran under a grant,
 * keyed by tool call id, read in one pass over the parts.
 */
export function getGrantMarkersByToolCallId(
  parts: UIMessage['parts'],
): Map<string, string> {
  const markers = new Map<string, string>()

  for (const part of parts) {
    if (!isToolGrantDataPart(part) || markers.has(part.data.toolCallId)) {
      continue
    }

    markers.set(part.data.toolCallId, GRANT_MARKER_TEXT[part.data.scope])
  }

  return markers
}
