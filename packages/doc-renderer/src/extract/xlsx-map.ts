import { renderWorkbookMap } from '../workbook-map/render.ts'
import type {
  SheetCut,
  WorkbookCell,
  WorkbookMapCut,
  WorkbookModel,
  WorkbookName,
  WorkbookSheet,
} from '../workbook-map/types.ts'
import {
  TextSink,
  addTruncation,
  findEntry,
  utf8Length,
} from './common.ts'
import type { ExtractionOutput, OfficePackage } from './common.ts'
import { TRUNCATION_MARKER } from './types.ts'
import type { ExtractStats, TruncationReason } from './types.ts'
import {
  SharedStrings,
  readCellFormats,
  readSheet,
  readWorkbook,
} from './xlsx.ts'
import type { SheetCollector, SheetData } from './xlsx.ts'
import { emptyNotRead, readSheetStructure } from './xlsx-structure.ts'

const FORMULA_STORED_CHARACTERS_MAX = 8 * 1024 * 1024

const CUT_REASONS: Record<WorkbookMapCut, TruncationReason> = {
  sheets: 'sheets_limit',
  values: 'text_limit',
  structure: 'text_limit',
  limits: 'map_limit',
  rows: 'rows_limit',
  columns: 'columns_limit',
  cells: 'cells_limit',
  part: 'part_limit',
  formulas: 'formulas_limit',
  formula_patterns: 'map_limit',
  validations: 'map_limit',
  conditional_rules: 'map_limit',
  number_formats: 'map_limit',
  merged_cells: 'map_limit',
  notes: 'map_limit',
  names: 'map_limit',
}

/**
 * Moves the cells of each row into the model and drops the row's raw cells
 * right away, so the raw and the model copy of a large sheet are never both
 * alive in full.
 */
function toWorkbookCells(
  data: SheetData,
  shared: SharedStrings,
): WorkbookCell[] {
  const cells: WorkbookCell[] = []

  for (const row of data.rows) {
    const rawCells = row.cells

    row.cells = []

    for (const raw of rawCells) {
      const value = raw.sharedIndex >= 0
        ? shared.resolve(raw.sharedIndex)
        : raw.text
      const cell: WorkbookCell = { row: row.number, column: raw.column + 1 }

      if (value.length > 0) {
        cell.value = value
      }

      if (raw.formula !== undefined) {
        cell.formula = raw.formula
      }

      if (raw.formulaKind) {
        cell.formulaKind = raw.formulaKind
      }

      if (raw.arrayRange) {
        cell.arrayRange = raw.arrayRange
      }

      if (raw.sharedFrom) {
        cell.sharedFrom = raw.sharedFrom
      }

      if (raw.dataTable) {
        cell.dataTable = raw.dataTable
      }

      if (raw.numberFormat) {
        cell.numberFormat = raw.numberFormat
      }

      cells.push(cell)
    }
  }

  return cells
}

function sheetCuts(
  data: SheetData,
  isCut: boolean,
  collector: SheetCollector,
  structure: { isTailCut: boolean, isLimited: boolean },
  stats: ExtractStats,
): SheetCut[] {
  const { isTailCut, isLimited } = structure
  const cuts: SheetCut[] = []

  if (data.hasMoreRows) {
    cuts.push('rows')
  }

  if (data.hasDroppedColumns) {
    cuts.push('columns')
  }

  if (data.hasCellLimit) {
    cuts.push('cells')
  } else if (isCut) {
    cuts.push('part')
  }

  if (collector.isFormulaLimit) {
    cuts.push('formulas')
  }

  if (isTailCut) {
    cuts.push('structure')
    addTruncation(stats, 'structure_limit')
  }

  if (isLimited) {
    cuts.push('limits')
  }

  if (data.hasTruncatedCells) {
    addTruncation(stats, 'cell_chars_limit')
  }

  return cuts
}

function skippedSheet(
  name: string,
  visibility: WorkbookSheet['visibility'],
): WorkbookSheet {
  return {
    name,
    visibility,
    frozenRows: 0,
    frozenColumns: 0,
    mergedRanges: [],
    cells: [],
    validations: [],
    conditionalRules: [],
    notes: [],
    notRead: emptyNotRead(),
    cuts: ['cells'],
  }
}

