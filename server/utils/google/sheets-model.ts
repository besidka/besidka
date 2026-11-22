import {
  cellAddress,
  cellsToRanges,
  collapseFormulas,
  expandPattern,
  rangeAddress,
} from '@besidka/doc-renderer/workbook-map'
import type {
  CellPosition,
  SheetCut,
  SheetNotRead,
  SheetVisibility,
  WorkbookCell,
  WorkbookConditionalRule,
  WorkbookModel,
  WorkbookName,
  WorkbookNote,
  WorkbookSheet,
  WorkbookValidationRule,
} from '@besidka/doc-renderer/workbook-map'
import {
  GOOGLE_SHEETS_SHEETS_MAX,
} from '#shared/utils/google-sheets'
import {
  asArray,
  asIndex,
  asRecord,
  asString,
  conditionalFields,
  parseCondition,
  stripEquals,
  validationFields,
} from '~~/server/utils/google/sheets-conditions'
import type { ParsedCondition } from '~~/server/utils/google/sheets-conditions'
import {
  gridRangeToA1,
  namedRangeToA1,
} from '~~/server/utils/google/sheets-grid'
import type {
  SheetsGridBounds,
  SheetsGridRange,
} from '~~/server/utils/google/sheets-grid'

const MERGED_RANGES_MAX = 5000
const CONDITIONAL_RULES_MAX = 5000
const NAMES_MAX = 500
const NOTES_MAX = 500
const COUNT_MAX = 9999
const VALIDATION_EXCEPTIONS_MAX = 20
const GENERAL_FORMAT = 'general'

export interface SheetsSheetInfo extends SheetsGridBounds {
  sheetId: number
  title: string
  kind: 'grid' | 'object' | 'other'
  visibility: SheetVisibility
  frozenRows: number
  frozenColumns: number
  mergedRanges: string[]
  conditionalRules: WorkbookConditionalRule[]
  notRead: SheetNotRead
}

export interface SheetsMetadata {
  sheets: SheetsSheetInfo[]
  names: WorkbookName[]
  namesNotRead: number
}

export interface ParsedSheetGrid {
  cells: WorkbookCell[]
  validations: WorkbookValidationRule[]
  notes: WorkbookNote[]
  hyperlinks: number
  pivotTables: number
}

export type SheetGridRead
  = | {
    status: 'read'
    grid: ParsedSheetGrid
    rowsRead: number
    cuts: SheetCut[]
  }
  | { status: 'not_read' }

export function emptyNotRead(): SheetNotRead {
  return {
    charts: 0,
    images: 0,
    pivotTables: 0,
    colorScales: 0,
    dataBars: 0,
    iconSets: 0,
    hyperlinks: 0,
  }
}

function countOf(value: unknown): number {
  return Math.min(asArray(value).length, COUNT_MAX)
}

function toGridRange(value: unknown): SheetsGridRange | null {
  const record = asRecord(value)

  if (!record) {
    return null
  }

  return {
    sheetId: asIndex(record.sheetId),
    startRowIndex: asIndex(record.startRowIndex),
    endRowIndex: asIndex(record.endRowIndex),
    startColumnIndex: asIndex(record.startColumnIndex),
    endColumnIndex: asIndex(record.endColumnIndex),
  }
}

function rangesToA1(
  value: unknown,
  bounds: SheetsGridBounds | null,
): string[] {
  const ranges: string[] = []

  for (const item of asArray(value)) {
    const range = toGridRange(item)
    const text = range ? gridRangeToA1(range, { bounds }) : null

    if (text !== null) {
      ranges.push(text)
    }
  }

  return ranges
}

function toVisibility(properties: Record<string, unknown>): SheetVisibility {
  return properties.hidden === true ? 'hidden' : 'visible'
}

function toKind(properties: Record<string, unknown>): SheetsSheetInfo['kind'] {
  const type = asString(properties.sheetType)

  if (type === undefined || type === 'GRID') {
    return 'grid'
  }

  return type === 'OBJECT' ? 'object' : 'other'
}

function parseConditionalRules(
  value: unknown,
  bounds: SheetsGridBounds | null,
  notRead: SheetNotRead,
): WorkbookConditionalRule[] {
  const rules: WorkbookConditionalRule[] = []

  for (const item of asArray(value).slice(0, CONDITIONAL_RULES_MAX)) {
    const format = asRecord(item)

    if (!format) {
      continue
    }

    if (asRecord(format.gradientRule)) {
      notRead.colorScales = Math.min(notRead.colorScales + 1, COUNT_MAX)
      continue
    }

    const condition = parseCondition(
      asRecord(format.booleanRule)?.condition,
    )
    const ranges = rangesToA1(format.ranges, bounds)

    if (!condition || ranges.length === 0) {
      continue
    }

    rules.push({
      ranges,
      priority: rules.length + 1,
      ...conditionalFields(condition),
    })
  }

  return rules
}

