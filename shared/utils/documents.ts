import type { FeatureKey } from '#shared/utils/features/registry'

export const DOCUMENT_TOOL_NAME = 'create_document'
export const DOCUMENT_TOOL_PART_TYPE = `tool-${DOCUMENT_TOOL_NAME}`
export const DOCUMENT_DATA_PART_TYPE = 'data-document'

export const DOCUMENT_FORMATS = ['pdf', 'docx', 'pptx', 'xlsx'] as const
export const DOCUMENT_STATUSES = [
  'spec_ready',
  'rendering',
  'ready',
  'failed',
] as const
export const DOCUMENT_RENDERED_BY = [
  'client',
  'worker',
  'provider-skill',
] as const
export const DOCUMENT_CREATED_VIA = [
  'chat',
  'mcp',
  'research',
  'schedule',
] as const

export const DOCUMENT_MAX_CALLS_PER_TURN = 3
export const DOCUMENT_RENDER_LEASE_SECONDS = 120
export const DOCUMENT_MAX_FILE_BYTES = 20 * 1024 * 1024
export const DOCUMENT_POLL_INTERVAL_MS = 3000
export const DOCUMENT_POLL_TIMEOUT_MS = 120_000
export const DOCUMENT_REQUEST_TIMEOUT_MS = 15_000
export const DOCUMENT_REQUEST_ATTEMPTS = 3
export const DOCUMENT_WORKER_TIMEOUT_MS = 60_000
export const DOCUMENT_WORKER_IDLE_MS = 30_000
export const DOCUMENT_PREVIEW_ROW_LIMIT = 1000
export const DOCUMENT_RENDER_RATE_LIMIT_PER_MINUTE = 10
export const DOCUMENT_FILE_RATE_LIMIT_PER_MINUTE = 20
export const DOCUMENT_CHAT_CONTEXT_LIMIT = 10
export const DOCUMENT_SPEC_RETENTION_DAYS = 7
export const DOCUMENT_FORMAT_HEADER = 'x-document-format'

export type DocumentFormat = typeof DOCUMENT_FORMATS[number]
export type DocumentStatus = typeof DOCUMENT_STATUSES[number]
export type DocumentRenderedBy = typeof DOCUMENT_RENDERED_BY[number]
export type DocumentCreatedVia = typeof DOCUMENT_CREATED_VIA[number]

export const DOCUMENT_MEDIA_TYPES: Record<DocumentFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument'
    + '.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument'
    + '.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument'
    + '.spreadsheetml.sheet',
}

export const DOCUMENT_FORMAT_LABELS: Record<DocumentFormat, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  pptx: 'PPTX',
  xlsx: 'XLSX',
}

export const DOCUMENT_FEATURE_KEYS: Record<DocumentFormat, FeatureKey> = {
  pdf: 'documents.pdf',
  docx: 'documents.docx',
  pptx: 'documents.pptx',
  xlsx: 'documents.xlsx',
}

export const DOCUMENT_ERROR_CODES = {
  fileDeleted: 'file_deleted',
  renderFailed: 'render_failed',
  validationFailed: 'validation_failed',
  provenanceMissing: 'provenance_missing',
  rendererUnavailable: 'renderer_unavailable',
  specInvalid: 'spec_invalid',
  specMissing: 'spec_missing',
  specExpired: 'spec_expired',
  quotaExceeded: 'quota_exceeded',
} as const

export interface DocumentStats {
  pages: number | null
  slides: number | null
  sheets: number | null
  cells: number | null
  images: number
}

export interface DocumentFileRef {
  id: string
  storageKey: string
  name: string
  size: number
  type: string
}

export interface DocumentStatusResponse {
  id: string
  format: DocumentFormat
  title: string | null
  status: DocumentStatus
  file: DocumentFileRef | null
  renderedBy: DocumentRenderedBy | null
  errorCode: string | null
  stats: DocumentStats | null
}

export interface DocumentToolOutput {
  documentId: string
  format: DocumentFormat
  title: string
  specVersion: number
  stats: DocumentStats
}

