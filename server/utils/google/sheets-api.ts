import { GOOGLE_DRIVE_FILE_ID_PATTERN } from '#shared/utils/google-drive'
import {
  GOOGLE_SHEETS_REQUEST_TIMEOUT_MS,
  GOOGLE_SHEETS_RESPONSE_MAX_BYTES,
  readSheetsReason,
} from '#shared/utils/google-sheets'
import type {
  DriveSheetsFallback,
  GoogleSheetsFallbackCode,
} from '#shared/utils/google-sheets'
import {
  GOOGLE_RESPONSE_TOO_LARGE_MESSAGE,
  googleFetchJson,
} from '~~/server/utils/google/http'
import type {
  GoogleFetchImplementation,
  GoogleFetchOptions,
} from '~~/server/utils/google/http'
import { quoteSheetName } from '~~/server/utils/google/sheets-grid'
import { columnLetters } from '@besidka/doc-renderer/workbook-map'

const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets'
const RESOURCE_KEYS_HEADER = 'X-Goog-Drive-Resource-Keys'
const TIMEOUT_STATUS = 504

const CONDITION_FIELDS = 'condition(type,values(userEnteredValue,relativeDate))'

export const SHEETS_METADATA_FIELDS = 'spreadsheetId,'
  + 'namedRanges(name,range),'
  + 'sheets(properties(sheetId,title,index,sheetType,hidden,'
  + 'gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)),'
  + 'merges,'
  + `conditionalFormats(ranges,booleanRule(${CONDITION_FIELDS}),`
  + 'gradientRule(minpoint(type))),'
  + 'protectedRanges(protectedRangeId),'
  + 'charts(chartId))'

export const SHEETS_GRID_FIELDS = 'sheets(properties(sheetId),'
  + 'data(startRow,startColumn,rowData(values(userEnteredValue,'
  + 'formattedValue,userEnteredFormat(numberFormat),'
  + `dataValidation(${CONDITION_FIELDS},inputMessage,strict),`
  + 'note,hyperlink,pivotTable(source)))))'

const API_OFF_REASONS: ReadonlySet<string> = new Set([
  'SERVICE_DISABLED',
  'accessNotConfigured',
  'ACCESS_NOT_CONFIGURED',
  'API_DISABLED',
])

const QUOTA_REASONS: ReadonlySet<string> = new Set([
  'RATE_LIMIT_EXCEEDED',
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'RESOURCE_EXHAUSTED',
  'quotaExceeded',
])

export interface SheetsRequestContext {
  accessToken: string
  resourceKey?: string
  fetchImpl?: GoogleFetchImplementation
}

export interface SheetsFailure extends DriveSheetsFallback {
  googleStatus: string | null
}

export type SheetsResponse
  = | { ok: true, body: Record<string, unknown>, bytes: number }
    | { ok: false, failure: SheetsFailure }

function failure(
  code: GoogleSheetsFallbackCode,
  status: number,
  reason: string | null,
  googleStatus: string | null = null,
): SheetsResponse {
  return { ok: false, failure: { code, status, reason, googleStatus } }
}

interface ErrorFields {
  googleStatus: string | null
  reason: string | null
}

/**
 * The machine strings of a Sheets error answer: `error.status` (a canonical
 * code such as `PERMISSION_DENIED`) and a reason, read from the `reason` of
 * an `error.details[]` entry (the `ErrorInfo` of the Google API error model,
 * for example `SERVICE_DISABLED`) or, for the older shape,
 * `error.errors[0].reason`. Each is kept only when it looks like an
 * identifier, so Google's free text never reaches a log or the user.
 */
export function readSheetsErrorFields(
  body: Record<string, unknown> | null,
): ErrorFields {
  const error = body?.error

  if (typeof error !== 'object' || error === null) {
    return { googleStatus: null, reason: null }
  }

  const record = error as {
    status?: unknown
    details?: unknown
    errors?: unknown
  }
  const candidates: unknown[] = []

  if (Array.isArray(record.details)) {
    for (const detail of record.details) {
      candidates.push((detail as { reason?: unknown } | null)?.reason)
    }
  }

  if (Array.isArray(record.errors)) {
    candidates.push((record.errors[0] as { reason?: unknown } | undefined)
      ?.reason)
  }

  const reason = candidates
    .map(readSheetsReason)
    .find((value): value is string => value !== null) ?? null

  return { googleStatus: readSheetsReason(record.status), reason }
}

/**
 * Sorts a Sheets answer that is not a success into the five codes the user
 * and the logs see. A quota answer (429, or a reason or status that names
 * rate or quota) is `sheets_quota`; a 403 whose reason says the API is
 * disabled or not configured is `sheets_api_off`; any other 401, 403 or 404
 * (the Drive metadata of this file was readable, so the file exists) is
 * `sheets_no_access`; everything else, 400 and 5xx included, is
 * `sheets_unavailable`.
 */
