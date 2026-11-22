import {
  CONNECTOR_RESULT_TAG,
  CONNECTOR_TOOL_NAME_PREFIX,
} from '#shared/utils/connectors-policy'
import { parseConnectorCallErrorText } from '#shared/utils/connectors-errors'
import type {
  ParsedConnectorCallError,
} from '#shared/utils/connectors-errors'
import { isAwaitingApprovalToolPart } from '#shared/utils/tool-approval-parts'

export const CONNECTORS_NOTICE_PART_TYPE = 'data-connectors-notice'

export const CONNECTOR_APPROVAL_DENIAL_TEXT = 'This tool needs your approval; '
  + 'approvals arrive in the next update.'

export const CONNECTOR_CROSS_CONNECTOR_DENIAL_TEXT = 'This tool belongs to a '
  + 'different connector than the one already used in this message, so it '
  + 'cannot run without your approval; approvals arrive in the next update.'

export const CONNECTOR_UNAPPROVED_CALL_TEXT = 'This tool call was not '
  + 'approved, so it did not run.'

const CONNECTOR_CALL_LIMIT_PREFIX = 'Connector call limit for this '
  + 'message reached.'

export const CONNECTOR_CALL_LIMIT_TEXT = `${CONNECTOR_CALL_LIMIT_PREFIX} `
  + 'Stop calling tools now. Briefly say what is done and what is left, so '
  + 'the work can continue in the next message.'

export const CONNECTOR_RATE_LIMIT_TEXT = 'This connector received too many '
  + 'calls in the last minute.'

/**
 * The refusal of a call over the per-minute connector limit, with how long
 * to wait, so the model can pace itself instead of giving up.
 */
export function buildConnectorRateLimitText(retryAfterSeconds: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds))

  return `${CONNECTOR_RATE_LIMIT_TEXT} This call did not run. Wait about `
    + `${seconds} seconds before you call this connector again, or continue `
    + 'without it.'
}

const DENIAL_TEXTS: readonly string[] = [
  CONNECTOR_APPROVAL_DENIAL_TEXT,
  CONNECTOR_CROSS_CONNECTOR_DENIAL_TEXT,
  CONNECTOR_UNAPPROVED_CALL_TEXT,
]
const LIMIT_TEXTS: readonly string[] = [
  CONNECTOR_CALL_LIMIT_PREFIX,
  CONNECTOR_RATE_LIMIT_TEXT,
]
const TOOL_NAME_SEPARATOR = '__'
const STATIC_TOOL_PART_PREFIX = 'tool-'
const FRAMED_OUTPUT_PREFIX = `<${CONNECTOR_RESULT_TAG}`
const RUNNING_STATES = new Set<string>(['input-streaming', 'input-available'])
const FAILED_STATES = new Set<string>(['output-error', 'output-denied'])

export type ConnectorToolOutcome = 'ok' | 'error' | 'denied' | 'limited'

export interface ParsedConnectorToolName {
  slug: string
  tool: string
}

