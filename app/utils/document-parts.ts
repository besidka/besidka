import type { DocumentFormat, DocumentStatus } from '#shared/utils/documents'
import {
  DOCUMENT_DATA_PART_TYPE,
  DOCUMENT_TOOL_PART_TYPE,
  isDataDocumentPart,
  isDocumentFormat,
  isDocumentStatus,
  isInvalidDocumentInputErrorText,
} from '#shared/utils/documents'
import { readArtifactFailureText } from '~/utils/artifact-parts'

export type DocumentPartState
  = | 'streaming'
    | 'creating'
    | 'ready-to-render'
    | 'failed'

export interface DocumentPartView {
  state: DocumentPartState
  toolCallId: string | null
  documentId: string | null
  format: DocumentFormat | null
  title: string
  specVersion: number | null
  persistedStatus: DocumentStatus | null
  blockCount: number
  errorTitle: string
  errorText: string
}

const STREAMING_INPUT_STATE = 'input-streaming'
const CREATING_INPUT_STATE = 'input-available'
const READY_OUTPUT_STATE = 'output-available'
const FAILED_STATES = new Set<string>(['output-error', 'output-denied'])
const COUNTED_ITEM_KEYS = ['blocks', 'slides', 'sheets'] as const

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readSpecFields(
  input: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return readRecord(input?.spec) ?? input
}

function countSpecItems(spec: Record<string, unknown> | null): number {
  if (!spec) {
    return 0
  }

  for (const key of COUNTED_ITEM_KEYS) {
    const items = spec[key]

    if (Array.isArray(items)) {
      return items.length
    }
  }

  return 0
}

export function isDocumentPart(part: unknown): boolean {
  const record = readRecord(part)

  if (!record) {
    return false
  }

  return record.type === DOCUMENT_DATA_PART_TYPE
    || record.type === DOCUMENT_TOOL_PART_TYPE
}

function getToolPartView(
  record: Record<string, unknown>,
): DocumentPartView | null {
  const state = readString(record.state)
  const spec = readSpecFields(readRecord(record.input))
  const output = readRecord(record.output)
  const base: DocumentPartView = {
    state: 'streaming',
    toolCallId: readString(record.toolCallId) || null,
    documentId: null,
    format: isDocumentFormat(spec?.format) ? spec.format : null,
    title: readString(spec?.title),
    specVersion: null,
    persistedStatus: null,
    blockCount: countSpecItems(spec),
    errorTitle: '',
    errorText: '',
  }

  if (state === STREAMING_INPUT_STATE) {
    return base
  }

  if (state === CREATING_INPUT_STATE) {
    return { ...base, state: 'creating' }
  }

  if (FAILED_STATES.has(state)) {
    if (isInvalidDocumentInputErrorText(record.errorText)) {
      return null
    }

    const failure = readArtifactFailureText(record.errorText)

    return {
      ...base,
      state: 'failed',
      errorTitle: failure.title,
      errorText: failure.reason,
    }
  }

  if (state !== READY_OUTPUT_STATE) {
    return null
  }

  const documentId = readString(output?.documentId)

  if (!documentId || !isDocumentFormat(output?.format)) {
    return null
  }

  return {
    ...base,
    state: 'ready-to-render',
    documentId,
    format: output.format,
    title: readString(output.title) || base.title,
    specVersion: Number.isSafeInteger(output.specVersion)
      ? output.specVersion as number
      : null,
    persistedStatus: 'spec_ready',
  }
}

/**
 * One view model for every document part a message can hold: the live
 * `tool-create_document` part (partial input while streaming, then the
 * output) and the persisted `data-document` reference, including the
 * shared-view variant whose `documentId` is `null`. Parts are untrusted, so
 * each field is read defensively; anything unrecognised yields `null`.
 */
export function getDocumentPartView(part: unknown): DocumentPartView | null {
  const record = readRecord(part)

  if (!record) {
    return null
  }

  if (isDataDocumentPart(record)) {
    const { data } = record

    return {
      state: data.status === 'failed' ? 'failed' : 'ready-to-render',
      toolCallId: null,
      documentId: data.documentId,
      format: data.format,
      title: data.title,
      specVersion: data.specVersion,
      persistedStatus: isDocumentStatus(data.status) ? data.status : null,
      blockCount: 0,
      errorTitle: '',
      errorText: '',
    }
  }

  if (record.type !== DOCUMENT_TOOL_PART_TYPE) {
    return null
  }

  return getToolPartView(record)
}

export function findLastDocumentPartIndex(parts: readonly unknown[]): number {
  for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
    if (isDocumentPart(parts[partIndex])) {
      return partIndex
    }
  }

  return -1
}

export function isLastDocumentPart(
  parts: readonly unknown[],
  partIndex: number,
): boolean {
  return isDocumentPart(parts[partIndex])
    && findLastDocumentPartIndex(parts) === partIndex
}

export function hasStreamingDocumentPart(parts: readonly unknown[]): boolean {
  return parts.some((part) => {
    const view = getDocumentPartView(part)

    return view?.state === 'streaming' || view?.state === 'creating'
  })
}

export function isInvalidDocumentInputPart(part: unknown): boolean {
  const record = readRecord(part)

  return record?.type === DOCUMENT_TOOL_PART_TYPE
    && FAILED_STATES.has(readString(record.state))
    && isInvalidDocumentInputErrorText(record.errorText)
}

/**
 * A call the model got wrong (its input did not match the schema) is not a
 * document: it only shows as a step. Once the model corrected itself with a
 * later call that created a document, the failed attempt is hidden entirely.
 */
export function isSupersededInvalidDocumentPart(
  parts: readonly unknown[],
  partIndex: number,
): boolean {
  if (!isInvalidDocumentInputPart(parts[partIndex])) {
    return false
  }

  return parts.slice(partIndex + 1).some((part) => {
    return getDocumentPartView(part)?.documentId != null
  })
}