function parseSheetInfo(value: unknown): SheetsSheetInfo | null {
  const sheet = asRecord(value)
  const properties = asRecord(sheet?.properties)

  if (!sheet || !properties) {
    return null
  }

  const grid = asRecord(properties.gridProperties)
  const bounds: SheetsGridBounds = {
    rowCount: asIndex(grid?.rowCount) ?? 0,
    columnCount: asIndex(grid?.columnCount) ?? 0,
  }
  const notRead = emptyNotRead()
  const protectedRanges = countOf(sheet.protectedRanges)

  notRead.charts = countOf(sheet.charts)

  if (protectedRanges > 0) {
    notRead.protectedRanges = protectedRanges
  }

  const knownBounds = bounds.rowCount > 0 && bounds.columnCount > 0
    ? bounds
    : null

  return {
    sheetId: asIndex(properties.sheetId) ?? 0,
    title: asString(properties.title) ?? '',
    kind: toKind(properties),
    visibility: toVisibility(properties),
    ...bounds,
    frozenRows: asIndex(grid?.frozenRowCount) ?? 0,
    frozenColumns: asIndex(grid?.frozenColumnCount) ?? 0,
    mergedRanges: rangesToA1(sheet.merges, knownBounds)
      .slice(0, MERGED_RANGES_MAX),
    conditionalRules: parseConditionalRules(
      sheet.conditionalFormats,
      knownBounds,
      notRead,
    ),
    notRead,
  }
}

/**
 * The structure of a workbook from the metadata request: every sheet in
 * tab order with its properties, merged ranges, conditional rules and the
 * counts of what is not read (charts, protected ranges, gradient rules),
 * and the named ranges written as `Sheet!$A$1:$B$2`. Fields it does not
 * know are ignored; a body without sheets is null.
 */
export function parseSheetsMetadata(
  body: Record<string, unknown>,
): SheetsMetadata | null {
  const sheets = asArray(body.sheets)
    .map(parseSheetInfo)
    .filter((sheet): sheet is SheetsSheetInfo => sheet !== null)

  if (sheets.length === 0) {
    return null
  }

  const infoById = new Map(sheets.map(sheet => [sheet.sheetId, sheet]))
  const names: WorkbookName[] = []
  let namesNotRead = 0

  for (const item of asArray(body.namedRanges)) {
    const record = asRecord(item)
    const name = asString(record?.name)
    const range = toGridRange(record?.range)
    const refersTo = range
      ? namedRangeToA1(
        range,
        sheetId => infoById.get(sheetId)?.title,
        (sheetId) => {
          const info = infoById.get(sheetId)

          return info && info.rowCount > 0 ? info : undefined
        },
      )
      : null

    if (!name || refersTo === null) {
      namesNotRead += 1
      continue
    }

    if (names.length >= NAMES_MAX) {
      namesNotRead += 1
      continue
    }

    names.push({ name, refersTo })
  }

  return { sheets, names, namesNotRead }
}

function enteredText(entered: Record<string, unknown> | null) {
  if (!entered) {
    return undefined
  }

  const text = asString(entered.stringValue)

  if (text !== undefined) {
    return text
  }

  if (typeof entered.numberValue === 'number') {
    return String(entered.numberValue)
  }

  if (typeof entered.boolValue === 'boolean') {
    return entered.boolValue ? 'TRUE' : 'FALSE'
  }

  return asString(entered.errorValue)
}

function numberFormatOf(cell: Record<string, unknown>): string | undefined {
  const format = asRecord(asRecord(cell.userEnteredFormat)?.numberFormat)
  const pattern = asString(format?.pattern)

  if (!pattern || pattern.toLowerCase() === GENERAL_FORMAT) {
    return undefined
  }

  return pattern
}

interface ValidationEntry extends CellPosition {
  rule: Omit<WorkbookValidationRule, 'ranges'>
}

function parseValidation(
  value: unknown,
): Omit<WorkbookValidationRule, 'ranges'> | null {
  const validation = asRecord(value)
  const condition: ParsedCondition | null = parseCondition(
    validation?.condition,
  )

  if (!validation || !condition) {
    return null
  }

  const message = asString(validation.inputMessage)

  return {
    ...validationFields(condition),
    strict: validation.strict === true,
    ...(message ? { inputMessage: message } : {}),
  }
}

function findSheetBody(
  body: Record<string, unknown>,
  sheetId: number,
): Record<string, unknown> | null {
  const sheets = asArray(body.sheets)
    .map(asRecord)
    .filter((sheet): sheet is Record<string, unknown> => sheet !== null)
  const matching = sheets.find((sheet) => {
    return (asIndex(asRecord(sheet.properties)?.sheetId) ?? 0) === sheetId
  })

  if (matching) {
    return matching
  }

  return sheets.length === 1 ? sheets[0] as Record<string, unknown> : null
}

