export type SheetVisibility = 'visible' | 'hidden' | 'very-hidden'

export type WorkbookFormulaKind
  = | 'normal'
    | 'array'
    | 'data-table'
    | 'shared'
    | 'shared-copy'

export interface WorkbookDataTableInputs {
  rowInput?: string
  columnInput?: string
}

/**
 * One cell. A `shared` cell copies the shared formula whose master is at
 * `sharedFrom` (its own text is that formula shifted by the distance, and is
 * not stored); a `shared-copy` cell copies one that cannot be shifted or
 * whose master is unknown. An `array` or `data-table` cell is the first cell
 * of `arrayRange`.
 */
export interface WorkbookCell {
  row: number
  column: number
  value?: string
  formula?: string
  formulaKind?: WorkbookFormulaKind
  arrayRange?: string
  sharedFrom?: string
  dataTable?: WorkbookDataTableInputs
  numberFormat?: string
}

export interface WorkbookNote {
  address: string
  text: string
}

export type ValidationKind
  = | 'list-from-range'
    | 'list-of-values'
    | 'whole-number'
    | 'decimal'
    | 'date'
    | 'time'
    | 'text-length'
    | 'custom'
    | 'any'

export type ComparisonOperator
  = | 'between'
    | 'not-between'
    | 'equal'
    | 'not-equal'
    | 'greater-than'
    | 'less-than'
    | 'greater-than-or-equal'
    | 'less-than-or-equal'

export interface WorkbookValidationRule {
  ranges: string[]
  kind: ValidationKind
  operator?: ComparisonOperator
  source?: string
  values?: string[]
  formulas?: string[]
  strict: boolean
  allowBlank?: boolean
  inputTitle?: string
  inputMessage?: string
  errorMessage?: string
}

export type ConditionalKind
  = | 'formula'
    | 'cell-value'
    | 'text-contains'
    | 'text-not-contains'
    | 'text-begins-with'
    | 'text-ends-with'
    | 'blanks'
    | 'no-blanks'
    | 'errors'
    | 'no-errors'
    | 'duplicates'
    | 'unique'
    | 'top'
    | 'bottom'
    | 'above-average'
    | 'below-average'
    | 'date-period'
    | 'other'

export interface WorkbookConditionalRule {
  ranges: string[]
  kind: ConditionalKind
  operator?: ComparisonOperator
  formulas?: string[]
  text?: string
  rank?: number
  percent?: boolean
  period?: string
  stopIfTrue?: boolean
}

export interface SheetNotRead {
  charts: number
  images: number
  pivotTables: number
  colorScales: number
  dataBars: number
  iconSets: number
  hyperlinks: number
  threadedComments: number
}

export type SheetCut
  = | 'rows'
    | 'columns'
    | 'cells'
    | 'formulas'
    | 'structure'
    | 'limits'
    | 'part'

export interface WorkbookSheet {
  name: string
  visibility: SheetVisibility
  usedRange?: string
  frozenRows: number
  frozenColumns: number
  mergedRanges: string[]
  cells: WorkbookCell[]
  validations: WorkbookValidationRule[]
  conditionalRules: WorkbookConditionalRule[]
  notes: WorkbookNote[]
  notRead: SheetNotRead
  cuts: SheetCut[]
  rowsRead?: number
}

export interface WorkbookName {
  name: string
  refersTo: string
  sheet?: string
}

export interface WorkbookModel {
  names: WorkbookName[]
  sheets: WorkbookSheet[]
  sheetsTotal: number
  hiddenNamesSkipped?: number
  namesNotRead?: number
}

export interface WorkbookMapOptions {
  maxBytes: number
  formulaPatternsMax: number
  formulaCellsMax: number
  formulaPrintCharactersMax: number
  exceptionsMax: number
  validationRulesMax: number
  conditionalGroupsMax: number
  literalVariantsMax: number
  numberFormatsMax: number
  rangesPerItemMax: number
  mergedRangesMax: number
  notesMax: number
  noteCharactersMax: number
  namesMax: number
  nameCharactersMax: number
  sheetNameCharactersMax: number
  messageCharactersMax: number
  cellCharactersMax: number
  columnsMax: number
}

export type WorkbookMapCut
  = | 'sheets'
    | 'values'
    | 'formula_patterns'
    | 'validations'
    | 'conditional_rules'
    | 'number_formats'
    | 'merged_cells'
    | 'notes'
    | 'names'
    | 'structure'
    | 'limits'
    | 'rows'
    | 'columns'
    | 'cells'
    | 'formulas'
    | 'part'

export interface WorkbookMapSheetSummary {
  name: string
  visibility: SheetVisibility
  valuesCutAfterRow?: number
  rowsNotShown?: number
}

export interface WorkbookMapSummary {
  sheets: number
  sheetsTotal: number
  hiddenSheets: number
  cells: number
  formulas: number
  patterns: number
  validations: number
  conditionalRules: number
  names: number
  bytes: number
  cut: WorkbookMapCut[]
  notRead: SheetNotRead
  sheetSummaries: WorkbookMapSheetSummary[]
}

export interface WorkbookMapResult {
  text: string
  summary: WorkbookMapSummary
}
