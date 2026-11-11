import type { UIMessage } from 'ai'
import type { DataDocumentPart } from '#shared/utils/documents'
import {
  DOCUMENT_DATA_PART_TYPE,
  DOCUMENT_TOOL_NAME,
  DOCUMENT_TOOL_PART_TYPE,
  isDataDocumentPart,
  isDocumentFormat,
  isDocumentToolPartType,
} from '#shared/utils/documents'

type MessagePart = UIMessage['parts'][number]

const FAILED_DOCUMENT_TEXT = 'The document could not be created.'

export function isDocumentToolName(toolName: string): boolean {
  return toolName === DOCUMENT_TOOL_NAME
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isDynamicDocumentToolPart(record: Record<string, unknown>): boolean {
  return record.type === 'dynamic-tool'
    && typeof record.toolName === 'string'
    && isDocumentToolName(record.toolName)
}

function toDataDocumentPart(output: unknown): DataDocumentPart | null {
  const record = readRecord(output)

  if (!record) {
    return null
  }

  const candidate = {
    type: DOCUMENT_DATA_PART_TYPE,
    data: {
      documentId: record.documentId,
      format: record.format,
      title: record.title,
      specVersion: record.specVersion,
      status: 'spec_ready',
    },
  }

  return isDataDocumentPart(candidate) && candidate.data.documentId !== null
    ? candidate as DataDocumentPart
    : null
}

function toFailedToolPart(part: Record<string, unknown>): MessagePart {
  const input = readRecord(part.input)
  const format = isDocumentFormat(input?.format) ? input.format : undefined

  return {
    type: part.type,
    toolCallId: part.toolCallId,
    state: 'output-error',
    input: format ? { format } : {},
    errorText: FAILED_DOCUMENT_TEXT,
  } as MessagePart
}

/**
 * Rewrites the `create_document` tool parts of an assistant message for
 * persistence so `messages.parts` never holds a document spec: a finished
 * call becomes a small `data-document` reference, a failed call keeps only
 * its format and a fixed error text, and an unfinished call (an interrupted
 * stream) is dropped. Every other part is returned unchanged.
 */
export function rewriteDocumentToolParts(
  parts: UIMessage['parts'],
): UIMessage['parts'] {
  const rewritten: UIMessage['parts'] = []

  for (const part of parts) {
    const record = part as unknown as Record<string, unknown>

    if (isDynamicDocumentToolPart(record)) {
      if (record.state === 'output-error') {
        rewritten.push(toFailedToolPart({
          ...record,
          type: DOCUMENT_TOOL_PART_TYPE,
        }))
      }

      continue
    }

    if (!isDocumentToolPartType(part.type)) {
      rewritten.push(part)

      continue
    }

    if (record.state === 'output-available') {
      const dataPart = toDataDocumentPart(record.output)

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
