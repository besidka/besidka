import { describe, expect, it } from 'vitest'
import {
  canExpandShared,
  cellAddress,
  collapseFormulas,
  expandPattern,
  parseRange,
  parseRangeList,
  shiftFormula,
  tokenizeFormula,
} from '@besidka/doc-renderer/workbook-map'
import type { FormulaInput } from '@besidka/doc-renderer/workbook-map'

function kinds(formula: string): Array<[string, string]> {
  return tokenizeFormula(formula).tokens.map((token) => {
    return [token.kind, token.text]
  })
}

describe('tokenizeFormula', () => {
  it('reads a name before a parenthesis as a function, not a cell', () => {
    expect(kinds('LOG10(A1)+ATAN2(B2,C3)')).toEqual([
      ['function', 'LOG10'],
      ['text', '('],
      ['cell', 'A1'],
      ['text', ')+'],
      ['function', 'ATAN2'],
      ['text', '('],
      ['cell', 'B2'],
      ['text', ','],
      ['cell', 'C3'],
      ['text', ')'],
    ])
  })

  it('keeps string literals whole, including text that looks like cells', () => {
    expect(kinds('"A1 ↓ {row}"&B2')).toEqual([
      ['string', '"A1 ↓ {row}"'],
      ['text', '&'],
      ['cell', 'B2'],
    ])
    expect(kinds('"say ""A1"""')).toEqual([['string', '"say ""A1"""']])
  })

  it('reads quoted, unquoted and 3D sheet prefixes', () => {
    expect(kinds('\'Rate\'\'s A1\'!$B$2+Lines!C3+Jan:Mar!D4')).toEqual([
      ['sheet', '\'Rate\'\'s A1\'!'],
      ['cell', '$B$2'],
      ['text', '+'],
      ['sheet', 'Lines!'],
      ['cell', 'C3'],
      ['text', '+'],
      ['sheet', 'Jan:Mar!'],
      ['cell', 'D4'],
    ])
  })

  it('reads whole columns, whole rows, errors and lowercase references', () => {
    expect(kinds('SUM(A:C)+SUM($2:$4)+#REF!+a1')).toEqual([
      ['function', 'SUM'],
      ['text', '('],
      ['columns', 'A:C'],
      ['text', ')+'],
      ['function', 'SUM'],
      ['text', '('],
      ['rows', '$2:$4'],
      ['text', ')+'],
      ['error', '#REF!'],
      ['text', '+'],
      ['cell', 'a1'],
    ])
  })

  it('leaves names, booleans, numbers and R1C1-looking text alone', () => {
    const tokens = tokenizeFormula('TaxRate*TRUE+1.5E+3+R1C1+XFE1')

    expect(tokens.tokens.filter(token => token.kind === 'cell')).toEqual([])
  })

  it('flags structured and external references', () => {
    const structured = tokenizeFormula('SUM(Table1[@Hours])')
    const external = tokenizeFormula('[1]Rates!A1+\'[2]Other\'!B2')

    expect(structured.hasStructured).toBe(true)
    expect(structured.hasExternal).toBe(false)
    expect(external.hasExternal).toBe(true)
    expect(canExpandShared(structured)).toBe(false)
    expect(canExpandShared(external)).toBe(false)
    expect(canExpandShared(tokenizeFormula('A1*2'))).toBe(true)
  })

  it('marks an unterminated string as malformed', () => {
    expect(tokenizeFormula('"open + A1').isMalformed).toBe(true)
  })
})

describe('shiftFormula', () => {
  it('moves relative parts and keeps $ parts', () => {
    expect(shiftFormula('A1+$B$2+B$3+$C4', 2, 1)).toBe('B3+$B$2+C$3+$C6')
  })

  it('moves the cell part of a sheet-qualified reference', () => {
    expect(shiftFormula('\'My sheet\'!C5*Lines!$D$1', 1, 0))
      .toBe('\'My sheet\'!C6*Lines!$D$1')
  })

  it('moves whole columns only across and whole rows only down', () => {
    expect(shiftFormula('SUM(A:A)+SUM(3:3)', 2, 0)).toBe('SUM(A:A)+SUM(5:5)')
    expect(shiftFormula('SUM(A:A)+SUM(3:3)', 0, 1)).toBe('SUM(B:B)+SUM(3:3)')
  })

  it('keeps strings, names and functions', () => {
    expect(shiftFormula('IF(M8="A1",LOG10(TaxRate),0)', 1, 0))
      .toBe('IF(M9="A1",LOG10(TaxRate),0)')
  })

  it('refuses what it cannot write the way Excel would', () => {
    expect(shiftFormula('XFD1+1', 0, 1)).toBeNull()
    expect(shiftFormula('A1', -1, 0)).toBeNull()
    expect(shiftFormula('[1]Rates!A1', 1, 0)).toBeNull()
    expect(shiftFormula('Table1[Hours]', 0, 1)).toBeNull()
    expect(shiftFormula('Table1[@Hours]*2', 1, 0)).toBe('Table1[@Hours]*2')
  })
})

describe('address helpers', () => {
  it('parses ranges and range lists', () => {
    expect(parseRange('$B$2:A1')).toEqual({
      top: 1,
      left: 1,
      bottom: 2,
      right: 2,
    })
    expect(parseRange('A:A')).toBeNull()
    expect(parseRangeList('A1:B2 C3 bad D4', 10)).toHaveLength(3)
    expect(cellAddress(164, 16)).toBe('P164')
  })
})

