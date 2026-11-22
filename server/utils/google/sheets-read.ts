import { renderWorkbookMap } from '@besidka/doc-renderer/workbook-map'
import type {
  SheetCut,
  WorkbookMapSummary,
} from '@besidka/doc-renderer/workbook-map'
import {
  GOOGLE_SHEETS_COLUMNS_MAX,
  GOOGLE_SHEETS_CONCURRENCY,
  GOOGLE_SHEETS_CONCURRENT_RESPONSE_MAX_BYTES,
  GOOGLE_SHEETS_REQUESTS_MAX,
  GOOGLE_SHEETS_RESPONSE_MAX_BYTES,
  GOOGLE_SHEETS_ROWS_MAX,
  GOOGLE_SHEETS_SHEETS_MAX,
  GOOGLE_SHEETS_TOTAL_BYTES_MAX,
  GOOGLE_SHEETS_WALL_TIME_MS,
} from '#shared/utils/google-sheets'
import type { DriveSheetsFallback } from '#shared/utils/google-sheets'
import { OFFICE_TEXT_INLINE_MAX_BYTES } from '#shared/utils/office-files'
import {
  fetchSheetCells,
  fetchSpreadsheetStructure,
} from '~~/server/utils/google/sheets-api'
import type {
  SheetsFailure,
  SheetsRequestContext,
} from '~~/server/utils/google/sheets-api'
import {
  buildWorkbookModel,
  parseSheetGrid,
  parseSheetsMetadata,
} from '~~/server/utils/google/sheets-model'
import type {
  SheetGridRead,
  SheetsSheetInfo,
} from '~~/server/utils/google/sheets-model'
import type {
  SheetsRequestReserver,
  SheetsReservation,
} from '~~/server/utils/google/sheets-rate-limit'
import type { GoogleFetchImplementation } from '~~/server/utils/google/http'

const MIN_REQUEST_TIME_MS = 1000
const ROWS_RETRY_DIVISOR = 4
const FAILURES_LOGGED_MAX = 5
export const SHEETS_USER_LIMIT_REASON = 'besidka_user_limit'
export const SHEETS_APP_LIMIT_REASON = 'besidka_app_limit'
export const SHEETS_BUDGET_REASON = 'request_budget'
export const SHEETS_TIME_REASON = 'time_budget'
export const SHEETS_TOTAL_BYTES_REASON = 'total_bytes'
const TOO_LARGE_REASON = 'response_too_large'
type SheetsMetadata = NonNullable<ReturnType<typeof parseSheetsMetadata>>

type StructureOutcome
  = | { metadata: SheetsMetadata, failure?: undefined }
    | { metadata?: undefined, failure: SheetsFailure }

export interface SheetsReadInput {
  spreadsheetId: string
  accessToken: string
  resourceKey?: string
  reserve: SheetsRequestReserver
  fetchImpl?: GoogleFetchImplementation
  now?: () => number
  wallTimeMs?: number
}

export interface SheetsReadDiagnostics {
  requests: number
  bytes: number
  failures: string[]
  tabsNotRead: number
  kvUnavailable: boolean
}

export type SheetsReadResult
  = | {
    ok: true
    text: string
    summary: WorkbookMapSummary
    tabsTotal: number
    tabsImported: number
    diagnostics: SheetsReadDiagnostics
  }
  | {
    ok: false
    fallback: DriveSheetsFallback
    tabsTotal: number | null
    diagnostics: SheetsReadDiagnostics
  }

type CellsAttempt
  = | { kind: 'read', read: SheetGridRead }
    | { kind: 'too_large' }
    | { kind: 'failed', failure: SheetsFailure }

function toFallback(failure: SheetsFailure): DriveSheetsFallback {
  return {
    code: failure.code,
    status: failure.status,
    reason: failure.reason,
  }
}

