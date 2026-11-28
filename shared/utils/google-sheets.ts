import { normalizeMediaType } from '#shared/utils/files'
import { WORKBOOK_MAP_TEXT_VERSION } from '#shared/utils/office-files'

export const GOOGLE_SHEETS_HOST = 'sheets.googleapis.com'
export const GOOGLE_SHEETS_REQUESTS_MAX = 22
export const GOOGLE_SHEETS_WALL_TIME_MS = 20_000
export const GOOGLE_SHEETS_LINK_WALL_TIME_MS = 10_000
export const GOOGLE_SHEETS_REQUEST_TIMEOUT_MS = 15_000
export const GOOGLE_SHEETS_SHEETS_MAX = 20
export const GOOGLE_SHEETS_ROWS_MAX = 1000
export const GOOGLE_SHEETS_COLUMNS_MAX = 200
export const GOOGLE_SHEETS_RESPONSE_MAX_BYTES = 8 * 1024 * 1024
export const GOOGLE_SHEETS_CONCURRENT_RESPONSE_MAX_BYTES = 6 * 1024 * 1024
export const GOOGLE_SHEETS_TOTAL_BYTES_MAX = 24 * 1024 * 1024
export const GOOGLE_SHEETS_CONCURRENCY = 2
export const GOOGLE_SHEETS_USER_REQUESTS_PER_MINUTE = 30
export const GOOGLE_SHEETS_APP_REQUESTS_PER_MINUTE = 200

export const GOOGLE_WORKBOOK_MAP_MEDIA_TYPE = 'text/markdown'
export const GOOGLE_WORKBOOK_MAP_NAME_SUFFIX = ' (workbook map)'
export const GOOGLE_WORKBOOK_MAP_EXTENSION = 'md'
export const GOOGLE_WORKBOOK_MAP_CHOICE = {
  extension: GOOGLE_WORKBOOK_MAP_EXTENSION,
  nameSuffix: GOOGLE_WORKBOOK_MAP_NAME_SUFFIX,
} as const
export const GOOGLE_FIRST_TAB_NOTE
  = 'Only the first tab of this spreadsheet was imported.'
export const GOOGLE_FIRST_TAB_UNKNOWN_COUNT_NOTE
  = 'Only the first tab of this spreadsheet could be read.'

/**
 * What the user is told when a spreadsheet map has fewer tabs than the
 * spreadsheet: the first 20 when only the limit cut it, otherwise how many
 * of how many. Null when every tab was imported.
 */
export function describeTabsImported(
  imported: number,
  total: number,
): string | null {
  if (imported >= total) {
    return null
  }

  if (imported === GOOGLE_SHEETS_SHEETS_MAX) {
    return `Only the first ${imported} tabs of this spreadsheet were `
      + 'imported.'
  }

  return `Only ${imported} of ${total} tabs of this spreadsheet were `
    + 'imported.'
}

export type GoogleSheetsFallbackCode
  = | 'sheets_api_off'
    | 'sheets_no_access'
    | 'sheets_quota'
    | 'sheets_too_large'
    | 'sheets_unavailable'

export interface DriveSheetsFallback {
  code: GoogleSheetsFallbackCode
  status: number
  reason: string | null
  isTabCountUnknown?: true
}

export const GOOGLE_SHEETS_FALLBACK_SENTENCES: Readonly<
  Record<GoogleSheetsFallbackCode, string>
> = {
  sheets_api_off: 'The Google Sheets API is not turned on or not set up for '
    + 'Besidka\'s Google project.',
  sheets_no_access: 'Google did not let Besidka read this spreadsheet through '
    + 'the Google Sheets API.',
  sheets_quota: 'Google asked Besidka to slow down on the Google Sheets API. '
    + 'Try again in a minute.',
  sheets_too_large: 'This spreadsheet is too large or too slow to read in '
    + 'full through the Google Sheets API.',
  sheets_unavailable: 'The Google Sheets API could not be reached or did not '
    + 'answer as expected.',
}

const SHEETS_REASON_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

export function readSheetsReason(value: unknown): string | null {
  return typeof value === 'string' && SHEETS_REASON_PATTERN.test(value)
    ? value
    : null
}

export function describeSheetsFallback(
  fallback: Pick<DriveSheetsFallback, 'code'>,
): string {
  return GOOGLE_SHEETS_FALLBACK_SENTENCES[fallback.code]
}

/**
 * The short technical code shown next to a fallback, in the same spirit as
 * the Drive failure code: the machine code, then the HTTP status and
 * Google's reason when there are any, for example
 * `sheets_no_access (HTTP 403, PERMISSION_DENIED)`.
 */
export function formatSheetsFallbackDetail(
  fallback: DriveSheetsFallback,
): string {
  const parts = [
    fallback.status > 0 ? `HTTP ${fallback.status}` : null,
    fallback.reason,
  ].filter((part): part is string => part !== null)

  return parts.length > 0
    ? `${fallback.code} (${parts.join(', ')})`
    : fallback.code
}

/**
 * The toast text of an import: the server's note, and when the note says a
 * Sheet fell back to its first tab, the fixed reason sentence and the short
 * technical code after it.
 */
export function describeImportNotice(result: {
  note?: string
  sheets?: DriveSheetsFallback
}): string | undefined {
  if (!result.note || !result.sheets) {
    return result.note
  }

  return `${result.note} ${describeSheetsFallback(result.sheets)} `
    + `(${formatSheetsFallbackDetail(result.sheets)})`
}

/**
 * The imported file for the composer, with the fallback detail attached only
 * when the user was told about it (the note), so a one-tab spreadsheet that
 * fell back shows no first-tab chip.
 */
export function withSheetsFallback<File extends object>(result: {
  file: File
  note?: string
  sheets?: DriveSheetsFallback
}): File & { sheetsFallback?: DriveSheetsFallback } {
  return result.note && result.sheets
    ? { ...result.file, sheetsFallback: result.sheets }
    : result.file
}

/**
 * Whether a stored file is the workbook map of a Google Sheet. Decided from
 * the stored columns only, never from the text: the copy is Markdown from
 * Google (`external_source`), its text status is ready and its text version
 * is the workbook map's. A Google Doc copy has no text version and the
 * first-sheet copy of a Sheet is CSV, so neither matches.
 */
export function isGoogleWorkbookMapFile(file: {
  type?: string | null
  textStatus?: string | null
  textVersion?: number | null
  externalSource?: string | null
}): boolean {
  return file.externalSource === 'google'
    && file.textStatus === 'ready'
    && (file.textVersion ?? 0) >= WORKBOOK_MAP_TEXT_VERSION
    && normalizeMediaType(file.type ?? '') === GOOGLE_WORKBOOK_MAP_MEDIA_TYPE
}
