export const VALIDATION_LIMITS = {
  fileBytesMax: 20 * 1024 * 1024,
  zipEntriesMax: 1000,
  zipEntryBytesMax: 50 * 1024 * 1024,
  zipTotalBytesMax: 100 * 1024 * 1024,
  zipRatioMax: 100,
  zipRatioMinBytes: 100 * 1024,
  inflateSliceBytes: 4096,
  pdfPagesMax: 200,
  pdfEofWindowBytes: 1024,
  pdfTokensMax: 5_000_000,
  pdfInflateBytesMax: 50 * 1024 * 1024,
  xmpBytesMax: 1024 * 1024,
  customPropertiesBytesMax: 64 * 1024,
  modelIdLengthMax: 200,
} as const

export const ALLOWED_LINK_PROTOCOLS = ['https:', 'mailto:'] as const

export const PDF_DENIED_NAMES: Readonly<Record<string, string>> = {
  JavaScript: 'pdf_javascript',
  JS: 'pdf_javascript',
  Launch: 'pdf_launch',
  EmbeddedFile: 'pdf_embedded_file',
  EmbeddedFiles: 'pdf_embedded_file',
  RichMedia: 'pdf_rich_media',
  XFA: 'pdf_xfa',
  SubmitForm: 'pdf_submit_form',
  ImportData: 'pdf_import_data',
  GoToR: 'pdf_goto_remote',
  GoToE: 'pdf_goto_remote',
  OpenAction: 'pdf_open_action',
  AA: 'pdf_additional_actions',
  Encrypt: 'pdf_encrypted',
}

export const OOXML_DENIED_PART_PATTERNS: ReadonlyArray<{
  pattern: RegExp
  code: string
}> = [
  { pattern: /(^|\/)vbaProject\.bin$/i, code: 'ooxml_macro' },
  { pattern: /(^|\/)vbaData\.xml$/i, code: 'ooxml_macro' },
  { pattern: /(^|\/)vbaProjectSignature\.bin$/i, code: 'ooxml_macro' },
  { pattern: /^xl\/(macrosheets|dialogsheets)\//i, code: 'ooxml_macro' },
  { pattern: /(^|\/)activeX\//i, code: 'ooxml_active_x' },
  { pattern: /(^|\/)embeddings\//i, code: 'ooxml_embedding' },
  { pattern: /(^|\/)customUI\//i, code: 'ooxml_custom_ui' },
  { pattern: /^xl\/externalLinks\//i, code: 'ooxml_external_link' },
  { pattern: /^xl\/connections\.xml$/i, code: 'ooxml_data_connection' },
  { pattern: /(^|\/)queryTables\//i, code: 'ooxml_data_connection' },
  { pattern: /\.bin$/i, code: 'ooxml_ole_object' },
]

export const OOXML_DENIED_RELATIONSHIP_TYPES: ReadonlyArray<{
  pattern: RegExp
  code: string
}> = [
  { pattern: /\/attachedTemplate$/i, code: 'ooxml_attached_template' },
  { pattern: /\/aFChunk$/i, code: 'ooxml_alt_chunk' },
  { pattern: /\/oleObject$/i, code: 'ooxml_ole_object' },
  { pattern: /\/package$/i, code: 'ooxml_embedding' },
  { pattern: /\/vbaProject$/i, code: 'ooxml_macro' },
  { pattern: /\/externalLink(Path)?$/i, code: 'ooxml_external_link' },
  { pattern: /\/control$/i, code: 'ooxml_active_x' },
  { pattern: /\/connections$/i, code: 'ooxml_data_connection' },
  { pattern: /\/queryTable$/i, code: 'ooxml_data_connection' },
  { pattern: /\/ui\/extensibility$/i, code: 'ooxml_custom_ui' },
]

export const HYPERLINK_RELATIONSHIP_TYPE_SUFFIX = '/relationships/hyperlink'

export const DOCX_DENIED_FIELDS: readonly string[] = [
  'DDE',
  'DDEAUTO',
  'INCLUDETEXT',
  'INCLUDEPICTURE',
  'LINK',
  'IMPORT',
  'DATABASE',
]

export const PPTX_ALLOWED_ACTIONS: readonly string[] = [
  'ppaction://hlinksldjump',
  'ppaction://hlinkshowjump',
]

export const XLSX_FORMULA_FUNCTION_ALLOWLIST: ReadonlySet<string> = new Set([
  'SUM',
  'AVERAGE',
  'MIN',
  'MAX',
  'COUNT',
  'COUNTA',
  'COUNTIF',
  'COUNTIFS',
  'SUMIF',
  'SUMIFS',
  'AVERAGEIF',
  'IF',
  'IFS',
  'IFERROR',
  'AND',
  'OR',
  'NOT',
  'ROUND',
  'ROUNDUP',
  'ROUNDDOWN',
  'ABS',
  'INT',
  'MOD',
  'POWER',
  'SQRT',
  'VLOOKUP',
  'HLOOKUP',
  'XLOOKUP',
  'INDEX',
  'MATCH',
  'CONCAT',
  'CONCATENATE',
  'TEXT',
  'LEFT',
  'RIGHT',
  'MID',
  'LEN',
  'TRIM',
  'UPPER',
  'LOWER',
  'TODAY',
  'NOW',
  'DATE',
  'YEAR',
  'MONTH',
  'DAY',
  'EDATE',
  'EOMONTH',
  'NETWORKDAYS',
  'PMT',
  'NPV',
  'IRR',
])

export const XLSX_FUTURE_FUNCTIONS: ReadonlySet<string> = new Set([
  'IFS',
  'XLOOKUP',
  'CONCAT',
])

export const XLFN_PREFIX = '_xlfn.'
