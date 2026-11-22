import {
  MAX_COLUMN,
  MAX_ROW,
  columnLetters,
  parseCell,
} from '@besidka/doc-renderer/workbook-map'

export interface SheetsGridRange {
  sheetId?: number
  startRowIndex?: number
  endRowIndex?: number
  startColumnIndex?: number
  endColumnIndex?: number
}

export interface SheetsGridBounds {
  rowCount: number
  columnCount: number
}

export interface GridRangeOptions {
  absolute?: boolean
  bounds?: SheetsGridBounds | null
}

const PLAIN_SHEET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const R1C1_LIKE = /^R\d*C\d*$/i
const BOOLEAN_NAME = /^(?:TRUE|FALSE)$/i

function isIndex(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
}

/**
 * The sheet prefix of an A1 reference: the title as it is when that cannot
 * be taken for a cell, a row and column reference or a boolean, otherwise in
 * single quotes with inner quotes doubled.
 */
export function quoteSheetName(title: string): string {
  const isPlain = PLAIN_SHEET_NAME.test(title)
    && parseCell(title) === null
    && !R1C1_LIKE.test(title)
    && !BOOLEAN_NAME.test(title)

  return isPlain ? title : `'${title.replace(/'/g, '\'\'')}'`
}

function absoluteColumn(column: number, isAbsolute: boolean): string {
  return `${isAbsolute ? '$' : ''}${columnLetters(column)}`
}

function absoluteRow(row: number, isAbsolute: boolean): string {
  return `${isAbsolute ? '$' : ''}${row}`
}

function corner(
  row: number,
  column: number,
  isAbsolute: boolean,
): string {
  return `${absoluteColumn(column, isAbsolute)}${absoluteRow(row, isAbsolute)}`
}

/**
 * A Sheets `GridRange` as A1 text (the sheet is not part of it). Indexes
 * are zero-based and the end is exclusive; a missing start is the first row
 * or column and a missing end is open. An end that is open in both
 * directions, or only in one, is closed with the sheet's grid size when it
 * is known; a range that spans every row of its columns is written as
 * whole columns (`B:D`) and one that spans every column of its rows as
 * whole rows (`3:9`). A range that is empty, reversed or beyond the sheet
 * limits is null, so it is dropped rather than printed wrong.
 */
export function gridRangeToA1(
  range: SheetsGridRange,
  options: GridRangeOptions = {},
): string | null {
  const { absolute = false, bounds = null } = options
  const startRow = range.startRowIndex ?? 0
  const startColumn = range.startColumnIndex ?? 0
  const hasEndRow = range.endRowIndex !== undefined
  const hasEndColumn = range.endColumnIndex !== undefined

  if (
    !isIndex(startRow)
    || !isIndex(startColumn)
    || (hasEndRow && !isIndex(range.endRowIndex))
    || (hasEndColumn && !isIndex(range.endColumnIndex))
  ) {
    return null
  }

  const top = startRow + 1
  const left = startColumn + 1
  const isWholeHeight = !hasEndRow && startRow === 0
  const isWholeWidth = !hasEndColumn && startColumn === 0

  const bottom = hasEndRow
    ? range.endRowIndex as number
    : (bounds?.rowCount ?? MAX_ROW)
  const right = hasEndColumn
    ? range.endColumnIndex as number
    : (bounds?.columnCount ?? MAX_COLUMN)

  if (bottom < top || right < left || bottom > MAX_ROW || right > MAX_COLUMN) {
    return null
  }

  if (isWholeHeight && !isWholeWidth) {
    const first = absoluteColumn(left, absolute)

    return `${first}:${absoluteColumn(right, absolute)}`
  }

  if (isWholeWidth && !isWholeHeight) {
    return `${absoluteRow(top, absolute)}:${absoluteRow(bottom, absolute)}`
  }

  const start = corner(top, left, absolute)

  if (top === bottom && left === right) {
    return start
  }

  return `${start}:${corner(bottom, right, absolute)}`
}

/**
 * A named range as `Sheet!$A$1:$B$2`: the range with `$` on every part, on
 * the sheet whose id it names. A range on a sheet that is not in the
 * workbook, or that cannot be written, is null.
 */
export function namedRangeToA1(
  range: SheetsGridRange,
  titleOf: (sheetId: number) => string | undefined,
  boundsOf: (sheetId: number) => SheetsGridBounds | undefined,
): string | null {
  const sheetId = range.sheetId ?? 0
  const title = titleOf(sheetId)

  if (title === undefined) {
    return null
  }

  const text = gridRangeToA1(range, {
    absolute: true,
    bounds: boundsOf(sheetId) ?? null,
  })

  return text === null ? null : `${quoteSheetName(title)}!${text}`
}
