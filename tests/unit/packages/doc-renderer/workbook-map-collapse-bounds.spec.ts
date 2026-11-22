import { describe, expect, it } from 'vitest'
import {
  cellAddress,
  collapseSheetFormulas,
  expandPattern,
  shiftFormula,
} from '@besidka/doc-renderer/workbook-map'
import type {
  CollapseResult,
  FormulaInput,
  SharedFormulaGroup,
} from '@besidka/doc-renderer/workbook-map'

function expandAll(result: CollapseResult): Map<string, string | null> {
  const cells = new Map<string, string | null>()

  for (const pattern of result.patterns) {
    for (const cell of expandPattern(pattern)) {
      const key = cellAddress(cell.row, cell.column)

      expect(cells.has(key)).toBe(false)
      cells.set(key, cell.formula)
    }
  }

  return cells
}

function longMaster(length: number): string {
  return `A1+${'B$1+'.repeat(Math.floor((length - 4) / 5))}1`
}

describe('collapseSheetFormulas bounds', () => {
  it('charges characters of real work and leaves the rest single', () => {
    const inputs: FormulaInput[] = []

    for (let row = 1; row <= 2000; row += 1) {
      inputs.push({
        row,
        column: 1,
        formula: `SUM(${'Z9,'.repeat(100)}$A$${row * 7})`,
      })
    }

    const budget = 20_000
    const result = collapseSheetFormulas(inputs, [], {
      exceptionsMax: 20,
      workCharactersMax: budget,
    })
    const expanded = expandAll(result)

    expect(result.workCharacters).toBeLessThanOrEqual(budget)
    expect(result.patterns.every(pattern => pattern.kind === 'single'))
      .toBe(true)
    expect(expanded.size).toBe(inputs.length)

    for (const input of inputs) {
      expect(expanded.get(cellAddress(input.row, input.column)))
        .toBe(input.formula)
    }
  })

  it('caps the formula cells that enter and counts the rest', () => {
    const inputs = Array.from({ length: 300 }, (_value, index) => {
      return { row: index + 1, column: 2, formula: `A${index + 1}*2` }
    })
    const result = collapseSheetFormulas(inputs, [], {
      exceptionsMax: 20,
      cellsMax: 100,
    })

    expect(result.cellsNotGrouped).toBe(200)
    expect(result.firstRowNotGrouped).toBe(101)
    expect(expandAll(result).size).toBe(100)
  })

  it('keeps one shared group as one block without deriving text', () => {
    const formula = longMaster(8190)
    const followers = []

    for (let row = 1; row <= 100; row += 1) {
      for (let column = 1; column <= 50; column += 1) {
        if (row > 1 || column > 1) {
          followers.push({ row, column })
        }
      }
    }

    const group: SharedFormulaGroup = {
      master: { row: 1, column: 1, formula },
      followers,
    }
    const result = collapseSheetFormulas([], [group], { exceptionsMax: 20 })

    expect(result.patterns).toHaveLength(1)
    expect(result.patterns[0]).toMatchObject({
      kind: 'block',
      start: { row: 1, column: 1 },
      end: { row: 100, column: 50 },
    })
    expect(result.derivedCharacters).toBe(0)
    expect(result.copies).toEqual([])

    const expanded = expandAll(result)

    for (const [row, column] of [[1, 1], [2, 1], [100, 50], [37, 12]]) {
      expect(expanded.get(cellAddress(row!, column!)))
        .toBe(shiftFormula(formula, row! - 1, column! - 1))
    }
  })

  it('derives only pattern heads and stops at the derived budget', () => {
    const formula = longMaster(4000)
    const followers = []

    for (let row = 4; row <= 200; row += 4) {
      for (let column = 1; column <= 40; column += 4) {
        followers.push({ row, column })
      }
    }

    const derivedCharactersMax = 40_000
    const result = collapseSheetFormulas([], [{
      master: { row: 1, column: 1, formula },
      followers,
    }], { exceptionsMax: 20, derivedCharactersMax })
    const expanded = expandAll(result)
    const copied = result.copies.reduce((sum, copies) => {
      return sum + copies.cells.length
    }, 0)

    expect(result.derivedCharacters).toBeLessThanOrEqual(derivedCharactersMax)
    expect(copied).toBeGreaterThan(0)
    expect(expanded.size + copied).toBe(followers.length + 1)

    for (const [address, text] of expanded) {
      const cell = followers.find((follower) => {
        return cellAddress(follower.row, follower.column) === address
      }) ?? { row: 1, column: 1 }

      expect(text).toBe(shiftFormula(formula, cell.row - 1, cell.column - 1))
    }
  })

  it('joins groups split by a subtotal and plain copies of the fill', () => {
    const groups: SharedFormulaGroup[] = [
      {
        master: { row: 7, column: 6, formula: 'E7*$C$2' },
        followers: [8, 9, 10].map(row => ({ row, column: 6 })),
      },
      {
        master: { row: 12, column: 6, formula: 'E12*$C$2' },
        followers: [13, 14].map(row => ({ row, column: 6 })),
      },
    ]
    const normal: FormulaInput[] = [
      { row: 11, column: 6, formula: 'SUM(F7:F10)' },
      { row: 15, column: 6, formula: 'E15*$C$2' },
    ]
    const result = collapseSheetFormulas(normal, groups, { exceptionsMax: 20 })
    const fill = result.patterns.find(pattern => pattern.kind === 'down')

    expect(fill).toMatchObject({
      start: { row: 7, column: 6 },
      end: { row: 15, column: 6 },
      formula: 'E7*$C$2',
      exceptions: [{
        from: { row: 11, column: 6 },
        to: { row: 11, column: 6 },
      }],
    })
    expect(expandAll(result).get('F15')).toBe('E15*$C$2')
  })

  it('lists followers whose shift would leave the sheet as copies', () => {
    const result = collapseSheetFormulas([], [{
      master: { row: 5, column: 2, formula: 'A1*2' },
      followers: [1, 2, 3, 4].map(row => ({ row, column: 2 })),
    }], { exceptionsMax: 20 })

    expect(result.patterns).toEqual([])
    expect(result.copies).toEqual([{
      master: { row: 5, column: 2 },
      cells: [1, 2, 3, 4, 5].map(row => ({ row, column: 2 })),
    }])
  })
})
