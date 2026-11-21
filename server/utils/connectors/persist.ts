import type { UIMessage } from 'ai'
import {
  CONNECTOR_PERSISTED_OUTPUTS_MAX_BYTES,
  CONNECTOR_RESULT_MAX_BYTES,
} from '#shared/utils/connectors-policy'
import {
  buildConnectorCallErrorText,
  parseConnectorCallErrorText,
} from '#shared/utils/connectors-errors'
import {
  getConnectorToolPartName,
  parseConnectorToolName,
} from '#shared/utils/connectors-parts'
import { redactSecrets } from '~~/server/utils/connectors/tool-definitions'
import { truncateToByteBudget } from '~~/server/utils/skills/runtime/text'

type UiMessagePart = UIMessage['parts'][number]

const FRAME_OVERHEAD_BYTES = 1024
const PERSISTED_OUTPUT_MAX_BYTES = CONNECTOR_RESULT_MAX_BYTES
  + FRAME_OVERHEAD_BYTES
const PERSISTED_OUTPUT_MIN_BYTES = 1024
const PERSISTED_ERROR_TEXT = 'The connector tool call failed.'
export const PERSISTED_OUTPUT_SHORTENED_TEXT = '\n[Shortened when the reply '
  + 'was saved.]'
const SHORTENED_TEXT_BYTES = new TextEncoder()
  .encode(PERSISTED_OUTPUT_SHORTENED_TEXT)
  .byteLength

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function persistedErrorTextOf(errorText: string): string {
  const parsed = parseConnectorCallErrorText(errorText)

  return parsed
    ? buildConnectorCallErrorText(parsed.category, parsed.reference)
    : PERSISTED_ERROR_TEXT
}

function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    return redactSecrets(value, secrets)
  }

  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, secrets))
  }

  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      return [key, redactValue(item, secrets)]
    }))
  }

  return value
}

function isConnectorToolPart(part: unknown): part is Record<string, unknown> {
  const toolName = getConnectorToolPartName(part)

  return isRecord(part)
    && toolName !== null
    && parseConnectorToolName(toolName) !== null
}

/**
 * The byte cap of each stored connector output: the 64 KiB cap while all
 * outputs of the reply fit `CONNECTOR_PERSISTED_OUTPUTS_MAX_BYTES`, else an
 * equal share of that budget (at least 1 KiB), so a long connector task
 * (up to `CONNECTOR_CALLS_PER_TURN` calls in each of
 * `TOOL_ROUNDS_PER_MESSAGE` rounds, 500 outputs) never pushes the reply
 * over the D1 row guard that would replace it whole.
 */
function persistedOutputCapOf(parts: UIMessage['parts']): number {
  const outputCount = parts.filter((part) => {
    const record: unknown = part

    return isConnectorToolPart(record) && typeof record.output === 'string'
  }).length

  if (outputCount * PERSISTED_OUTPUT_MAX_BYTES
    <= CONNECTOR_PERSISTED_OUTPUTS_MAX_BYTES) {
    return PERSISTED_OUTPUT_MAX_BYTES
  }

  return Math.max(
    PERSISTED_OUTPUT_MIN_BYTES,
    Math.floor(CONNECTOR_PERSISTED_OUTPUTS_MAX_BYTES / outputCount),
  )
}

function persistedOutputOf(
  output: string,
  secrets: readonly string[],
  maxBytes: number,
): string {
  const redacted = redactSecrets(output, secrets)
  const whole = truncateToByteBudget(redacted, maxBytes)

  if (!whole.isTruncated) {
    return whole.text
  }

  const shortened = truncateToByteBudget(
    redacted,
    maxBytes - SHORTENED_TEXT_BYTES,
  )

  return `${shortened.text}${PERSISTED_OUTPUT_SHORTENED_TEXT}`
}

/**
 * Prepares the `dynamic-tool` parts of connector calls (`mcp__<slug>__<tool>`)
 * for `messages.parts`: the output, which is already redacted and capped when
 * the tool ran, is redacted again and cut to the 64 KiB cap (a smaller equal
 * share when the reply holds many calls, `persistedOutputCapOf`), and the
 * input is redacted of this send's credentials. An error text is replaced,
 * because it could carry text a remote server wrote: one that carries a
 * category and a support reference is rebuilt from just those two fields,
 * anything else becomes one fixed sentence. Both `dynamic-tool` and
 * static `tool-<name>` parts are covered. Every other part passes through.
 * Pure: the input is never mutated.
 */
export function redactConnectorToolPartsForPersistence(
  parts: UIMessage['parts'],
  secrets: readonly string[],
): UIMessage['parts'] {
  const outputCap = persistedOutputCapOf(parts)

  return parts.map((part) => {
    const record: unknown = part

    if (!isConnectorToolPart(record)) {
      return part
    }

    const redacted: Record<string, unknown> = { ...record }

    if ('input' in record) {
      redacted.input = redactValue(record.input, secrets)
    }

    if (typeof record.output === 'string') {
      redacted.output = persistedOutputOf(record.output, secrets, outputCap)
    }

    if (typeof record.errorText === 'string') {
      redacted.errorText = persistedErrorTextOf(record.errorText)
    }

    return redacted as UiMessagePart
  })
}
