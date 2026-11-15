import {
  CONNECTOR_RESULT_TAG,
  CONNECTOR_TOOL_NAME_PREFIX,
} from '#shared/utils/connectors-policy'

export const CONNECTORS_NOTICE_PART_TYPE = 'data-connectors-notice'

export const CONNECTOR_APPROVAL_DENIAL_TEXT = 'This tool needs your approval; '
  + 'approvals arrive in the next update.'

export const CONNECTOR_CROSS_CONNECTOR_DENIAL_TEXT = 'This tool belongs to a '
  + 'different connector than the one already used in this message, so it '
  + 'cannot run without your approval; approvals arrive in the next update.'

export const CONNECTOR_CALL_LIMIT_TEXT = 'Connector call limit for this '
  + 'message reached. Answer with what you already have.'

export const CONNECTOR_RATE_LIMIT_TEXT = 'This connector received too many '
  + 'calls in the last minute. Try again later.'

const DENIAL_TEXTS: readonly string[] = [
  CONNECTOR_APPROVAL_DENIAL_TEXT,
  CONNECTOR_CROSS_CONNECTOR_DENIAL_TEXT,
]
const LIMIT_TEXTS: readonly string[] = [
  CONNECTOR_CALL_LIMIT_TEXT,
  CONNECTOR_RATE_LIMIT_TEXT,
]
const TOOL_NAME_SEPARATOR = '__'
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
  outcome: ConnectorToolOutcome | null
  isFramed: boolean
  input: unknown
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
 * from the part state.
 */
export function getConnectorToolCall(
  part: unknown,
): ConnectorToolCallModel | null {
  if (
    !isRecord(part)
    || part.type !== 'dynamic-tool'
    || typeof part.toolName !== 'string'
  ) {
    return null
  }

  const parsed = parseConnectorToolName(part.toolName)

  if (!parsed) {
    return null
  }

  const state = typeof part.state === 'string' ? part.state : ''
  const isRunning = RUNNING_STATES.has(state)
  let outcome: ConnectorToolOutcome | null = null

  if (!isRunning) {
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
    outcome,
    isFramed: isFramedConnectorOutput(part.output),
    input: part.input,
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
 * call, or the slim marker a branch keeps in place of the calls it strips.
 */
export function isConnectorUsagePart(part: unknown): boolean {
  return getConnectorToolCall(part) !== null || isConnectorUsedMarker(part)
}
