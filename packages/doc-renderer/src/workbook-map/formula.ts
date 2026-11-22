import {
  MAX_COLUMN,
  MAX_ROW,
  columnLetters,
  columnNumber,
  isDigitCode,
  isLetterCode,
} from './address.ts'

export type FormulaTokenKind
  = | 'text'
    | 'string'
    | 'error'
    | 'function'
    | 'sheet'
    | 'bracket'
    | 'cell'
    | 'columns'
    | 'rows'

interface ReferencePart {
  isAbsolute: boolean
  value: number
  text: string
}

export interface FormulaToken {
  kind: FormulaTokenKind
  text: string
  column?: ReferencePart
  row?: ReferencePart
  endColumn?: ReferencePart
  endRow?: ReferencePart
}

export interface TokenizedFormula {
  tokens: FormulaToken[]
  hasStructured: boolean
  hasExternal: boolean
  isMalformed: boolean
}

export const FORMULA_CHARACTERS_MAX = 8192

const DOUBLE_QUOTE = 34
const SINGLE_QUOTE = 39
const OPEN_BRACKET = 91
const CLOSE_BRACKET = 93
const HASH = 35
const DOLLAR = 36
const EXCLAMATION = 33
const QUESTION = 63
const COLON = 58
const OPEN_PARENTHESIS = 40
const UNDERSCORE = 95
const DOT = 46
const BACKSLASH = 92
const SLASH = 47
const LAST_ASCII = 127
const BRACKET_DEPTH_MAX = 8

function isNameCode(code: number): boolean {
  return isLetterCode(code)
    || isDigitCode(code)
    || code === UNDERSCORE
    || code === DOT
    || code === DOLLAR
    || code === BACKSLASH
    || code === QUESTION
    || (code > LAST_ASCII && code !== 0xA0 && code !== 0x3000)
}

function scanName(text: string, start: number): number {
  let index = start

  while (index < text.length && isNameCode(text.charCodeAt(index))) {
    index += 1
  }

  return index
}

function scanQuoted(text: string, start: number, quote: number): number {
  let index = start + 1

  while (index < text.length) {
    if (text.charCodeAt(index) !== quote) {
      index += 1
      continue
    }

    if (text.charCodeAt(index + 1) === quote) {
      index += 2
      continue
    }

    return index + 1
  }

  return -1
}

function scanBracket(text: string, start: number): number {
  let depth = 0
  let index = start

  while (index < text.length) {
    const code = text.charCodeAt(index)

    if (code === SINGLE_QUOTE) {
      index += 2
      continue
    }

    if (code === OPEN_BRACKET) {
      depth += 1

      if (depth > BRACKET_DEPTH_MAX) {
        return -1
      }
    } else if (code === CLOSE_BRACKET) {
      depth -= 1

      if (depth === 0) {
        return index + 1
      }
    }

    index += 1
  }

  return -1
}

function scanError(text: string, start: number): number {
  let index = start + 1

  while (index < text.length) {
    const code = text.charCodeAt(index)

    if (isLetterCode(code) || isDigitCode(code) || code === SLASH
      || code === UNDERSCORE) {
      index += 1
      continue
    }

    break
  }

  const last = text.charCodeAt(index)

  return last === EXCLAMATION || last === QUESTION ? index + 1 : index
}

function readPart(
  text: string,
  start: number,
  isLetters: boolean,
): { part: ReferencePart, end: number } | null {
  let index = start
  const isAbsolute = text.charCodeAt(index) === DOLLAR

  if (isAbsolute) {
    index += 1
  }

  const valueStart = index
  const accepts = isLetters ? isLetterCode : isDigitCode

  while (index < text.length && accepts(text.charCodeAt(index))) {
    index += 1
  }

  const valueText = text.slice(valueStart, index)

  if (valueText.length === 0) {
    return null
  }

  const value = isLetters ? columnNumber(valueText) : Number(valueText)

  if (value === null || valueText.length > 7) {
    return null
  }

  if (!isLetters && (value < 1 || value > MAX_ROW)) {
    return null
  }

  return { part: { isAbsolute, value, text: valueText }, end: index }
}

function readCellReference(name: string): FormulaToken | null {
  const column = readPart(name, 0, true)

  if (column === null) {
    return null
  }

  const row = readPart(name, column.end, false)

  if (row === null || row.end !== name.length) {
    return null
  }

  return { kind: 'cell', text: name, column: column.part, row: row.part }
}

function readWholeLine(
  name: string,
  isLetters: boolean,
): ReferencePart | null {
  const part = readPart(name, 0, isLetters)

  return part !== null && part.end === name.length ? part.part : null
}

function isReferenceLike(name: string): boolean {
  return readCellReference(name) !== null
    || readWholeLine(name, true) !== null
    || readWholeLine(name, false) !== null
}