function limitFailure(reservation: SheetsReservation): SheetsFailure {
  return {
    code: 'sheets_quota',
    status: 0,
    reason: reservation.limitedBy === 'app'
      ? SHEETS_APP_LIMIT_REASON
      : SHEETS_USER_LIMIT_REASON,
    googleStatus: null,
  }
}

function budgetFailure(reason: string): SheetsFailure {
  return { code: 'sheets_too_large', status: 0, reason, googleStatus: null }
}

async function runPool<Item>(
  items: readonly Item[],
  limit: number,
  worker: (item: Item) => Promise<void>,
): Promise<void> {
  let next = 0
  async function lane() {
    while (next < items.length) {
      const item = items[next] as Item

      next += 1
      await worker(item)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, lane),
  )
}

/**
 * Reads a spreadsheet through the Sheets API into the workbook map, with
 * the token the Drive copy uses. The plan: one request for the structure of
 * the workbook, then one request per tab for its cells (at most
 * `GOOGLE_SHEETS_SHEETS_MAX` tabs, 1,000 rows and 200 columns each), two
 * tabs at a time (`GOOGLE_SHEETS_CONCURRENCY` lanes), under a total of
 * `GOOGLE_SHEETS_REQUESTS_MAX` requests, `GOOGLE_SHEETS_TOTAL_BYTES_MAX` of
 * decoded answers and `wallTimeMs`. The request count is reserved against
 * the rate buckets in two steps, never per request, and a refused
 * reservation, a Google 429, a disabled API and a refused file each end the
 * run without a retry.
 *
 * Memory: the first pass reads each tab under 6 MiB, so the two answers in
 * flight never hold more than 12 MiB of text; a tab over that is asked again
 * alone, after the first pass, under 8 MiB, and then once more with a
 * quarter of its rows. Each answer is turned into the tab's cells and
 * dropped before its lane asks again, and the structure answer is dropped
 * as soon as it is parsed, so only the parsed structure and the small cell
 * lists stay.
 *
 * What comes back: a failed or empty structure request is a fallback; a tab
 * that is still too large or that a budget did not reach keeps its
 * structure and is named as not read (the caller says "Only N of M tabs");
 * and only when no tab's cells were read at all is the result a fallback,
 * with the first failure's code, because a map without a single value is
 * worse than the first-tab CSV. A map with fewer imported tabs than the
 * spreadsheet has (`tabsImported` below `tabsTotal`) is partial, and the
 * caller never reuses a partial map.
 */