export interface DataDocumentPartData {
  documentId: string
  format: DocumentFormat
  title: string
  specVersion: number
  status: DocumentStatus
}

export interface SharedDocumentPartData {
  documentId: null
  format: DocumentFormat
  title: string
  specVersion: number
  status: DocumentStatus
  file?: { url: string, name: string, size: number, type: string }
}

export interface DataDocumentPart {
  type: typeof DOCUMENT_DATA_PART_TYPE
  data: DataDocumentPartData
}

export interface SharedDocumentPart {
  type: typeof DOCUMENT_DATA_PART_TYPE
  data: SharedDocumentPartData
}

export function isDocumentFormat(value: unknown): value is DocumentFormat {
  return typeof value === 'string'
    && (DOCUMENT_FORMATS as readonly string[]).includes(value)
}

export function isDocumentStatus(value: unknown): value is DocumentStatus {
  return typeof value === 'string'
    && (DOCUMENT_STATUSES as readonly string[]).includes(value)
}

export function isDocumentToolPartType(type: unknown): boolean {
  return type === DOCUMENT_TOOL_PART_TYPE
}

export const DOCUMENT_INVALID_INPUT_ERROR_TEXT
  = 'The document input did not match the schema.'

const INVALID_TOOL_INPUT_KIND = 'invalid-tool-input'
const MAX_ERROR_PAYLOAD_LENGTH = 4000

/**
 * True for the `errorText` of a `create_document` call whose input failed the
 * schema: the live stream carries the serialized chat error payload with
 * `kind: 'invalid-tool-input'`, the persisted part carries the fixed
 * `DOCUMENT_INVALID_INPUT_ERROR_TEXT`.
 */
export function isInvalidDocumentInputErrorText(errorText: unknown): boolean {
  if (typeof errorText !== 'string') {
    return false
  }

  const text = errorText.trim()

  if (text === DOCUMENT_INVALID_INPUT_ERROR_TEXT) {
    return true
  }

  if (!text.startsWith('{') || text.length > MAX_ERROR_PAYLOAD_LENGTH) {
    return false
  }

  try {
    const payload = JSON.parse(text) as { kind?: unknown } | null

    return payload?.kind === INVALID_TOOL_INPUT_KIND
  } catch {
    return false
  }
}

export function isDocumentPartType(type: unknown): boolean {
  return type === DOCUMENT_DATA_PART_TYPE || type === DOCUMENT_TOOL_PART_TYPE
}

function isDataDocumentPartData(
  data: unknown,
): data is DataDocumentPartData | SharedDocumentPartData {
  if (typeof data !== 'object' || data === null) {
    return false
  }

  const candidate = data as Record<string, unknown>

  return (candidate.documentId === null
    || (typeof candidate.documentId === 'string'
      && candidate.documentId.length > 0))
    && isDocumentFormat(candidate.format)
    && typeof candidate.title === 'string'
    && Number.isSafeInteger(candidate.specVersion)
    && isDocumentStatus(candidate.status)
}

export function isDataDocumentPart(
  part: unknown,
): part is DataDocumentPart | SharedDocumentPart {
  if (typeof part !== 'object' || part === null) {
    return false
  }

  const { type, data } = part as { type?: unknown, data?: unknown }

  return type === DOCUMENT_DATA_PART_TYPE && isDataDocumentPartData(data)
}

const INVISIBLE_FILE_NAME_CHARACTERS = /[\p{Cf}\u{E0000}-\u{E007F}]/gu

export function getDocumentFileName(
  title: string,
  format: DocumentFormat,
): string {
  const cleaned = [...title]
    .filter((character) => {
      const codePoint = character.codePointAt(0) || 0

      return codePoint >= 0x20 && codePoint !== 0x7f
    })
    .join('')
    .replace(INVISIBLE_FILE_NAME_CHARACTERS, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
    .trim()

  return `${cleaned || 'document'}.${format}`
}
