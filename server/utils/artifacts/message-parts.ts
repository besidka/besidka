import type { UIMessage } from 'ai'
import type { DataArtifactPart } from '#shared/utils/artifacts'
import {
  ARTIFACT_DATA_PART_TYPE,
  isArtifactKind,
  isDataArtifactPart,
} from '#shared/utils/artifacts'

export const CREATE_ARTIFACT_TOOL_NAME = 'create_artifact'
export const UPDATE_ARTIFACT_TOOL_NAME = 'update_artifact'

export const ARTIFACT_TOOL_NAMES: readonly string[] = [
  CREATE_ARTIFACT_TOOL_NAME,
  UPDATE_ARTIFACT_TOOL_NAME,
]

const ARTIFACT_TOOL_PART_TYPES = new Set(ARTIFACT_TOOL_NAMES.map((name) => {
  return `tool-${name}`
}))

type MessagePart = UIMessage['parts'][number]

export function isArtifactToolName(toolName: string): boolean {
  return ARTIFACT_TOOL_NAMES.includes(toolName)
}

export function isArtifactToolPartType(type: unknown): boolean {
  return typeof type === 'string' && ARTIFACT_TOOL_PART_TYPES.has(type)
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function toDataArtifactPart(output: unknown): DataArtifactPart | null {
  const record = readRecord(output)

  if (!record) {
    return null
  }

  const candidate = {
    type: ARTIFACT_DATA_PART_TYPE,
    data: {
      artifactId: record.artifactId,
      version: record.version,
      kind: record.kind,
      title: record.title,
    },
  }

  return isDataArtifactPart(candidate) ? candidate : null
}

function toFailedToolPart(part: Record<string, unknown>): MessagePart {
  const input = readRecord(part.input)
  const kind = isArtifactKind(input?.kind) ? input.kind : undefined
  const title = typeof input?.title === 'string' ? input.title : undefined

  return {
    type: part.type,
    toolCallId: part.toolCallId,
    state: 'output-error',
    input: {
      ...(kind ? { kind } : {}),
      ...(title ? { title } : {}),
    },
    errorText: typeof part.errorText === 'string'
      ? part.errorText
      : 'The artifact could not be saved.',
  } as MessagePart
}

/**
 * Rewrites the artifact tool parts of an assistant message for persistence
 * so `messages.parts` never holds artifact content: a finished call becomes
 * a small `data-artifact` reference, a failed call keeps only its kind,
 * title and error text, and an unfinished call (an interrupted stream) is
 * dropped. Every other part is returned unchanged.
 */
export function rewriteArtifactToolParts(
  parts: UIMessage['parts'],
): UIMessage['parts'] {
  const rewritten: UIMessage['parts'] = []

  for (const part of parts) {
    if (!isArtifactToolPartType(part.type)) {
      rewritten.push(part)

      continue
    }

    const record = part as unknown as Record<string, unknown>

    if (record.state === 'output-available') {
      const dataPart = toDataArtifactPart(record.output)

      if (dataPart) {
        rewritten.push(dataPart as unknown as MessagePart)
      }

      continue
    }

    if (record.state === 'output-error') {
      rewritten.push(toFailedToolPart(record))
    }
  }

  return rewritten
}

/**
 * Artifact ids referenced by `data-artifact` parts in the loaded history,
 * most recent reference first, each id once.
 */
export function collectReferencedArtifactIds(
  messages: ReadonlyArray<{ parts: unknown }>,
): string[] {
  const ids: string[] = []

  for (let index = messages.length - 1; index >= 0; index--) {
    const parts = messages[index]?.parts

    if (!Array.isArray(parts)) {
      continue
    }

    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const part = parts[partIndex]

      if (isDataArtifactPart(part) && !ids.includes(part.data.artifactId)) {
        ids.push(part.data.artifactId)
      }
    }
  }

  return ids
}