/**
 * Splits a formula (with or without its leading `=`) into tokens in one
 * linear pass. Cell references, whole columns (`A:C`) and whole rows
 * (`3:9`) are parsed so they can be shifted; string literals, error literals,
 * function names, defined names, sheet prefixes (quoted, unquoted and 3D) and
 * bracketed spans (structured references, external workbooks) are kept as
 * opaque text. A name directly before `(` is a function, so `LOG10(` is not
 * the cell `LOG10`.
 */
export function tokenizeFormula(text: string): TokenizedFormula {
  const tokens: FormulaToken[] = []
  let hasStructured = false
  let hasExternal = false
  let isMalformed = text.length > FORMULA_CHARACTERS_MAX
  let index = 0
  let textStart = 0

  function flushText(end: number): void {
    if (end > textStart) {
      tokens.push({ kind: 'text', text: text.slice(textStart, end) })
    }
  }

  function push(token: FormulaToken, end: number): void {
    tokens.push(token)
    index = end
    textStart = end
  }

  while (index < text.length) {
    const code = text.charCodeAt(index)

    if (code === DOUBLE_QUOTE) {
      const end = scanQuoted(text, index, DOUBLE_QUOTE)

      flushText(index)

      if (end === -1) {
        isMalformed = true
        push({ kind: 'string', text: text.slice(index) }, text.length)
        continue
      }

      push({ kind: 'string', text: text.slice(index, end) }, end)
      continue
    }

    if (code === SINGLE_QUOTE) {
      const end = scanQuoted(text, index, SINGLE_QUOTE)

      flushText(index)

      if (end === -1 || text.charCodeAt(end) !== EXCLAMATION) {
        isMalformed = true
        push({ kind: 'text', text: text.slice(index) }, text.length)
        continue
      }

      const prefix = text.slice(index, end + 1)

      hasExternal = hasExternal || prefix.includes('[')
      push({ kind: 'sheet', text: prefix }, end + 1)
      continue
    }

    if (code === OPEN_BRACKET) {
      const end = scanBracket(text, index)

      flushText(index)

      if (end === -1) {
        isMalformed = true
        push({ kind: 'text', text: text.slice(index) }, text.length)
        continue
      }

      const afterName = scanName(text, end)
      const isExternal = text.charCodeAt(afterName) === EXCLAMATION

      hasExternal = hasExternal || isExternal
      hasStructured = hasStructured || !isExternal
      push({ kind: 'bracket', text: text.slice(index, end) }, end)
      continue
    }

    if (code === HASH && isLetterCode(text.charCodeAt(index + 1))) {
      const end = scanError(text, index)

      flushText(index)
      push({ kind: 'error', text: text.slice(index, end) }, end)
      continue
    }

    if (!isNameCode(code)) {
      index += 1
      continue
    }

    const end = scanName(text, index)
    const name = text.slice(index, end)
    const next = text.charCodeAt(end)

    flushText(index)

    if (next === OPEN_PARENTHESIS) {
      push({ kind: 'function', text: name }, end)
      continue
    }

    if (next === EXCLAMATION) {
      isMalformed = isMalformed || isReferenceLike(name)
      push({ kind: 'sheet', text: `${name}!` }, end + 1)
      continue
    }

    if (next === OPEN_BRACKET) {
      push({ kind: 'text', text: name }, end)
      continue
    }

    if (next === COLON) {
      const secondEnd = scanName(text, end + 1)
      const second = text.slice(end + 1, secondEnd)
      const isSheetRange = second.length > 0
        && text.charCodeAt(secondEnd) === EXCLAMATION
      const firstCell = isSheetRange ? readCellReference(name) : null

      if (firstCell) {
        push(firstCell, end)
        continue
      }

      if (isSheetRange) {
        isMalformed = isMalformed
          || isReferenceLike(name)
          || isReferenceLike(second)
        push({ kind: 'sheet', text: `${name}:${second}!` }, secondEnd + 1)
        continue
      }

      const startColumn = readWholeLine(name, true)
      const endColumn = startColumn ? readWholeLine(second, true) : null

      if (startColumn && endColumn) {
        push({
          kind: 'columns',
          text: `${name}:${second}`,
          column: startColumn,
          endColumn,
        }, secondEnd)
        continue
      }

      const startRow = readWholeLine(name, false)
      const endRow = startRow ? readWholeLine(second, false) : null

      if (startRow && endRow) {
        push({
          kind: 'rows',
          text: `${name}:${second}`,
          row: startRow,
          endRow,
        }, secondEnd)
        continue
      }
    }

    const cell = readCellReference(name)

    push(cell ?? { kind: 'text', text: name }, end)
  }

  flushText(text.length)

  return { tokens, hasStructured, hasExternal, isMalformed }
}

function shiftPart(
  part: ReferencePart,
  delta: number,
  isColumn: boolean,
): string | null {
  const prefix = part.isAbsolute ? '$' : ''

  if (part.isAbsolute || delta === 0) {
    return `${prefix}${part.text}`
  }

  const value = part.value + delta
  const max = isColumn ? MAX_COLUMN : MAX_ROW

  if (value < 1 || value > max) {
    return null
  }

  return isColumn ? columnLetters(value) : String(value)
}

