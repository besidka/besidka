import type { ArtifactKind } from '#shared/utils/artifacts'
import {
  ARTIFACT_DATA_PART_TYPE,
  isArtifactKind,
  isDataArtifactPart,
} from '#shared/utils/artifacts'

export type ArtifactPartOperation = 'create' | 'update'

export type ArtifactPartState = 'streaming' | 'ready' | 'failed'

export interface ArtifactPartModel {
  state: ArtifactPartState
  operation: ArtifactPartOperation
  toolCallId: string | null
  artifactId: string | null
  version: number | null
  kind: ArtifactKind | null
  title: string
  content: string
  errorText: string
}

export const CREATE_ARTIFACT_PART_TYPE = 'tool-create_artifact'
export const UPDATE_ARTIFACT_PART_TYPE = 'tool-update_artifact'

export const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = {
  html: 'HTML',
  react: 'React',
  svg: 'SVG',
  mermaid: 'Mermaid',
  markdown: 'Markdown',
}

export const ARTIFACT_KIND_ICONS: Record<ArtifactKind, string> = {
  html: 'lucide:app-window',
  react: 'lucide:atom',
  svg: 'lucide:pen-tool',
  mermaid: 'lucide:workflow',
  markdown: 'lucide:file-text',
}

const STREAMING_STATES = new Set<string>(['input-streaming', 'input-available'])
const FAILED_STATES = new Set<string>(['output-error', 'output-denied'])
const DEFAULT_ERROR_TEXT = 'The artifact could not be saved.'

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function isArtifactToolPartType(type: unknown): boolean {
  return type === CREATE_ARTIFACT_PART_TYPE
    || type === UPDATE_ARTIFACT_PART_TYPE
}

export function isArtifactMessagePart(part: unknown): boolean {
  const record = readRecord(part)

  if (!record) {
    return false
  }

  return record.type === ARTIFACT_DATA_PART_TYPE
    || isArtifactToolPartType(record.type)
}

export function orderArtifactPartsLast<T>(parts: readonly T[]): T[] {
  const otherParts = parts.filter(part => !isArtifactMessagePart(part))
  const artifactParts = parts.filter(isArtifactMessagePart)

  return [...otherParts, ...artifactParts]
}

export function getRenderedPartKeys(parts: readonly unknown[]): string[] {
  const otherKeys: string[] = []
  const artifactKeys: string[] = []

  parts.forEach((part, sourceIndex) => {
    if (isArtifactMessagePart(part)) {
      artifactKeys.push(`artifact-${sourceIndex}`)

      return
    }

    otherKeys.push(`part-${otherKeys.length}`)
  })

  return [...otherKeys, ...artifactKeys]
}

function getToolPartModel(
  record: Record<string, unknown>,
): ArtifactPartModel | null {
  const operation: ArtifactPartOperation
    = record.type === CREATE_ARTIFACT_PART_TYPE ? 'create' : 'update'
  const state = readString(record.state)
  const input = readRecord(record.input)
  const toolCallId = readString(record.toolCallId) || null
  const inputArtifactId = readString(input?.artifactId) || null
  const base = {
    operation,
    toolCallId,
    kind: isArtifactKind(input?.kind) ? input.kind : null,
    title: readString(input?.title),
    content: readString(input?.content),
    errorText: '',
  }

  if (STREAMING_STATES.has(state)) {
    return {
      ...base,
      state: 'streaming',
      artifactId: inputArtifactId,
      version: null,
    }
  }

  if (FAILED_STATES.has(state)) {
    return {
      ...base,
      state: 'failed',
      artifactId: inputArtifactId,
      version: null,
      errorText: readString(record.errorText) || DEFAULT_ERROR_TEXT,
    }
  }

  if (state !== 'output-available') {
    return null
  }

  const output = { type: ARTIFACT_DATA_PART_TYPE, data: record.output }

  if (!isDataArtifactPart(output)) {
    return null
  }

  return {
    ...base,
    state: 'ready',
    artifactId: output.data.artifactId,
    version: output.data.version,
    kind: output.data.kind,
    title: output.data.title,
  }
}

/**
 * One view model for every artifact part a message can hold: the streaming
 * and finished tool parts (`tool-create_artifact`, `tool-update_artifact`)
 * and the persisted `data-artifact` reference. Parts are untrusted, so each
 * field is read defensively; anything unrecognised yields `null`.
 */
export function getArtifactPartModel(part: unknown): ArtifactPartModel | null {
  const record = readRecord(part)

  if (!record) {
    return null
  }

  if (isDataArtifactPart(record)) {
    return {
      state: 'ready',
      operation: 'create',
      toolCallId: null,
      artifactId: record.data.artifactId,
      version: record.data.version,
      kind: record.data.kind,
      title: record.data.title,
      content: '',
      errorText: '',
    }
  }

  if (!isArtifactToolPartType(record.type)) {
    return null
  }

  return getToolPartModel(record)
}

export function countArtifactLines(content: string): number {
  if (!content) {
    return 0
  }

  return content.split('\n').length
}

/**
 * Versions of each artifact referenced by `data-artifact` parts, ascending.
 */
export function collectArtifactVersions(
  messages: ReadonlyArray<{ parts?: unknown }>,
): Record<string, number[]> {
  const versions = new Map<string, Set<number>>()

  for (const message of messages) {
    if (!Array.isArray(message.parts)) {
      continue
    }

    for (const part of message.parts) {
      if (!isDataArtifactPart(part)) {
        continue
      }

      const { artifactId, version } = part.data
      const known = versions.get(artifactId) ?? new Set<number>()

      known.add(version)
      versions.set(artifactId, known)
    }
  }

  return Object.fromEntries([...versions].map(([artifactId, known]) => {
    return [artifactId, [...known].sort((left, right) => left - right)]
  }))
}
