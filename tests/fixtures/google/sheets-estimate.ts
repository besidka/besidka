const ROLES = ['Lead', 'Designer', 'Developer', 'Tester', 'Writer']
const HOURS = [8, 6, 7, 5, 4]
const HOURS_FORMAT = '0.0" h"'
const MONEY_FORMAT = '#,##0.00'

export const SPREADSHEET_ID = '1EstimateEstimateEstimateEstimate01'

export const SHEET_IDS = {
  lists: 101,
  parameters: 102,
  lines: 103,
  extra: 104,
  summary: 105,
} as const

export interface CellSpec {
  text?: string
  number?: number
  formula?: string
  shown?: string
  format?: string
  note?: string
  link?: boolean
  validation?: Record<string, unknown>
}

export type CellMap = Record<string, CellSpec>

function columnIndex(letters: string): number {
  let value = 0

  for (const letter of letters) {
    value = value * 26 + letter.charCodeAt(0) - 64
  }

  return value - 1
}

function toCellData(spec: CellSpec): Record<string, unknown> {
  const cell: Record<string, unknown> = {}

  if (spec.formula !== undefined) {
    cell.userEnteredValue = { formulaValue: `=${spec.formula}` }
  } else if (spec.text !== undefined) {
    cell.userEnteredValue = { stringValue: spec.text }
  } else if (spec.number !== undefined) {
    cell.userEnteredValue = { numberValue: spec.number }
  }

  const shown = spec.shown ?? spec.text
    ?? (spec.number === undefined ? undefined : String(spec.number))

  if (shown !== undefined) {
    cell.formattedValue = shown
  }

  if (spec.format) {
    cell.userEnteredFormat = {
      numberFormat: { type: 'NUMBER', pattern: spec.format },
    }
  }

  if (spec.note) {
    cell.note = spec.note
  }

  if (spec.link) {
    cell.hyperlink = 'https://example.com/estimate'
  }

  if (spec.validation) {
    cell.dataValidation = spec.validation
  }

  return cell
}

/**
 * Cells keyed by A1 address as the `rowData` of a Sheets answer: rows and
 * cells are listed from A1 with `{}` for gaps and nothing after the last
 * one, like Google trims them.
 */