export interface ConnectorToolCallModel {
  slug: string
  tool: string
  isRunning: boolean
  isAwaitingApproval: boolean
  outcome: ConnectorToolOutcome | null
  isFramed: boolean
  input: unknown
  error: ParsedConnectorCallError | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Splits an exposed connector tool name (`mcp__<slug>__<tool>`). Slugs never
 * contain underscores, so the slug is the text up to the next `__`.
 */
export function parseConnectorToolName(
  toolName: string,
): ParsedConnectorToolName | null {
  if (!toolName.startsWith(CONNECTOR_TOOL_NAME_PREFIX)) {
    return null
  }

  const remainder = toolName.slice(CONNECTOR_TOOL_NAME_PREFIX.length)
  const separatorIndex = remainder.indexOf(TOOL_NAME_SEPARATOR)

  if (separatorIndex <= 0) {
    return null
  }

  const tool = remainder.slice(separatorIndex + TOOL_NAME_SEPARATOR.length)

  if (!tool) {
    return null
  }

  return { slug: remainder.slice(0, separatorIndex), tool }
}

/**
 * The exposed tool name of a tool part, whether it is a `dynamic-tool` part
 * or a static `tool-<name>` part, or null for any other part.
 */
export function getConnectorToolPartName(part: unknown): string | null {
  if (!isRecord(part) || typeof part.type !== 'string') {
    return null
  }

  if (part.type === 'dynamic-tool') {
    return typeof part.toolName === 'string' ? part.toolName : null
  }

  return part.type.startsWith(STATIC_TOOL_PART_PREFIX)
    ? part.type.slice(STATIC_TOOL_PART_PREFIX.length)
    : null
}

export function isFramedConnectorOutput(output: unknown): boolean {
  return typeof output === 'string'
    && output.trimStart().startsWith(FRAMED_OUTPUT_PREFIX)
}

export function isConnectorApprovalDenial(output: unknown): boolean {
  if (typeof output !== 'string') {
    return false
  }

  const trimmed = output.trim()

  return DENIAL_TEXTS.some(text => trimmed.startsWith(text))
}

export function isConnectorLimitRefusal(output: unknown): boolean {
  if (typeof output !== 'string') {
    return false
  }

  const trimmed = output.trim()

  return LIMIT_TEXTS.some(text => trimmed.startsWith(text))
}

/**
 * The persisted `dynamic-tool` part of one connector call as a render model,
 * or null for every other part. A denial arrives as a successful result with
 * a plain sentence, so the outcome is read from the output text, not only
 * from the part state. A call that waits for approval has no outcome yet.
 */
export function getConnectorToolCall(
  part: unknown,
): ConnectorToolCallModel | null {
  const toolName = getConnectorToolPartName(part)

  if (!isRecord(part) || toolName === null) {
    return null
  }

  const parsed = parseConnectorToolName(toolName)

  if (!parsed) {
    return null
  }

  const state = typeof part.state === 'string' ? part.state : ''
  const isRunning = RUNNING_STATES.has(state)
  const isAwaitingApproval = isAwaitingApprovalToolPart(part)
  let outcome: ConnectorToolOutcome | null = null

  if (!isRunning && !isAwaitingApproval) {
    if (FAILED_STATES.has(state)) {
      outcome = 'error'
    } else if (isConnectorApprovalDenial(part.output)) {
      outcome = 'denied'
    } else if (isConnectorLimitRefusal(part.output)) {
      outcome = 'limited'
    } else {
      outcome = 'ok'
    }
  }

  return {
    ...parsed,
    isRunning,
    isAwaitingApproval,
    outcome,
    isFramed: isFramedConnectorOutput(part.output),
    input: part.input,
    error: outcome === 'error'
      ? parseConnectorCallErrorText(part.errorText)
      : null,
  }
}

export function getConnectorNoticeLines(
  message: { parts: readonly unknown[] },
): string[] {
  const lines: string[] = []

  for (const part of message.parts) {
    if (
      !isRecord(part)
      || part.type !== CONNECTORS_NOTICE_PART_TYPE
      || !isRecord(part.data)
      || !Array.isArray(part.data.lines)
    ) {
      continue
    }

    for (const line of part.data.lines) {
      if (typeof line === 'string' && line.trim()) {
        lines.push(line.trim())
      }
    }
  }

  return [...new Set(lines)]
}

export function buildConnectorUsedMarkerPart() {
  return {
    type: CONNECTORS_NOTICE_PART_TYPE,
    data: { lines: [], usedConnector: true },
  }
}

export function isConnectorUsedMarker(part: unknown): boolean {
  return isRecord(part)
    && part.type === CONNECTORS_NOTICE_PART_TYPE
    && isRecord(part.data)
    && part.data.usedConnector === true
}

/**
 * Whether a persisted part shows that the answer used a connector: a connector
 * call, or the slim marker a branch keeps in place of the calls it strips. A
 * call that still waits for approval never ran, so it does not count.
 */
export function isConnectorUsagePart(part: unknown): boolean {
  const call = getConnectorToolCall(part)

  if (call) {
    return !call.isAwaitingApproval
  }

  return isConnectorUsedMarker(part)
}