function mulberry32(seed: number): () => number {
  let state = seed

  return () => {
    state = (state + 0x6D2B79F5) | 0

    let value = Math.imul(state ^ (state >>> 15), 1 | state)

    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function letters(column: number): string {
  let remaining = column
  let text = ''

  while (remaining > 0) {
    const rest = (remaining - 1) % 26

    text = String.fromCharCode(65 + rest) + text
    remaining = Math.floor((remaining - 1) / 26)
  }

  return text
}

type Template = (row: number, column: number) => string

const TEMPLATES: Template[] = [
  row => `INDEX(Parameters!$D$7:$D$11, MATCH(M${row}, Parameters!$B$7:$B$11, 0))`,
  row => `IFERROR(VLOOKUP(E${row},Lists!$B$6:$C$45,2,FALSE),"")`,
  (row, column) => `${letters(column - 1)}${row}*$C$2`,
  row => `SUM(OFFSET(P${row},-11,0,11,1))`,
  row => `'Rate''s sheet'!B${row} + 'Rate''s sheet'!$C$1`,
  row => `SUMIFS(Lines!$P:$P,Lines!$E:$E,$B${row})`,
  row => `COUNTIFS(Lines!$E$8:$E$164,"A1 ↓ {row}",Lines!F$8:F$164,">"&a${row})`,
  row => `LOG10(H${row}) + #REF! + TaxRate`,
  row => `SUM(${row}:${row})`,
  (_row, column) => `SUM(${letters(column)}:${letters(column)})`,
  row => `IF( C${row} = "", "", C${row} * D$5 )`,
  row => `Table1[@Hours]*B${row}`,
]

function buildSheet(seed: number): FormulaInput[] {
  const random = mulberry32(seed)
  const cells: FormulaInput[] = []
  const columns = 2 + Math.floor(random() * 6)

  for (let column = 2; column < 2 + columns; column += 1) {
    const template = TEMPLATES[Math.floor(random() * TEMPLATES.length)]!
    const rows = 5 + Math.floor(random() * 40)

    for (let row = 3; row < 3 + rows; row += 1) {
      const roll = random()

      if (roll < 0.07) {
        continue
      }

      const chosen = roll < 0.15
        ? TEMPLATES[Math.floor(random() * TEMPLATES.length)]!
        : template

      cells.push({ row, column, formula: chosen(row, column) })
    }
  }

  return cells
}

function assertRoundTrip(cells: FormulaInput[]): void {
  const patterns = collapseFormulas(cells, 20)
  const expanded = new Map<string, string | null>()

  for (const pattern of patterns) {
    for (const cell of expandPattern(pattern)) {
      const key = `${cell.row}:${cell.column}`

      expect(expanded.has(key), `${key} covered twice`).toBe(false)
      expanded.set(key, cell.formula)
    }
  }

  expect(expanded.size).toBe(cells.length)

  for (const cell of cells) {
    expect(expanded.get(`${cell.row}:${cell.column}`)).toBe(cell.formula)
  }
}

describe('collapseFormulas', () => {
  it('round-trips generated sheets exactly', () => {
    let cellCount = 0
    let patternCount = 0

    for (let seed = 1; seed <= 60; seed += 1) {
      const cells = buildSheet(seed)

      assertRoundTrip(cells)
      cellCount += cells.length
      patternCount += collapseFormulas(cells, 20).length
    }

    expect(patternCount).toBeLessThan(cellCount / 4)
  })

  it('collapses a filled column with a subtotal row as an exception', () => {
    const cells: FormulaInput[] = []

    for (let row = 8; row <= 30; row += 1) {
      cells.push({
        row,
        column: 16,
        formula: row === 19
          ? 'SUM(OFFSET(P19,-11,0,11,1))'
          : `M${row}*$C$2`,
      })
    }

    const patterns = collapseFormulas(cells, 20)

    expect(patterns).toHaveLength(2)
    expect(patterns[0]).toMatchObject({
      kind: 'down',
      start: { row: 8, column: 16 },
      end: { row: 30, column: 16 },
      formula: 'M8*$C$2',
    })
    expect(patterns[0]!.exceptions).toEqual([
      { from: { row: 19, column: 16 }, to: { row: 19, column: 16 } },
    ])
    assertRoundTrip(cells)
  })

  it('never merges look-alike formulas that are not fill copies', () => {
    const cells: FormulaInput[] = [
      { row: 1, column: 1, formula: 'B1*2' },
      { row: 2, column: 1, formula: 'B3*2' },
      { row: 3, column: 1, formula: 'b3*2' },
      { row: 4, column: 1, formula: 'B4 *2' },
    ]

    const patterns = collapseFormulas(cells, 20)

    expect(patterns.every(pattern => pattern.kind === 'single')).toBe(true)
    assertRoundTrip(cells)
  })

  it('collapses a row of totals to the right', () => {
    const cells = Array.from({ length: 12 }, (_value, index) => {
      const column = index + 3

      return {
        row: 5,
        column,
        formula: `SUM(${letters(column)}8:${letters(column)}164)`,
      }
    })

    const patterns = collapseFormulas(cells, 20)

    expect(patterns).toHaveLength(1)
    expect(patterns[0]!.kind).toBe('right')
    assertRoundTrip(cells)
  })
})