export interface SheetGridLimits {
  rows: number
  columns: number
}

/**
 * The cells of one sheet from its cell-data request: the displayed value
 * (`formattedValue`), the formula without its `=` (`userEnteredValue
 * .formulaValue`), the number format pattern, notes, links and pivot
 * tables as counts, and every cell's validation rule grouped into ranges.
 * `data[].startRow` and `startColumn` are added to the indexes (Google omits
 * them at zero), rows and cells past the limits are ignored, and an empty
 * cell that carries only a rule still counts for that rule. Null when the
 * answer holds no data for the sheet.
 */
export function parseSheetGrid(
  body: Record<string, unknown>,
  sheetId: number,
  limits: SheetGridLimits,
): ParsedSheetGrid | null {
  const sheet = findSheetBody(body, sheetId)

  if (!sheet) {
    return null
  }

  const cells: WorkbookCell[] = []
  const notes: WorkbookNote[] = []
  const validations: ValidationEntry[] = []
  let hyperlinks = 0
  let pivotTables = 0

  for (const block of asArray(sheet.data)) {
    const data = asRecord(block)
    const startRow = asIndex(data?.startRow) ?? 0
    const startColumn = asIndex(data?.startColumn) ?? 0

    asArray(data?.rowData).forEach((rowItem, rowIndex) => {
      const row = startRow + rowIndex + 1

      if (row > limits.rows) {
        return
      }

      asArray(asRecord(rowItem)?.values).forEach((cellItem, columnIndex) => {
        const column = startColumn + columnIndex + 1
        const cell = asRecord(cellItem)

        if (!cell || column > limits.columns) {
          return
        }

        const entered = asRecord(cell.userEnteredValue)
        const formulaValue = asString(entered?.formulaValue)
        const formatted = asString(cell.formattedValue)
        const value = formatted ?? (formulaValue === undefined
          ? enteredText(entered)
          : undefined)
        const hasValue = value !== undefined && value !== ''

        if (formulaValue !== undefined || hasValue) {
          const numberFormat = numberFormatOf(cell)

          cells.push({
            row,
            column,
            ...(hasValue ? { value } : {}),
            ...(formulaValue === undefined
              ? {}
              : { formula: stripEquals(formulaValue) }),
            ...(numberFormat ? { numberFormat } : {}),
          })
        }

        const note = asString(cell.note)

        if (note && notes.length < NOTES_MAX) {
          notes.push({ address: cellAddress(row, column), text: note })
        }

        if (asString(cell.hyperlink)) {
          hyperlinks = Math.min(hyperlinks + 1, COUNT_MAX)
        }

        if (asRecord(cell.pivotTable)) {
          pivotTables = Math.min(pivotTables + 1, COUNT_MAX)
        }

        const rule = parseValidation(cell.dataValidation)

        if (rule) {
          validations.push({ row, column, rule })
        }
      })
    })
  }

  return {
    cells,
    notes,
    validations: groupValidations(validations),
    hyperlinks,
    pivotTables,
  }
}

function exactKey(rule: Omit<WorkbookValidationRule, 'ranges'>): string {
  return JSON.stringify(rule)
}

function baseKey(rule: Omit<WorkbookValidationRule, 'ranges'>): string {
  return JSON.stringify({ ...rule, formulas: rule.formulas?.slice(1) })
}

function toRanges(cells: readonly CellPosition[]): string[] {
  return cellsToRanges(cells).map(rangeAddress)
}

/**
 * Validation rules from per-cell rules. Cells with the same rule share a
 * rule over the rectangles that cover them. Sheets may write a formula
 * rule relative to each cell, so cells that are alone in their group are
 * also tried as a fill: when one formula, shifted by the distance between
 * cells, is the next one's, they become one rule written for the first
 * cell of its range, like a conditional rule.
 */
function groupValidations(
  entries: readonly ValidationEntry[],
): WorkbookValidationRule[] {
  const exact = new Map<string, {
    rule: Omit<WorkbookValidationRule, 'ranges'>
    cells: CellPosition[]
  }>()

  for (const { rule, ...position } of entries) {
    const key = exactKey(rule)
    const group = exact.get(key)

    if (group) {
      group.cells.push(position)
    } else {
      exact.set(key, { rule, cells: [position] })
    }
  }

  const rules: WorkbookValidationRule[] = []
  const alone = new Map<string, Array<{
    rule: Omit<WorkbookValidationRule, 'ranges'>
    cell: CellPosition
  }>>()

  for (const { rule, cells } of exact.values()) {
    const isRelativeCandidate = cells.length === 1
      && (rule.formulas?.length ?? 0) > 0

    if (!isRelativeCandidate) {
      rules.push({ ...rule, ranges: toRanges(cells) })
      continue
    }

    const key = baseKey(rule)
    const group = alone.get(key)
    const item = { rule, cell: cells[0] as CellPosition }

    if (group) {
      group.push(item)
    } else {
      alone.set(key, [item])
    }
  }

  for (const group of alone.values()) {
    rules.push(...collapseRelativeRules(group))
  }

  return rules
}