export function rowDataOf(cells: CellMap): Array<{ values: unknown[] }> {
  const rows = new Map<number, Map<number, Record<string, unknown>>>()

  for (const [address, spec] of Object.entries(cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(address) as RegExpExecArray
    const row = Number(match[2]) - 1
    const column = columnIndex(match[1] as string)
    const rowCells = rows.get(row) ?? new Map()

    rowCells.set(column, toCellData(spec))
    rows.set(row, rowCells)
  }

  const lastRow = Math.max(...rows.keys())

  return Array.from({ length: lastRow + 1 }, (_row, rowIndex) => {
    const rowCells = rows.get(rowIndex)

    if (!rowCells) {
      return { values: [] }
    }

    const lastColumn = Math.max(...rowCells.keys())

    return {
      values: Array.from({ length: lastColumn + 1 }, (_cell, index) => {
        return rowCells.get(index) ?? {}
      }),
    }
  })
}

export function gridAnswer(
  sheetId: number,
  title: string,
  cells: CellMap,
  offsets: { startRow?: number, startColumn?: number } = {},
) {
  return {
    spreadsheetId: SPREADSHEET_ID,
    sheets: [{
      properties: { ...(sheetId === 0 ? {} : { sheetId }), title },
      data: [{ ...offsets, rowData: rowDataOf(cells) }],
    }],
  }
}

function range(
  sheetId: number,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
) {
  return {
    sheetId,
    startRowIndex: startRow,
    endRowIndex: endRow,
    startColumnIndex: startColumn,
    endColumnIndex: endColumn,
  }
}

function listsCells(): CellMap {
  const cells: CellMap = { B5: { text: 'Roles' } }

  ROLES.forEach((role, index) => {
    cells[`B${6 + index}`] = { text: role }
  })

  return cells
}

function parameterCells(): CellMap {
  const cells: CellMap = {
    B3: { text: 'Tax rate' },
    C3: { number: 0.2, shown: '20%', format: '0%' },
    B6: { text: 'Role' },
    D6: { text: 'Hours per item' },
  }

  ROLES.forEach((role, index) => {
    cells[`B${7 + index}`] = { text: role }
    cells[`D${7 + index}`] = {
      number: HOURS[index] as number,
      shown: `${HOURS[index]}.0 h`,
      format: HOURS_FORMAT,
    }
  })

  return cells
}

function lookupFormula(row: number): string {
  return `INDEX(Parameters!$D$7:$D$11, MATCH(E${row}, `
    + 'Parameters!$B$7:$B$11, 0))'
}

function lineCells(): CellMap {
  const cells: CellMap = {
    A1: { text: 'Website estimate', link: true },
    A6: { text: 'Item' },
    E6: {
      text: 'Role',
      note: 'Pick a role from the list on the Lists tab.',
    },
    F6: { text: 'Hours' },
    G6: { text: 'Quantity' },
    H6: { text: 'Total hours' },
  }
  const roleValidation = {
    condition: {
      type: 'ONE_OF_RANGE',
      values: [{ userEnteredValue: '=Lists!$B$6:$B$45' }],
    },
    strict: true,
    showCustomUi: true,
  }
  const quantityValidation = {
    condition: {
      type: 'NUMBER_BETWEEN',
      values: [{ userEnteredValue: '0' }, { userEnteredValue: '1000' }],
    },
    inputMessage: 'Whole items only',
    strict: true,
  }

  cells.E19 = { validation: roleValidation }
  cells.G19 = { validation: quantityValidation }

  for (let row = 7; row <= 24; row += 1) {
    if (row === 19) {
      continue
    }

    const role = row <= 18
      ? ROLES[(row - 7) % ROLES.length] as string
      : 'Tester'
    const hours = row <= 18
      ? HOURS[(row - 7) % ROLES.length] as number
      : 5

    cells[`A${row}`] = {
      text: row <= 18 ? `Item ${row - 6}` : `Extra ${row - 19}`,
    }
    cells[`E${row}`] = { text: role, validation: roleValidation }
    cells[`F${row}`] = {
      formula: lookupFormula(row),
      shown: `${hours}.0 h`,
      format: HOURS_FORMAT,
    }
    cells[`G${row}`] = {
      number: row <= 18 ? 2 : 1,
      validation: quantityValidation,
    }
    cells[`H${row}`] = {
      formula: `F${row}*G${row}`,
      shown: '0.00',
      format: MONEY_FORMAT,
    }
  }

  cells.A19 = { text: 'Subtotal' }
  cells.H19 = {
    formula: 'SUM(OFFSET(H19,-12,0,12,1))',
    shown: '0.00',
    format: MONEY_FORMAT,
  }
  cells.A25 = { text: 'Total' }
  cells.H25 = {
    formula: 'H19+SUM(H20:H24)',
    shown: '0.00',
    format: MONEY_FORMAT,
  }

  return cells
}

function summaryCells(): CellMap {
  const cells: CellMap = {
    A2: { text: 'Role' },
    B2: { text: 'Hours' },
    A9: { text: 'Lead lines' },
    B9: { formula: 'COUNTIFS(Lines!$E:$E,"Lead")', shown: '3' },
    A10: { text: 'Tax on extras' },
    B10: {
      formula: '\'Extra\'\'s tab\'!B2*TaxRate',
      shown: '4.00',
      format: MONEY_FORMAT,
    },
    D3: { formula: 'ARRAYFORMULA(Parameters!B7:B8)', shown: 'Lead' },
    D4: { text: 'Designer' },
  }

  ROLES.forEach((role, index) => {
    const row = 3 + index

    cells[`A${row}`] = { text: role }
    cells[`B${row}`] = {
      formula: `SUMIFS(Lines!$H$7:$H$24,Lines!$E$7:$E$24,A${row})`,
      shown: '10.00',
      format: MONEY_FORMAT,
    }
  })

  return cells
}

function sheetEntry(
  sheetId: number,
  title: string,
  extra: Record<string, unknown> = {},
  properties: Record<string, unknown> = {},
  grid: Record<string, unknown> = {},
) {
  return {
    properties: {
      sheetId,
      title,
      index: 0,
      sheetType: 'GRID',
      gridProperties: { rowCount: 1000, columnCount: 26, ...grid },
      ...properties,
    },
    ...extra,
  }
}

/**
 * The spreadsheet metadata answer (request 1) of the estimate workbook:
 * invented content that matches `estimateWorkbook()` in
 * `tests/fixtures/documents/extract/workbook-builders.ts` cell for cell, so
 * the two readers can be compared on the same workbook.
 */
export function estimateMetadata() {
  const { lists, parameters, lines, extra, summary } = SHEET_IDS

  return {
    spreadsheetId: SPREADSHEET_ID,
    namedRanges: [{
      namedRangeId: 'nr1',
      name: 'TaxRate',
      range: range(parameters, 2, 3, 2, 3),
    }],
    sheets: [
      sheetEntry(lists, 'Lists', {}, { hidden: true }),
      sheetEntry(parameters, 'Parameters'),
      sheetEntry(lines, 'Lines', {
        merges: [range(lines, 0, 1, 0, 8)],
        conditionalFormats: [
          {
            ranges: [range(lines, 6, 24, 0, 8)],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [{ userEnteredValue: '=$E7="Lead"' }],
              },
            },
          },
          {
            ranges: [range(lines, 6, 24, 7, 8)],
            booleanRule: {
              condition: {
                type: 'NUMBER_GREATER',
                values: [{ userEnteredValue: '100' }],
              },
            },
          },
          {
            ranges: [range(lines, 6, 24, 7, 8)],
            gradientRule: { minpoint: { type: 'MIN' } },
          },
        ],
        protectedRanges: [],
      }, {}, { frozenRowCount: 6, frozenColumnCount: 2 }),
      sheetEntry(extra, 'Extra\'s tab'),
      sheetEntry(summary, 'Summary', { charts: [{ chartId: 1 }] }),
    ],
  }
}

export function estimateGridAnswers(): Record<number, object> {
  const { lists, parameters, lines, extra, summary } = SHEET_IDS

  return {
    [lists]: gridAnswer(lists, 'Lists', listsCells()),
    [parameters]: gridAnswer(parameters, 'Parameters', parameterCells()),
    [lines]: gridAnswer(lines, 'Lines', lineCells()),
    [extra]: gridAnswer(extra, 'Extra\'s tab', {
      A2: { text: 'Extras' },
      B2: { number: 20 },
    }),
    [summary]: gridAnswer(summary, 'Summary', summaryCells()),
  }
}
