import {
  GOOGLE_DOCS_ICON,
  GOOGLE_DRIVE_ICON,
  GOOGLE_SHEETS_ICON,
} from '#shared/utils/google-brand-icons'
import {
  buildDriveFileLink,
  isDriveFileId,
} from '#shared/utils/google-drive'
import { GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME } from '#shared/utils/google-drive-tools'

export const GOOGLE_CREATED_FILE_PART_TYPE
  = `tool-${GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME}`

export const GOOGLE_CREATED_FILE_KINDS = [
  'document',
  'spreadsheet',
  'text',
] as const

export type GoogleCreatedFileKind = typeof GOOGLE_CREATED_FILE_KINDS[number]

export const GOOGLE_FILE_KIND_LABELS: Readonly<
  Record<GoogleCreatedFileKind, string>
> = {
  document: 'Google Docs',
  spreadsheet: 'Google Sheets',
  text: 'Google Drive',
}

export const GOOGLE_FILE_KIND_TYPE_LABELS: Readonly<
  Record<GoogleCreatedFileKind, string>
> = {
  document: 'Google Doc',
  spreadsheet: 'Google Sheet',
  text: 'Text file',
}

export const GOOGLE_FILE_KIND_ICONS: Readonly<
  Record<GoogleCreatedFileKind, string>
> = {
  document: GOOGLE_DOCS_ICON,
  spreadsheet: GOOGLE_SHEETS_ICON,
  text: GOOGLE_DRIVE_ICON,
}

export const GOOGLE_FILE_ID_PREFIX = 'google-file:'

export function getGoogleFileItemId(toolCallId: string): string {
  return `${GOOGLE_FILE_ID_PREFIX}${toolCallId}`
}

export function readGoogleFileToolCallId(itemId: string): string | null {
  return itemId.startsWith(GOOGLE_FILE_ID_PREFIX)
    ? itemId.slice(GOOGLE_FILE_ID_PREFIX.length) || null
    : null
}

export interface GoogleCreatedFile {
  toolCallId: string
  kind: GoogleCreatedFileKind
  title: string
  content: string
  id: string
  openLink: string
}

const READY_STATE = 'output-available'
const TITLE_MAX_LENGTH = 160
const UNTITLED_FILE_TITLE = 'Untitled'

export function isGoogleCreatedFileKind(
  value: unknown,
): value is GoogleCreatedFileKind {
  return GOOGLE_CREATED_FILE_KINDS.some(kind => kind === value)
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function cleanTitle(value: string): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()

  return singleLine.length > TITLE_MAX_LENGTH
    ? `${singleLine.slice(0, TITLE_MAX_LENGTH - 1)}…`
    : singleLine
}

/**
 * The link that opens a created file in its own Google editor, derived from
 * the validated Drive id and the validated kind. A text file has no editor
 * and opens in Google Drive. A stored link string is never used as a source.
 */
export function buildGoogleFileOpenLink(
  kind: unknown,
  id: unknown,
): string | null {
  if (!isGoogleCreatedFileKind(kind) || !isDriveFileId(id)) {
    return null
  }

  const encodedId = encodeURIComponent(id)

  if (kind === 'document') {
    return `https://docs.google.com/document/d/${encodedId}/edit`
  }

  if (kind === 'spreadsheet') {
    return `https://docs.google.com/spreadsheets/d/${encodedId}/edit`
  }

  return buildDriveFileLink(id)
}

/**
 * Reads a file that `google__drive_create_file` created from its persisted
 * tool part: the approved input (name, kind, content) and the reference of
 * the output (the Drive id). Only a finished call with a valid reference
 * yields a file; an awaiting, failed or unconfirmed call yields null, and so
 * does any other part. Nothing is read from Google Drive.
 */
export function readGoogleCreatedFile(
  part: unknown,
): GoogleCreatedFile | null {
  const record = readRecord(part)

  if (
    !record
    || record.type !== GOOGLE_CREATED_FILE_PART_TYPE
    || record.state !== READY_STATE
  ) {
    return null
  }

  const { toolCallId } = record
  const input = readRecord(record.input)
  const output = readRecord(record.output)
  const references = output?.references
  const reference = Array.isArray(references) ? readRecord(references[0]) : null

  if (
    typeof toolCallId !== 'string'
    || !toolCallId
    || !input
    || !reference
    || !isGoogleCreatedFileKind(input.kind)
    || typeof input.content !== 'string'
    || typeof reference.title !== 'string'
  ) {
    return null
  }

  const openLink = buildGoogleFileOpenLink(input.kind, reference.id)

  if (!openLink || !isDriveFileId(reference.id)) {
    return null
  }

  return {
    toolCallId,
    kind: input.kind,
    title: cleanTitle(reference.title) || UNTITLED_FILE_TITLE,
    content: input.content,
    id: reference.id,
    openLink,
  }
}