function collapseRelativeRules(group: ReadonlyArray<{
  rule: Omit<WorkbookValidationRule, 'ranges'>
  cell: CellPosition
}>): WorkbookValidationRule[] {
  const first = group[0]

  if (!first) {
    return []
  }

  const known = new Set(group.map(({ cell }) => {
    return `${cell.row}:${cell.column}`
  }))
  const patterns = collapseFormulas(
    group.map(({ cell, rule }) => ({
      row: cell.row,
      column: cell.column,
      formula: (rule.formulas as string[])[0] as string,
    })),
    VALIDATION_EXCEPTIONS_MAX,
  )
  const rules: WorkbookValidationRule[] = []
  const covered = new Set<string>()

  for (const pattern of patterns) {
    const cells = expandPattern(pattern).filter((cell) => {
      return known.has(`${cell.row}:${cell.column}`)
    })

    for (const cell of cells) {
      covered.add(`${cell.row}:${cell.column}`)
    }

    if (cells.length === 0) {
      continue
    }

    rules.push({
      ...first.rule,
      formulas: [pattern.formula, ...(first.rule.formulas?.slice(1) ?? [])],
      ranges: toRanges(cells),
    })
  }

  for (const { rule, cell } of group) {
    if (!covered.has(`${cell.row}:${cell.column}`)) {
      rules.push({ ...rule, ranges: toRanges([cell]) })
    }
  }

  return rules
}

function usedRangeOf(cells: readonly WorkbookCell[]): string | undefined {
  if (cells.length === 0) {
    return undefined
  }

  let top = Number.POSITIVE_INFINITY
  let left = Number.POSITIVE_INFINITY
  let bottom = 0
  let right = 0

  for (const cell of cells) {
    top = Math.min(top, cell.row)
    left = Math.min(left, cell.column)
    bottom = Math.max(bottom, cell.row)
    right = Math.max(right, cell.column)
  }

  return rangeAddress({ top, left, bottom, right })
}

export interface WorkbookModelInput {
  metadata: SheetsMetadata
  reads: ReadonlyMap<number, SheetGridRead>
}

function toModelSheet(
  info: SheetsSheetInfo,
  read: SheetGridRead | undefined,
): WorkbookSheet {
  const notRead: SheetNotRead = { ...info.notRead }

  if (info.kind !== 'grid' || !read || read.status === 'not_read') {
    return {
      name: info.title,
      visibility: info.visibility,
      frozenRows: info.frozenRows,
      frozenColumns: info.frozenColumns,
      mergedRanges: info.mergedRanges,
      cells: [],
      validations: [],
      conditionalRules: info.conditionalRules,
      notes: [],
      notRead,
      cuts: info.kind === 'grid' ? ['not_read'] : [],
    }
  }

  const { grid } = read

  notRead.hyperlinks = grid.hyperlinks
  notRead.pivotTables = grid.pivotTables

  return {
    name: info.title,
    visibility: info.visibility,
    usedRange: usedRangeOf(grid.cells),
    frozenRows: info.frozenRows,
    frozenColumns: info.frozenColumns,
    mergedRanges: info.mergedRanges,
    cells: grid.cells,
    validations: grid.validations,
    conditionalRules: info.conditionalRules,
    notes: grid.notes,
    notRead,
    cuts: read.cuts,
    ...(read.cuts.includes('rows') ? { rowsRead: read.rowsRead } : {}),
  }
}

/**
 * The workbook model for the map renderer: the first
 * `GOOGLE_SHEETS_SHEETS_MAX` sheets in tab order, each with the structure
 * from the metadata and the cells of its own read (a sheet whose cells were
 * not read keeps its structure and says so), the named ranges, and the
 * total sheet count so the map notes the sheets left out.
 */
export function buildWorkbookModel(input: WorkbookModelInput): WorkbookModel {
  const { metadata, reads } = input

  return {
    names: metadata.names,
    sheets: metadata.sheets.slice(0, GOOGLE_SHEETS_SHEETS_MAX).map((info) => {
      return toModelSheet(info, reads.get(info.sheetId))
    }),
    sheetsTotal: metadata.sheets.length,
    ...(metadata.namesNotRead > 0
      ? { namesNotRead: metadata.namesNotRead }
      : {}),
  }
}
