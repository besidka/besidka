export const MAX_ROW = 1_048_576
export const MAX_COLUMN = 16_384

const MAX_COLUMN_LETTERS = 3
const MAX_ROW_DIGITS = 7
const LETTER_COUNT = 26
const UPPER_A = 65
const UPPER_Z = 90
const LOWER_A = 97
const LOWER_Z = 122
const DIGIT_ZERO = 48
const DIGIT_NINE = 57
const DOLLAR = 36
const COLON = 58

export interface CellPosition {
  row: number
  column: number
}

export interface CellRange {
  top: number
  left: number
  bottom: number
  right: number
}

export function isLetterCode(code: number): boolean {
  return (code >= UPPER_A && code <= UPPER_Z)
    || (code >= LOWER_A && code <= LOWER_Z)
}

export function isDigitCode(code: number): boolean {
  return code >= DIGIT_ZERO && code <= DIGIT_NINE
}

function letterValue(code: number): number {
  return code >= LOWER_A ? code - LOWER_A + 1 : code - UPPER_A + 1
}

/**
 * Column letters for a 1-based column number: 1 is `A`, 27 is `AA`.
 */
export function columnLetters(column: number): string {
  let remaining = column
  let letters = ''

  while (remaining > 0) {
    const rest = (remaining - 1) % LETTER_COUNT

    letters = String.fromCharCode(UPPER_A + rest) + letters
    remaining = Math.floor((remaining - 1) / LETTER_COUNT)
  }

  return letters
}

/**
 * The 1-based column number of 1 to 3 letters, either case, or null.
 */
export function columnNumber(letters: string): number | null {
  if (letters.length === 0 || letters.length > MAX_COLUMN_LETTERS) {
    return null
  }

  let value = 0

  for (let index = 0; index < letters.length; index += 1) {
    const code = letters.charCodeAt(index)

    if (!isLetterCode(code)) {
      return null
    }

    value = value * LETTER_COUNT + letterValue(code)
  }

  return value <= MAX_COLUMN ? value : null
}

export function cellAddress(row: number, column: number): string {
  return `${columnLetters(column)}${row}`
}

export function rangeAddress(range: CellRange): string {
  const start = cellAddress(range.top, range.left)

  if (range.top === range.bottom && range.left === range.right) {
    return start
  }

  return `${start}:${cellAddress(range.bottom, range.right)}`
}

function readCell(
  text: string,
  start: number,
): { position: CellPosition, end: number } | null {
  let index = start

  if (text.charCodeAt(index) === DOLLAR) {
    index += 1
  }

  const lettersStart = index

  while (index < text.length && isLetterCode(text.charCodeAt(index))) {
    index += 1
  }

  const column = columnNumber(text.slice(lettersStart, index))

  if (column === null) {
    return null
  }

  if (text.charCodeAt(index) === DOLLAR) {
    index += 1
  }

  const digitsStart = index

  while (index < text.length && isDigitCode(text.charCodeAt(index))) {
    index += 1
  }

  const digits = index - digitsStart

  if (digits === 0 || digits > MAX_ROW_DIGITS) {
    return null
  }

  const row = Number(text.slice(digitsStart, index))

  if (row < 1 || row > MAX_ROW) {
    return null
  }

  return { position: { row, column }, end: index }
}

/**
 * Parses `B4`, `$B$4` or `A1:C9` (either order of corners). Anything else,
 * including whole columns and rows, is null.
 */
export function parseRange(text: string): CellRange | null {
  const first = readCell(text, 0)

  if (first === null) {
    return null
  }

  if (first.end === text.length) {
    const { row, column } = first.position

    return { top: row, left: column, bottom: row, right: column }
  }

  if (text.charCodeAt(first.end) !== COLON) {
    return null
  }

  const second = readCell(text, first.end + 1)

  if (second === null || second.end !== text.length) {
    return null
  }

  return {
    top: Math.min(first.position.row, second.position.row),
    left: Math.min(first.position.column, second.position.column),
    bottom: Math.max(first.position.row, second.position.row),
    right: Math.max(first.position.column, second.position.column),
  }
}

export function parseCell(text: string): CellPosition | null {
  const cell = readCell(text, 0)

  return cell !== null && cell.end === text.length ? cell.position : null
}

function readLine(
  text: string,
  isLetters: boolean,
): number | null {
  const value = text.charCodeAt(0) === DOLLAR ? text.slice(1) : text

  if (value.length === 0) {
    return null
  }

  if (isLetters) {
    return columnNumber(value)
  }

  for (let index = 0; index < value.length; index += 1) {
    if (!isDigitCode(value.charCodeAt(index))) {
      return null
    }
  }

  const row = value.length <= MAX_ROW_DIGITS ? Number(value) : 0

  return row >= 1 && row <= MAX_ROW ? row : null
}

/**
 * `parseRange`, plus whole columns (`A:C`) and whole rows (`3:9`), which
 * some writers use in range lists; they become full-height or full-width
 * rectangles.
 */
export function parseArea(text: string): CellRange | null {
  const range = parseRange(text)

  if (range !== null) {
    return range
  }

  const colon = text.indexOf(':')

  if (colon === -1 || text.indexOf(':', colon + 1) !== -1) {
    return null
  }

  const start = text.slice(0, colon)
  const end = text.slice(colon + 1)
  const firstColumn = readLine(start, true)
  const lastColumn = readLine(end, true)

  if (firstColumn !== null && lastColumn !== null) {
    return {
      top: 1,
      bottom: MAX_ROW,
      left: Math.min(firstColumn, lastColumn),
      right: Math.max(firstColumn, lastColumn),
    }
  }

  const firstRow = readLine(start, false)
  const lastRow = readLine(end, false)

  if (firstRow !== null && lastRow !== null) {
    return {
      top: Math.min(firstRow, lastRow),
      bottom: Math.max(firstRow, lastRow),
      left: 1,
      right: MAX_COLUMN,
    }
  }

  return null
}

/**
 * Splits a space-separated range list (`sqref`) into ranges, keeping only the
 * ones that parse (whole columns and rows included) and at most `maxRanges`
 * of them.
 */
export function parseRangeList(text: string, maxRanges: number): CellRange[] {
  const ranges: CellRange[] = []
  let start = 0

  for (let index = 0; index <= text.length; index += 1) {
    const isEnd = index === text.length
    const code = isEnd ? 32 : text.charCodeAt(index)

    if (code !== 32 && code !== 9 && code !== 10 && code !== 13) {
      continue
    }

    if (index > start) {
      const range = parseArea(text.slice(start, index))

      if (range !== null) {
        ranges.push(range)
      }

      if (ranges.length >= maxRanges) {
        return ranges
      }
    }

    start = index + 1
  }

  return ranges
}