/**
 * Reads an XLSX into the workbook model and renders it as the workbook map
 * (extract version 2). The cells are read exactly as for the plain text, with
 * the same caps and budgets, plus formulas, number formats, frozen panes and
 * the used range from the same pass. The structure stored after the cells,
 * notes and the counts of charts, images and pivot tables come from
 * optional reads that have their own budget, so they never make a workbook
 * that the plain text could read fail.
 */
export function extractXlsxMap(officePackage: OfficePackage): ExtractionOutput {
  const { limits, stats } = officePackage
  const workbook = readWorkbook(officePackage)
  const { serialFormats, formatCodes } = readCellFormats(
    officePackage,
    workbook.stylesPart,
  )
  const shared = new SharedStrings(
    officePackage,
    findEntry(officePackage, workbook.sharedStringsPart),
  )
  const formulaCharacters = { used: 0, max: FORMULA_STORED_CHARACTERS_MAX }
  const sheetsIncluded = Math.min(workbook.sheets.length, limits.sheetsMax)
  const sheets: WorkbookSheet[] = []
  let cellsUsed = 0
  let hasContent = false

  stats.sheetsTotal = workbook.sheets.length

  for (const sheet of workbook.sheets.slice(0, sheetsIncluded)) {
    const entry = findEntry(officePackage, sheet.partName)

    if (!entry) {
      continue
    }

    if (cellsUsed >= limits.cellsMax) {
      sheets.push(skippedSheet(sheet.name, sheet.visibility))
      continue
    }

    const collector: SheetCollector = {
      formatCodes,
      formulaCharacters,
      frozenRows: 0,
      frozenColumns: 0,
      isFormulaLimit: false,
    }
    const { data, isCut } = readSheet(
      officePackage,
      entry,
      serialFormats,
      workbook.date1904,
      limits.cellsMax - cellsUsed,
      collector,
    )

    cellsUsed += data.cellCount
    shared.ensure(data.sharedIndexes)

    const cells = toWorkbookCells(data, shared)
    const structure = readSheetStructure(officePackage, entry, sheet.partName)

    hasContent = hasContent || cells.some((cell) => {
      return cell.value !== undefined
        || cell.formula !== undefined
        || cell.formulaKind !== undefined
    })
    sheets.push({
      name: sheet.name,
      visibility: sheet.visibility,
      usedRange: collector.usedRange,
      frozenRows: collector.frozenRows,
      frozenColumns: collector.frozenColumns,
      mergedRanges: structure.mergedRanges,
      cells,
      validations: structure.validations,
      conditionalRules: structure.conditionalRules,
      notes: structure.notes,
      notRead: structure.notRead,
      cuts: sheetCuts(data, isCut, collector, structure, stats),
      rowsRead: limits.rowsMax,
    })
  }

  const names: WorkbookName[] = workbook.names.map((name) => {
    const sheet = name.localSheetId === null
      ? undefined
      : workbook.declaredSheetNames[name.localSheetId]

    return sheet === undefined
      ? { name: name.name, refersTo: name.refersTo }
      : { name: name.name, refersTo: name.refersTo, sheet }
  })
  const model: WorkbookModel = {
    names,
    sheets,
    sheetsTotal: workbook.sheets.length,
    hiddenNamesSkipped: workbook.hiddenNamesSkipped,
    namesNotRead: workbook.namesNotRead,
  }
  const map = renderWorkbookMap(model, {
    maxBytes: limits.textBytesMax - utf8Length(TRUNCATION_MARKER) - 2,
    columnsMax: limits.columnsMax,
    cellCharactersMax: limits.cellCharsMax,
  })

  for (const cut of map.summary.cut) {
    addTruncation(stats, CUT_REASONS[cut])
  }

  const sink = new TextSink(limits.textBytesMax)

  sink.add(map.text)
  stats.sheets = sheets.length

  return { sink, hasContent, workbookMap: map.summary }
}
