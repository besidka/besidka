import { XLFN_PREFIX, XLSX_FORMULA_FUNCTION_ALLOWLIST } from './rules.ts'

export type FormulaCheckResult
  = | { ok: true, functions: string[] }
    | { ok: false, code: string, detail: string }

const MAX_FORMULA_LENGTH = 8192
const IDENTIFIER_PATTERN = /^[\p{L}_$][\p{L}\p{N}_.$]*/u
const NUMBER_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/
const CELL_REFERENCE_PATTERN = /^\$?[A-Za-z]{1,3}\$?\d+$/
const COLUMN_REFERENCE_PATTERN = /^\$?[A-Za-z]{1,3}$/
const OPERATOR_CHARACTERS = new Set([
  '+',
  '-',
  '*',
  '/',
  '^',
  '&',
  '=',
  '<',
  '>',
  '%',
  ',',
  ';',
  ':',
  '(',
  ')',
  '{',
  '}',
  '#',
])
const FORBIDDEN_SHEET_CHARACTERS = /[[\]:*?/\\]/

function failure(code: string, detail: string): FormulaCheckResult {
  return { ok: false, code, detail }
}

function normalizeFunctionName(name: string): string {
  const upper = name.toUpperCase()

  return upper.startsWith(XLFN_PREFIX.toUpperCase())
    ? upper.slice(XLFN_PREFIX.length)
    : upper
}

/**
 * Tokenizer-based allowlist for one formula (the text of an `<f>` element or a
 * spec `{ formula }`, with or without the leading `=`). Strings are skipped
 * whole, so a function name inside quotes is data. Anything outside the
 * grammar fails closed: DDE (`|`), external workbook references (`[`, `\`),
 * R1C1 strings, unknown functions and unknown names.
 */
export function checkFormula(formula: string): FormulaCheckResult {
  if (formula.length > MAX_FORMULA_LENGTH) {
    return failure('formula_syntax', 'Formula is too long')
  }

  const source = formula.startsWith('=') ? formula.slice(1) : formula
  const functions: string[] = []
  let depth = 0
  let index = 0
  let previous = ''

  while (index < source.length) {
    const character = source[index] as string

    if (character === ' ' || character === '\t' || character === '\n'
      || character === '\r') {
      index += 1
      continue
    }

    if (character === '"') {
      let cursor = index + 1
      let isClosed = false

      while (cursor < source.length) {
        if (source[cursor] === '"') {
          if (source[cursor + 1] === '"') {
            cursor += 2
            continue
          }

          isClosed = true
          break
        }

        cursor += 1
      }

      if (!isClosed) {
        return failure('formula_syntax', 'Unterminated string literal')
      }

      index = cursor + 1
      previous = 'string'
      continue
    }

    if (character === '\'') {
      let cursor = index + 1
      let isClosed = false
      let sheetName = ''

      while (cursor < source.length) {
        if (source[cursor] === '\'') {
          if (source[cursor + 1] === '\'') {
            sheetName += '\''
            cursor += 2
            continue
          }

          isClosed = true
          break
        }

        sheetName += source[cursor]
        cursor += 1
      }

      if (!isClosed || source[cursor + 1] !== '!') {
        return failure('formula_syntax', 'Malformed quoted sheet reference')
      }

      if (FORBIDDEN_SHEET_CHARACTERS.test(sheetName)) {
        return failure(
          'formula_not_allowed',
          'External or 3D reference in a sheet name',
        )
      }

      index = cursor + 2
      previous = 'sheet'
      continue
    }

    if (character === '[' || character === ']' || character === '|'
      || character === '\\' || character === '@') {
      return failure(
        'formula_not_allowed',
        `Character "${character}" is not allowed (external reference, DDE or implicit intersection)`,
      )
    }

    const numberMatch = NUMBER_PATTERN.exec(source.slice(index))

    if (numberMatch) {
      index += numberMatch[0].length
      previous = 'number'
      continue
    }

    const identifierMatch = IDENTIFIER_PATTERN.exec(source.slice(index))

    if (identifierMatch) {
      const identifier = identifierMatch[0]
      const next = source[index + identifier.length]

      index += identifier.length

      if (next === '(') {
        const name = normalizeFunctionName(identifier)

        if (!XLSX_FORMULA_FUNCTION_ALLOWLIST.has(name)) {
          return failure(
            'formula_not_allowed',
            `Function ${name.slice(0, 40)} is not allowed`,
          )
        }

        functions.push(name)
        previous = 'function'
        continue
      }

      if (next === '!') {
        index += 1
        previous = 'sheet'
        continue
      }

      const upper = identifier.toUpperCase()

      if (upper === 'TRUE' || upper === 'FALSE') {
        previous = 'name'
        continue
      }

      if (CELL_REFERENCE_PATTERN.test(identifier)) {
        previous = 'reference'
        continue
      }

      const isColumnRange = COLUMN_REFERENCE_PATTERN.test(identifier)
        && (next === ':' || previous === ':')

      if (isColumnRange) {
        previous = 'reference'
        continue
      }

      return failure(
        'formula_not_allowed',
        `Name ${identifier.slice(0, 40)} is not allowed`,
      )
    }

    if (OPERATOR_CHARACTERS.has(character)) {
      if (character === '(') {
        depth += 1
      }

      if (character === ')') {
        depth -= 1

        if (depth < 0) {
          return failure('formula_syntax', 'Unbalanced parentheses')
        }
      }

      index += 1
      previous = character
      continue
    }

    return failure(
      'formula_syntax',
      `Unexpected character ${JSON.stringify(character)}`,
    )
  }

  if (depth !== 0) {
    return failure('formula_syntax', 'Unbalanced parentheses')
  }

  return { ok: true, functions }
}