export function classifySheetsFailure(
  status: number,
  body: Record<string, unknown> | null,
): SheetsFailure {
  const { googleStatus, reason } = readSheetsErrorFields(body)
  const isQuota = status === 429
    || (reason !== null && QUOTA_REASONS.has(reason))
    || googleStatus === 'RESOURCE_EXHAUSTED'
  const isApiOff = reason !== null && API_OFF_REASONS.has(reason)
  let code: GoogleSheetsFallbackCode = 'sheets_unavailable'

  if (isQuota) {
    code = 'sheets_quota'
  } else if (isApiOff) {
    code = 'sheets_api_off'
  } else if (status === 401 || status === 403 || status === 404) {
    code = 'sheets_no_access'
  }

  return { code, status, reason, googleStatus }
}

function headersFor(
  spreadsheetId: string,
  context: SheetsRequestContext,
): Record<string, string> {
  return {
    authorization: `Bearer ${context.accessToken}`,
    ...(context.resourceKey
      ? { [RESOURCE_KEYS_HEADER]: `${spreadsheetId}/${context.resourceKey}` }
      : {}),
  }
}

function assertSafeId(spreadsheetId: string): void {
  if (!GOOGLE_DRIVE_FILE_ID_PATTERN.test(spreadsheetId)) {
    throw new TypeError('Invalid Google Sheets spreadsheet id')
  }
}

async function request(
  url: string,
  spreadsheetId: string,
  context: SheetsRequestContext,
  timeoutMs: number,
  maxBytes: number,
): Promise<SheetsResponse> {
  const options: GoogleFetchOptions = {
    timeoutMs: Math.min(timeoutMs, GOOGLE_SHEETS_REQUEST_TIMEOUT_MS),
    maxResponseBytes: maxBytes,
    ...(context.fetchImpl ? { fetchImpl: context.fetchImpl } : {}),
  }

  try {
    const response = await googleFetchJson(url, {
      method: 'GET',
      headers: headersFor(spreadsheetId, context),
    }, options)

    if (!response.ok) {
      return {
        ok: false,
        failure: classifySheetsFailure(response.status, response.body),
      }
    }

    if (!response.body) {
      return failure('sheets_unavailable', response.status, 'malformed')
    }

    return { ok: true, body: response.body, bytes: response.bytes }
  } catch (exception) {
    const { status, message } = exception as {
      status?: number
      message?: string
    }

    if (message === GOOGLE_RESPONSE_TOO_LARGE_MESSAGE) {
      return failure('sheets_too_large', 0, 'response_too_large')
    }

    if (status === TIMEOUT_STATUS) {
      return failure('sheets_too_large', 0, 'timeout')
    }

    return failure('sheets_unavailable', 0, 'unreachable')
  }
}

/**
 * Request 1 of a read: the structure of the workbook only, by a `fields`
 * mask (sheet properties, merges, conditional formats, named ranges and the
 * counts of protected ranges and charts). No cell data is asked for; a field
 * mask also makes `includeGridData` unnecessary, because Google ignores that
 * parameter when a mask is set.
 */
export async function fetchSpreadsheetStructure(
  spreadsheetId: string,
  context: SheetsRequestContext,
  timeoutMs: number,
): Promise<SheetsResponse> {
  assertSafeId(spreadsheetId)

  const url = `${SHEETS_URL}/${spreadsheetId}?prettyPrint=false`
    + `&fields=${encodeURIComponent(SHEETS_METADATA_FIELDS)}`

  return await request(
    url,
    spreadsheetId,
    context,
    timeoutMs,
    GOOGLE_SHEETS_RESPONSE_MAX_BYTES,
  )
}

/**
 * The A1 range of the cells to read: from A1 to `rows` by `columns`, with
 * the sheet title quoted and its inner quotes doubled.
 */
export function gridRangeParameter(
  title: string,
  rows: number,
  columns: number,
): string {
  return `${quoteSheetName(title)}!A1:${columnLetters(columns)}${rows}`
}

/**
 * One request per sheet for its cells: the `ranges` parameter names the
 * rows and columns to read and the mask names the cell fields (the user
 * entered value, the displayed value, the number format pattern, the data
 * validation rule, the note, the link and the pivot table source). Colors
 * and every other format field are never asked for.
 */
export async function fetchSheetCells(
  spreadsheetId: string,
  title: string,
  size: { rows: number, columns: number },
  context: SheetsRequestContext,
  timeoutMs: number,
  maxBytes: number,
): Promise<SheetsResponse> {
  assertSafeId(spreadsheetId)

  const range = gridRangeParameter(title, size.rows, size.columns)
  const url = `${SHEETS_URL}/${spreadsheetId}?prettyPrint=false`
    + `&ranges=${encodeURIComponent(range)}`
    + `&fields=${encodeURIComponent(SHEETS_GRID_FIELDS)}`

  return await request(url, spreadsheetId, context, timeoutMs, maxBytes)
}
