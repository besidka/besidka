import { describe, expect, it } from 'vitest'
import { shiftFormula } from '@besidka/doc-renderer/workbook-map'

const ROW_MAX = 1_048_576
const COLUMN_MAX = 16_384

interface Generated {
  source: string
  shifted: (rowDelta: number, columnDelta: number) => string | null
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0

    return state / 4294967296
  }
}

function lettersOf(column: number): string {
  let rest = column
  let text = ''

  while (rest > 0) {
    const remainder = (rest - 1) % 26

    text = String.fromCharCode(65 + remainder) + text
    rest = Math.floor((rest - 1) / 26)
  }

  return text
}

function moved(
  value: number,
  isAbsolute: boolean,
  delta: number,
  max: number,
): number | null {
  if (isAbsolute) {
    return value
  }

  const next = value + delta

  return next < 1 || next > max ? null : next
}

function joined(parts: Generated[]): Generated {
  return {
    source: parts.map(part => part.source).join(''),
    shifted: (rowDelta, columnDelta) => {
      let text = ''

      for (const part of parts) {
        const piece = part.shifted(rowDelta, columnDelta)

        if (piece === null) {
          return null
        }

        text += piece
      }

      return text
    },
  }
}

function literal(text: string): Generated {
  return { source: text, shifted: () => text }
}

const SHEET_PREFIXES = [
  '',
  '',
  'Sheet2!',
  'Sales_2024!',
  '\'It\'\'s\'!',
  '\'S 1\'!',
  '\'A1\'!',
  'Sheet1:Sheet3!',
  '\'Sheet1:Sheet3\'!',
  'Лист1!',
  '\'Лист 1\'!',
  '_xlnm.X!',
]

const LITERALS = [
  '1',
  '0.5',
  '1E5',
  '"A1"',
  '"say ""B2"" now"',
  'TRUE',
  '#REF!',
  '#N/A',
  'TaxRate',
  'R1C1',
  'XFE1',
  '{1,2;3,4}',
]

const FUNCTIONS = ['SUM', 'LOG10', '_xlfn.XLOOKUP', 'IF', 'INDEX']

/**
 * An independent reference shifter for the tests: it builds each formula
 * from known references, so it knows what every reference must become
 * without reading the formula back.
 */
function createGenerator(random: () => number) {
  function pick<Item>(items: readonly Item[]): Item {
    return items[Math.floor(random() * items.length)] as Item
  }

  function edgeOrSmall(max: number, edges: readonly number[]): number {
    return random() < 0.3 ? pick(edges) : 1 + Math.floor(random() * 60)
  }

  function cell(): Generated {
    const column = edgeOrSmall(COLUMN_MAX, [1, 2, 26, 27, 702, 16383, 16384])
    const row = edgeOrSmall(ROW_MAX, [1, 2, 1000, ROW_MAX - 1, ROW_MAX])
    const isColumnAbsolute = random() < 0.3
    const isRowAbsolute = random() < 0.3
    const write = (columnValue: number, rowValue: number): string => {
      return `${isColumnAbsolute ? '$' : ''}${lettersOf(columnValue)}`
        + `${isRowAbsolute ? '$' : ''}${rowValue}`
    }

    return {
      source: write(column, row),
      shifted: (rowDelta, columnDelta) => {
        const nextColumn = moved(
          column,
          isColumnAbsolute,
          columnDelta,
          COLUMN_MAX,
        )
        const nextRow = moved(row, isRowAbsolute, rowDelta, ROW_MAX)

        return nextColumn === null || nextRow === null
          ? null
          : write(nextColumn, nextRow)
      },
    }
  }

  function prefixed(inner: Generated): Generated {
    return joined([literal(pick(SHEET_PREFIXES)), inner])
  }

  function atom(): Generated {
    const kind = random()

    if (kind < 0.35) {
      return prefixed(cell())
    }

    if (kind < 0.7) {
      return joined([prefixed(cell()), literal(':'), prefixed(cell())])
    }

    return literal(pick(LITERALS))
  }

  function expression(depth: number): Generated {
    const parts: Generated[] = []
    const count = 1 + Math.floor(random() * 4)

    for (let index = 0; index < count; index += 1) {
      if (index > 0) {
        parts.push(literal(pick(['+', '-', '*', ',', '&', ' '])))
      }

      if (random() < 0.2 && depth < 2) {
        parts.push(joined([
          literal(`${pick(FUNCTIONS)}(`),
          expression(depth + 1),
          literal(')'),
        ]))
      } else {
        parts.push(atom())
      }
    }

    return joined(parts)
  }

  return { expression }
}

describe('shiftFormula against an independent shifter', () => {
  it('never returns a shifted formula that differs from the oracle', () => {
    const random = createRandom(20261122)
    const generator = createGenerator(random)
    const wrong: Array<Record<string, unknown>> = []
    let shiftedCount = 0

    for (let index = 0; index < 20000; index += 1) {
      const generated = generator.expression(0)
      const rowDelta = Math.floor(random() * 41) - 20
      const columnDelta = Math.floor(random() * 41) - 20
      const expected = generated.shifted(rowDelta, columnDelta)
      const actual = shiftFormula(generated.source, rowDelta, columnDelta)

      if (actual !== null) {
        shiftedCount += 1
      }

      if (actual !== null && actual !== expected && wrong.length < 5) {
        wrong.push({
          source: generated.source,
          rowDelta,
          columnDelta,
          expected,
          actual,
        })
      }
    }

    expect(wrong).toEqual([])
    expect(shiftedCount).toBeGreaterThan(5000)
  })

  it('moves both corners of a range that repeats the sheet', () => {
    expect(shiftFormula('Sheet1!A1:Sheet1!B2', 1, 0))
      .toBe('Sheet1!A2:Sheet1!B3')
    expect(shiftFormula('\'Sheet 1\'!A1:\'Sheet 1\'!B2', 1, 1))
      .toBe('\'Sheet 1\'!B2:\'Sheet 1\'!C3')
    expect(shiftFormula('A1:Sheet2!$B2', 2, 0)).toBe('A3:Sheet2!$B4')
    expect(shiftFormula('Plan:Fact!A1:Plan:Fact!B$2', 1, 0))
      .toBe('Plan:Fact!A2:Plan:Fact!B$2')
  })

  it('refuses a prefix that could also be a reference', () => {
    expect(shiftFormula('Q1!A1', 1, 0)).toBeNull()
    expect(shiftFormula('A1:B2!C3', 1, 0)).toBeNull()
    expect(shiftFormula('AB:Sheet3!A1', 1, 0)).toBeNull()
    expect(shiftFormula('1:Sheet2!A1', 1, 0)).toBeNull()
    expect(shiftFormula('Sheet1:A1!B2', 1, 0)).toBeNull()
    expect(shiftFormula('$A$1!B2', 1, 0)).toBeNull()
    expect(shiftFormula('Jan:Mar!D4', 1, 0)).toBeNull()
  })
})