export async function readSpreadsheetMap(
  input: SheetsReadInput,
): Promise<SheetsReadResult> {
  const now = input.now ?? Date.now
  const startedAt = now()
  const wallTimeMs = input.wallTimeMs ?? GOOGLE_SHEETS_WALL_TIME_MS
  const remaining = () => wallTimeMs - (now() - startedAt)
  const diagnostics: SheetsReadDiagnostics = {
    requests: 0,
    bytes: 0,
    failures: [],
    tabsNotRead: 0,
    kvUnavailable: false,
  }
  const context: SheetsRequestContext = {
    accessToken: input.accessToken,
    ...(input.resourceKey ? { resourceKey: input.resourceKey } : {}),
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  }

  function noteFailure(stage: string, failure: SheetsFailure) {
    if (diagnostics.failures.length < FAILURES_LOGGED_MAX) {
      diagnostics.failures.push(
        `${stage}:${failure.status}:${failure.googleStatus ?? 'none'}:`
        + `${failure.reason ?? 'none'}`,
      )
    }
  }

  async function reserve(count: number): Promise<SheetsReservation> {
    const reservation = await input.reserve(count)

    diagnostics.kvUnavailable = diagnostics.kvUnavailable
      || reservation.kvUnavailable

    return reservation
  }

  const first = await reserve(1)

  if (first.granted < 1) {
    const failure = limitFailure(first)

    noteFailure('limit', failure)

    return {
      ok: false,
      fallback: toFallback(failure),
      tabsTotal: null,
      diagnostics,
    }
  }

  diagnostics.requests += 1

  async function loadStructure(): Promise<StructureOutcome> {
    const structure = await fetchSpreadsheetStructure(
      input.spreadsheetId,
      context,
      remaining(),
    )

    if (!structure.ok) {
      noteFailure('structure', structure.failure)

      return { failure: structure.failure }
    }

    diagnostics.bytes += structure.bytes

    const parsed = parseSheetsMetadata(structure.body)

    if (!parsed) {
      const failure: SheetsFailure = {
        code: 'sheets_unavailable',
        status: 200,
        reason: 'no_sheets',
        googleStatus: null,
      }

      noteFailure('structure', failure)

      return { failure }
    }

    return { metadata: parsed }
  }

  const { metadata, failure: structureFailure } = await loadStructure()

  if (!metadata) {
    return {
      ok: false,
      fallback: toFallback(structureFailure),
      tabsTotal: null,
      diagnostics,
    }
  }

  const tabsTotal = metadata.sheets.length
  const modelSheets = Math.min(tabsTotal, GOOGLE_SHEETS_SHEETS_MAX)
  const gridSheets = metadata.sheets
    .slice(0, GOOGLE_SHEETS_SHEETS_MAX)
    .filter(sheet => sheet.kind === 'grid')
  const reads = new Map<number, SheetGridRead>()
  let firstFailure: SheetsFailure | null = null
  let isStopped = false
  let allowance = 0

  if (gridSheets.length > 0) {
    const reservation = await reserve(gridSheets.length)

    allowance = reservation.granted

    if (allowance < gridSheets.length) {
      firstFailure = limitFailure(reservation)
    }
  }

  function note(failure: SheetsFailure) {
    firstFailure ??= failure
    noteFailure('tab', failure)
  }

  function budgetBlock(): SheetsFailure | null {
    if (diagnostics.requests >= GOOGLE_SHEETS_REQUESTS_MAX) {
      return budgetFailure(SHEETS_BUDGET_REASON)
    }

    if (diagnostics.bytes >= GOOGLE_SHEETS_TOTAL_BYTES_MAX) {
      return budgetFailure(SHEETS_TOTAL_BYTES_REASON)
    }

    return remaining() < MIN_REQUEST_TIME_MS
      ? budgetFailure(SHEETS_TIME_REASON)
      : null
  }

  function canRequest(): SheetsFailure | null {
    if (isStopped && firstFailure) {
      return firstFailure
    }

    if (allowance > 0) {
      return budgetBlock()
    }

    return firstFailure ?? limitFailure({
      granted: 0,
      limitedBy: 'user',
      kvUnavailable: false,
    })
  }

  async function attempt(
    sheet: SheetsSheetInfo,
    size: { rows: number, columns: number },
    maxBytes: number,
    cuts: SheetCut[],
  ): Promise<CellsAttempt> {
    allowance -= 1
    diagnostics.requests += 1

    const response = await fetchSheetCells(
      input.spreadsheetId,
      sheet.title,
      size,
      context,
      remaining(),
      maxBytes,
    )

    if (!response.ok) {
      const { failure } = response

      return failure.reason === TOO_LARGE_REASON
        ? { kind: 'too_large' }
        : { kind: 'failed', failure }
    }

    if (diagnostics.bytes + response.bytes > GOOGLE_SHEETS_TOTAL_BYTES_MAX) {
      return {
        kind: 'failed',
        failure: budgetFailure(SHEETS_TOTAL_BYTES_REASON),
      }
    }

    diagnostics.bytes += response.bytes

    const grid = parseSheetGrid(response.body, sheet.sheetId, size)

    if (!grid) {
      return {
        kind: 'failed',
        failure: budgetFailure('no_tab_data'),
      }
    }

    return {
      kind: 'read',
      read: { status: 'read', grid, rowsRead: size.rows, cuts },
    }
  }

  function fullSize(sheet: SheetsSheetInfo) {
    return {
      rows: Math.min(
        sheet.rowCount || GOOGLE_SHEETS_ROWS_MAX,
        GOOGLE_SHEETS_ROWS_MAX,
      ),
      columns: Math.min(
        sheet.columnCount || GOOGLE_SHEETS_COLUMNS_MAX,
        GOOGLE_SHEETS_COLUMNS_MAX,
      ),
    }
  }

  function cutsFor(sheet: SheetsSheetInfo, isRowsCut: boolean): SheetCut[] {
    const size = fullSize(sheet)
    const cuts: SheetCut[] = []

    if (isRowsCut || sheet.rowCount > size.rows) {
      cuts.push('rows')
    }

    if (sheet.columnCount > size.columns) {
      cuts.push('columns')
    }

    return cuts
  }

  function markNotRead(sheet: SheetsSheetInfo) {
    reads.set(sheet.sheetId, { status: 'not_read' })
    diagnostics.tabsNotRead += 1
  }

  function settle(sheet: SheetsSheetInfo, outcome: CellsAttempt) {
    if (outcome.kind === 'read') {
      reads.set(sheet.sheetId, outcome.read)

      return
    }

    if (outcome.kind === 'too_large') {
      markNotRead(sheet)
      note(budgetFailure(TOO_LARGE_REASON))

      return
    }

    markNotRead(sheet)
    note(outcome.failure)

    const { code } = outcome.failure

    isStopped = isStopped
      || code === 'sheets_quota'
      || code === 'sheets_no_access'
      || code === 'sheets_api_off'
  }

  const tooLarge: SheetsSheetInfo[] = []

  await runPool(gridSheets, GOOGLE_SHEETS_CONCURRENCY, async (sheet) => {
    const blocked = canRequest()

    if (blocked) {
      note(blocked)
      markNotRead(sheet)

      return
    }

    const outcome = await attempt(
      sheet,
      fullSize(sheet),
      GOOGLE_SHEETS_CONCURRENT_RESPONSE_MAX_BYTES,
      cutsFor(sheet, false),
    )

    if (outcome.kind === 'too_large') {
      tooLarge.push(sheet)

      return
    }

    settle(sheet, outcome)
  })

  for (const sheet of tooLarge) {
    const blocked = isStopped && firstFailure ? firstFailure : budgetBlock()
    const reservation = blocked ? null : await reserve(1)

    if (blocked || !reservation || reservation.granted < 1) {
      note(blocked ?? limitFailure(reservation as SheetsReservation))
      markNotRead(sheet)
      continue
    }

    allowance += 1

    let outcome = await attempt(
      sheet,
      fullSize(sheet),
      GOOGLE_SHEETS_RESPONSE_MAX_BYTES,
      cutsFor(sheet, false),
    )

    const size = fullSize(sheet)

    if (outcome.kind === 'too_large' && size.rows > 1) {
      const retryBlocked = budgetBlock()
      const retry = retryBlocked ? null : await reserve(1)

      if (retry && retry.granted > 0) {
        allowance += 1
        outcome = await attempt(
          sheet,
          {
            rows: Math.max(Math.floor(size.rows / ROWS_RETRY_DIVISOR), 1),
            columns: size.columns,
          },
          GOOGLE_SHEETS_RESPONSE_MAX_BYTES,
          cutsFor(sheet, true),
        )
      }
    }

    settle(sheet, outcome)
  }

  const readCount = [...reads.values()].filter((read) => {
    return read.status === 'read'
  }).length

  if (gridSheets.length > 0 && readCount === 0) {
    const failure = firstFailure ?? budgetFailure('no_cells')

    return {
      ok: false,
      fallback: toFallback(failure),
      tabsTotal,
      diagnostics,
    }
  }

  const { text, summary } = renderWorkbookMap(
    buildWorkbookModel({ metadata, reads }),
    { maxBytes: OFFICE_TEXT_INLINE_MAX_BYTES },
  )

  return {
    ok: true,
    text,
    summary,
    tabsTotal,
    tabsImported: modelSheets - diagnostics.tabsNotRead,
    diagnostics,
  }
}
