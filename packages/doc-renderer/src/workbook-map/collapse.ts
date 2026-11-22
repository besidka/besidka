import type { CellPosition } from './address.ts'
import {
  relativeFormulaKey,
  shiftTokens,
  tokenizeFormula,
} from './formula.ts'
import type { TokenizedFormula } from './formula.ts'

export type FormulaPatternKind = 'down' | 'right' | 'single'

export interface FormulaPattern {
  kind: FormulaPatternKind
  start: CellPosition
  end: CellPosition
  formula: string
  exceptions: Array<{ from: CellPosition, to: CellPosition }>
}

export interface FormulaInput {
  row: number
  column: number
  formula: string
}

interface FormulaEntry extends FormulaInput {
  tokens: TokenizedFormula
  key: string
  isUsed: boolean
}

type Axis = 'down' | 'right'

const GAP_MAX = 2

function positionOf(entry: FormulaEntry, axis: Axis): number {
  return axis === 'down' ? entry.row : entry.column
}

function isFillCopy(
  master: FormulaEntry,
  entry: FormulaEntry,
): boolean {
  if (master.key !== entry.key) {
    return false
  }

  const shifted = shiftTokens(
    master.tokens,
    entry.row - master.row,
    entry.column - master.column,
  )

  return shifted === entry.formula
}

function cellAt(
  master: FormulaEntry,
  axis: Axis,
  position: number,
): CellPosition {
  return axis === 'down'
    ? { row: position, column: master.column }
    : { row: master.row, column: position }
}

function findRun(
  line: FormulaEntry[],
  startIndex: number,
  axis: Axis,
  exceptionsMax: number,
): { members: FormulaEntry[], gaps: Array<[number, number]> } | null {
  const master = line[startIndex] as FormulaEntry
  const members: FormulaEntry[] = [master]
  const gaps: Array<[number, number]> = []
  let lastPosition = positionOf(master, axis)
  let best: { memberCount: number, gapCount: number } | null = null
  let exceptionCount = 0

  for (let index = startIndex + 1; index < line.length; index += 1) {
    const entry = line[index] as FormulaEntry
    const position = positionOf(entry, axis)
    const gap = position - lastPosition - 1

    if (gap > GAP_MAX) {
      break
    }

    if (entry.isUsed || !isFillCopy(master, entry)) {
      continue
    }

    if (gap > 0) {
      gaps.push([lastPosition + 1, position - 1])
      exceptionCount += gap
    }

    members.push(entry)
    lastPosition = position

    if (gaps.length > exceptionsMax) {
      break
    }

    if (exceptionCount <= members.length) {
      best = { memberCount: members.length, gapCount: gaps.length }
    }
  }

  if (best === null) {
    return null
  }

  return {
    members: members.slice(0, best.memberCount),
    gaps: gaps.slice(0, best.gapCount),
  }
}

function collectRuns(
  entries: FormulaEntry[],
  axis: Axis,
  exceptionsMax: number,
): FormulaPattern[] {
  const lines = new Map<number, FormulaEntry[]>()

  for (const entry of entries) {
    if (entry.isUsed) {
      continue
    }

    const lineKey = axis === 'down' ? entry.column : entry.row
    const line = lines.get(lineKey)

    if (line) {
      line.push(entry)
    } else {
      lines.set(lineKey, [entry])
    }
  }

  const patterns: FormulaPattern[] = []

  for (const line of lines.values()) {
    line.sort((first, second) => {
      return positionOf(first, axis) - positionOf(second, axis)
    })

    for (let index = 0; index < line.length; index += 1) {
      const master = line[index] as FormulaEntry

      if (master.isUsed) {
        continue
      }

      const run = findRun(line, index, axis, exceptionsMax)

      if (run === null) {
        continue
      }

      for (const member of run.members) {
        member.isUsed = true
      }

      const last = run.members[run.members.length - 1] as FormulaEntry

      patterns.push({
        kind: axis,
        start: { row: master.row, column: master.column },
        end: { row: last.row, column: last.column },
        formula: master.formula,
        exceptions: run.gaps.map(([from, to]) => {
          return {
            from: cellAt(master, axis, from),
            to: cellAt(master, axis, to),
          }
        }),
      })
    }
  }

  return patterns
}

/**
 * Groups formulas into fill patterns. A run down a column (then, for what is
 * left, along a row) is formed only from cells whose formula is exactly the
 * first cell's formula shifted by the distance between them, so expanding a
 * pattern gives back every original text. Cells inside a run that are not
 * copies (a subtotal row, an empty cell) are listed as exceptions; a gap of
 * more than two such cells ends the run, and a run never has more exception
 * cells than copies. What stays alone is a `single` pattern.
 */
export function collapseFormulas(
  inputs: readonly FormulaInput[],
  exceptionsMax: number,
): FormulaPattern[] {
  const entries: FormulaEntry[] = inputs.map((input) => {
    const tokens = tokenizeFormula(input.formula)

    return {
      ...input,
      tokens,
      key: relativeFormulaKey(tokens, input.row, input.column),
      isUsed: false,
    }
  })
  const patterns = [
    ...collectRuns(entries, 'down', exceptionsMax),
    ...collectRuns(entries, 'right', exceptionsMax),
  ]

  for (const entry of entries) {
    if (!entry.isUsed) {
      patterns.push({
        kind: 'single',
        start: { row: entry.row, column: entry.column },
        end: { row: entry.row, column: entry.column },
        formula: entry.formula,
        exceptions: [],
      })
    }
  }

  return patterns.sort((first, second) => {
    return first.start.row - second.start.row
      || first.start.column - second.start.column
  })
}

/**
 * Every cell a pattern stands for, with the formula it gives that cell. The
 * inverse of `collapseFormulas`, used by the round-trip tests and by readers
 * of the model that want the cells back.
 */
export function expandPattern(
  pattern: FormulaPattern,
): Array<FormulaInput | { row: number, column: number, formula: null }> {
  const tokens = tokenizeFormula(pattern.formula)
  const isException = (row: number, column: number): boolean => {
    return pattern.exceptions.some(({ from, to }) => {
      return row >= from.row && row <= to.row
        && column >= from.column && column <= to.column
    })
  }
  const cells: Array<
    FormulaInput | { row: number, column: number, formula: null }
  > = []

  for (let row = pattern.start.row; row <= pattern.end.row; row += 1) {
    for (
      let column = pattern.start.column;
      column <= pattern.end.column;
      column += 1
    ) {
      if (isException(row, column)) {
        continue
      }

      const rowDelta = row - pattern.start.row
      const columnDelta = column - pattern.start.column

      cells.push({
        row,
        column,
        formula: rowDelta === 0 && columnDelta === 0
          ? pattern.formula
          : shiftTokens(tokens, rowDelta, columnDelta),
      })
    }
  }

  return cells
}
