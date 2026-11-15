import type { UIMessage } from 'ai'
import { CONNECTOR_RESULT_MAX_BYTES } from '#shared/utils/connectors-policy'
import { parseConnectorToolName } from '#shared/utils/connectors-parts'
import { redactSecrets } from '~~/server/utils/connectors/tool-definitions'
import { truncateToByteBudget } from '~~/server/utils/skills/runtime/text'

type UiMessagePart = UIMessage['parts'][number]

const FRAME_OVERHEAD_BYTES = 1024
const PERSISTED_OUTPUT_MAX_BYTES = CONNECTOR_RESULT_MAX_BYTES
  + FRAME_OVERHEAD_BYTES
const PERSISTED_ERROR_TEXT = 'The connector tool call failed.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

/**
 * Prepares the `dynamic-tool` parts of connector calls (`mcp__<slug>__<tool>`)
 * for `messages.parts`: the output, which is already redacted and capped when
 * the tool ran, is redacted again and cut to the 64 KiB cap, and the input is
 * redacted of this send's credentials. An error text is replaced by a fixed
 * sentence, because it could carry text a remote server wrote. Every other
 * part passes through. Pure: the input is never mutated.
 */
export function redactConnectorToolPartsForPersistence(
  parts: UIMessage['parts'],
  secrets: readonly string[],
): UIMessage['parts'] {
  return parts.map((part) => {
    if (
      !isRecord(part)
      || part.type !== 'dynamic-tool'
      || typeof part.toolName !== 'string'
      || !parseConnectorToolName(part.toolName)
    ) {
      return part
    }

    const redacted: Record<string, unknown> = { ...part }

    if ('input' in part) {
      redacted.input = redactValue(part.input, secrets)
    }

    if (typeof part.output === 'string') {
      redacted.output = truncateToByteBudget(
        redactSecrets(part.output, secrets),
        PERSISTED_OUTPUT_MAX_BYTES,
      ).text
    }

    if (typeof part.errorText === 'string') {
      redacted.errorText = PERSISTED_ERROR_TEXT
    }

    return redacted as UiMessagePart
  })
}
