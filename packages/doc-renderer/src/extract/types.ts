import type { WorkbookMapSummary } from '../workbook-map/types.ts'

export type ExtractFormat = 'docx' | 'xlsx' | 'pptx'

export type ExtractStatus = 'ready' | 'empty' | 'too_large' | 'failed'

export type TruncationReason
  = | 'text_limit'
    | 'part_limit'
    | 'sheets_limit'
    | 'slides_limit'
    | 'rows_limit'
    | 'columns_limit'
    | 'cells_limit'
    | 'cell_chars_limit'
    | 'formulas_limit'
    | 'structure_limit'
    | 'map_limit'

export interface ExtractStats {
  inputBytes: number
  entries: number
  textBytes: number
  paragraphs?: number
  tables?: number
  sheets?: number
  sheetsTotal?: number
  slides?: number
  slidesTotal?: number
  truncations: TruncationReason[]
}

export interface ExtractResult {
  status: ExtractStatus
  text: string
  truncated: boolean
  stats: ExtractStats
  errorCode?: string
  workbookMap?: WorkbookMapSummary
}

export interface ExtractOptions {
  workbookMap?: boolean
}

export interface ExtractLimits {
  fileBytesMax: number
  textBytesMax: number
  zipEntriesMax: number
  zipTotalBytesMax: number
  zipEntryBytesMax: number
  zipRatioMax: number
  zipRatioMinBytes: number
  partBytesMax: number
  sheetsMax: number
  rowsMax: number
  columnsMax: number
  cellCharsMax: number
  cellsMax: number
  slidesMax: number
  inflatedBytesMax: number
  eventsMax: number
  contentTypesBytesMax: number
  extraInflatedBytesMax: number
  extraEventsMax: number
  tailBytesMax: number
}

export const EXTRACT_FORMATS: readonly ExtractFormat[] = [
  'docx',
  'xlsx',
  'pptx',
]

export const EXTRACT_VERSION = 1

export const WORKBOOK_MAP_EXTRACT_VERSION = 2

export const EXTRACT_VERSIONS: readonly number[] = [
  EXTRACT_VERSION,
  WORKBOOK_MAP_EXTRACT_VERSION,
]

export const EXTRACT_LIMITS: ExtractLimits = {
  fileBytesMax: 30 * 1024 * 1024,
  textBytesMax: 1024 * 1024,
  zipEntriesMax: 5000,
  zipTotalBytesMax: 150 * 1024 * 1024,
  zipEntryBytesMax: 50 * 1024 * 1024,
  zipRatioMax: 1000,
  zipRatioMinBytes: 1024 * 1024,
  partBytesMax: 16 * 1024 * 1024,
  sheetsMax: 50,
  rowsMax: 1000,
  columnsMax: 200,
  cellCharsMax: 2000,
  cellsMax: 200_000,
  slidesMax: 500,
  inflatedBytesMax: 64 * 1024 * 1024,
  eventsMax: 10_000_000,
  contentTypesBytesMax: 1024 * 1024,
  extraInflatedBytesMax: 160 * 1024 * 1024,
  extraEventsMax: 3_000_000,
  tailBytesMax: 4 * 1024 * 1024,
}

export const TRUNCATION_MARKER
  = '[Truncated: the text limit was reached and the rest is not included.]'