function shiftToken(
  token: FormulaToken,
  rowDelta: number,
  columnDelta: number,
): string | null {
  if (token.kind === 'cell' && token.column && token.row) {
    const column = shiftPart(token.column, columnDelta, true)
    const row = shiftPart(token.row, rowDelta, false)

    return column === null || row === null ? null : `${column}${row}`
  }

  if (token.kind === 'columns' && token.column && token.endColumn) {
    const start = shiftPart(token.column, columnDelta, true)
    const end = shiftPart(token.endColumn, columnDelta, true)

    return start === null || end === null ? null : `${start}:${end}`
  }

  if (token.kind === 'rows' && token.row && token.endRow) {
    const start = shiftPart(token.row, rowDelta, false)
    const end = shiftPart(token.endRow, rowDelta, false)

    return start === null || end === null ? null : `${start}:${end}`
  }

  return token.text
}

/**
 * The formula as it reads after a fill by `rowDelta` rows and `columnDelta`
 * columns: relative parts of cell, column and row references move, `$` parts
 * and everything else stay. Null when the result cannot be written the way
 * Excel would (a reference moves off the sheet, an external workbook, a
 * structured reference filled across columns, or text the tokenizer could
 * not read whole).
 */
export function shiftTokens(
  formula: TokenizedFormula,
  rowDelta: number,
  columnDelta: number,
): string | null {
  if (formula.isMalformed || formula.hasExternal) {
    return null
  }

  if (formula.hasStructured && columnDelta !== 0) {
    return null
  }

  const pieces: string[] = []

  for (const token of formula.tokens) {
    const shifted = shiftToken(token, rowDelta, columnDelta)

    if (shifted === null) {
      return null
    }

    pieces.push(shifted)
  }

  return pieces.join('')
}

export function shiftFormula(
  text: string,
  rowDelta: number,
  columnDelta: number,
): string | null {
  return shiftTokens(tokenizeFormula(text), rowDelta, columnDelta)
}

/**
 * Whether a shared formula's followers can be written out from its master.
 * External workbooks and structured references are left alone, so a
 * follower of such a master is reported as a copy, never rewritten.
 */
export function canExpandShared(formula: TokenizedFormula): boolean {
  return !formula.isMalformed && !formula.hasExternal && !formula.hasStructured
}

function relativeKey(part: ReferencePart, host: number): string {
  return part.isAbsolute ? `$${part.value}` : `~${part.value - host}`
}

/**
 * A key that is equal for two formulas when one is a fill-copy of the other:
 * relative parts become offsets from the formula's own cell. Equal keys are
 * only a hint; a merge also checks that shifting gives the exact text.
 */
export function relativeFormulaKey(
  formula: TokenizedFormula,
  row: number,
  column: number,
): string {
  const pieces: string[] = []

  for (const token of formula.tokens) {
    if (token.kind === 'cell' && token.column && token.row) {
      pieces.push(
        `\u0001${relativeKey(token.column, column)},`
        + `${relativeKey(token.row, row)}\u0001`,
      )
    } else if (token.kind === 'columns' && token.column && token.endColumn) {
      pieces.push(
        `\u0002${relativeKey(token.column, column)},`
        + `${relativeKey(token.endColumn, column)}\u0002`,
      )
    } else if (token.kind === 'rows' && token.row && token.endRow) {
      pieces.push(
        `\u0003${relativeKey(token.row, row)},`
        + `${relativeKey(token.endRow, row)}\u0003`,
      )
    } else {
      pieces.push(token.text)
    }
  }

  return pieces.join('')
}

function replaceNumbers(
  text: string,
  marker: string,
  literals: string[],
): string {
  const pieces: string[] = []
  let index = 0

  while (index < text.length) {
    const code = text.charCodeAt(index)
    const previous = index > 0 ? text.charCodeAt(index - 1) : 0
    const startsNumber = isDigitCode(code) && !isNameCode(previous)

    if (!startsNumber) {
      pieces.push(text.charAt(index))
      index += 1
      continue
    }

    const start = index

    while (
      index < text.length
      && (isDigitCode(text.charCodeAt(index)) || text.charCodeAt(index) === DOT)
    ) {
      index += 1
    }

    literals.push(text.slice(start, index))
    pieces.push(marker)
  }

  return pieces.join('')
}

/**
 * The formula with every string and number literal replaced by `marker`;
 * the literals are appended to `literals` in order. Rules that differ only
 * in a literal have the same template.
 */
export function formulaTemplate(
  text: string,
  marker: string,
  literals: string[],
): string {
  const { tokens } = tokenizeFormula(text)
  const pieces: string[] = []

  for (const token of tokens) {
    if (token.kind === 'string') {
      pieces.push(marker)
      literals.push(token.text)
    } else if (token.kind === 'text') {
      pieces.push(replaceNumbers(token.text, marker, literals))
    } else {
      pieces.push(token.text)
    }
  }

  return pieces.join('')
}
