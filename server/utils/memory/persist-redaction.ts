import type { UIMessage } from 'ai'
import { isMemoryToolName } from '~~/server/utils/ai/memory-tools'

type UiMessagePart = UIMessage['parts'][number]

const TOOL_PART_PREFIX = 'tool-'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMemoryToolPart(part: Record<string, unknown>): boolean {
  if (typeof part.type !== 'string') {
    return false
  }

  if (part.type === 'dynamic-tool') {
    return typeof part.toolName === 'string' && isMemoryToolName(part.toolName)
  }

  return part.type.startsWith(TOOL_PART_PREFIX)
    && isMemoryToolName(part.type.slice(TOOL_PART_PREFIX.length))
}

function omitKey(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([entryKey]) => entryKey !== key),
  )
}

function omitBody(entry: unknown): unknown {
  if (!isRecord(entry) || !('body' in entry)) {
    return entry
  }

  return omitKey(entry, 'body')
}

function redactOutput(output: unknown): unknown {
  if (!isRecord(output)) {
    return output
  }

  const redacted = omitKey(output, 'previous')

  if (Array.isArray(output.entries)) {
    redacted.entries = output.entries.map(omitBody)
  }

  if ('entry' in output) {
    redacted.entry = omitBody(output.entry)
  }

  return redacted
}

function redactMemoryToolPart(
  part: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = { ...part }

  if ('input' in part) {
    redacted.input = omitBody(part.input)
  }

  if ('rawInput' in part) {
    if (isRecord(part.rawInput)) {
      redacted.rawInput = omitBody(part.rawInput)
    } else {
      delete redacted.rawInput
    }
  }

  if ('output' in part) {
    redacted.output = redactOutput(part.output)
  }

  return redacted
}

/**
 * Strips memory bodies from the assistant tool parts of the memory tools
 * before they are written to `messages.parts`, so a body cannot outlive its
 * entry (forget, delete, reset or the Art. 9 opt-out purge). Ids, handles,
 * titles, categories, state, error text and the quoted user request stay.
 * Pure: the input array and its parts are never mutated.
 */
export function redactMemoryToolPartsForPersistence(
  parts: UIMessage['parts'],
): UIMessage['parts'] {
  return parts.map((part) => {
    if (!isRecord(part) || !isMemoryToolPart(part)) {
      return part
    }

    return redactMemoryToolPart(part) as UiMessagePart
  })
}
