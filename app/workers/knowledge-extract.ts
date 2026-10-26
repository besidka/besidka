import type {
  KnowledgeWorkerRequest,
  KnowledgeWorkerResponse,
  KnowledgeWorkerResult,
} from '~/types/knowledge-extract.d'
import {
  KNOWLEDGE_LIMITS,
  getKnowledgeFileCategory,
} from '#shared/utils/project-knowledge-policy'
import { sha256Hex } from '~/utils/knowledge-hash'
import { readZipSummary } from '~/utils/knowledge-zip'

interface KnowledgeWorkerScope {
  onmessage: ((event: MessageEvent<KnowledgeWorkerRequest>) => void) | null
  postMessage: (response: KnowledgeWorkerResponse) => void
}

interface ExtractionOutcome {
  extractor: KnowledgeWorkerResult['extractor']
  extractStatus: KnowledgeWorkerResult['extractStatus']
  extractError?: string | null
  text?: string
  html?: string
  pageCount?: number | null
}

const MIN_PDF_CHARS_PER_PAGE = 20
const MAX_SHEET_ROWS = 1000
const MAX_SHEET_COLUMNS = 200
const MAX_SHEET_CELL_CHARS = 2000
const MAX_XLSX_SHEETS = 50
const MAX_ZIP_ENTRIES = 5000
const MAX_ZIP_UNCOMPRESSED_BYTES = 150 * 1024 * 1024
const MAX_ZIP_ENTRY_BYTES = 50 * 1024 * 1024
const TRUNCATION_RESERVE_BYTES = 200
const SECTION_SEPARATOR_BYTES = 2
const TRUNCATION_NOTICE = '(output truncated at the size limit)'
const PDF_PASSWORD_EXCEPTION = 'PasswordException'
const PDF_INVALID_EXCEPTION = 'InvalidPDFException'

const failureCodes = {
  pdf: 'pdf-failed',
  docx: 'docx-failed',
  xlsx: 'xlsx-failed',
  generic: 'extract-failed',
} as const

function getFileExtension(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).at(-1) ?? ''
  const separatorIndex = baseName.lastIndexOf('.')

  if (separatorIndex < 0) {
    return ''
  }

  return baseName.slice(separatorIndex + 1).toLowerCase()
}

function createFailure(
  extractor: ExtractionOutcome['extractor'],
  extractError: string,
): ExtractionOutcome {
  return { extractor, extractStatus: 'failed', extractError }
}

function createNoText(
  extractor: ExtractionOutcome['extractor'],
  pageCount: number | null = null,
): ExtractionOutcome {
  return { extractor, extractStatus: 'no-text', pageCount }
}

function hasIteratorGlobal(): boolean {
  return typeof (globalThis as { Iterator?: unknown }).Iterator !== 'undefined'
}

function extractText(bytes: ArrayBuffer): ExtractionOutcome {
  if (bytes.byteLength > KNOWLEDGE_LIMITS.maxTextFileBytes) {
    return createFailure('text', 'too-large')
  }

  if (bytes.byteLength === 0) {
    return createNoText('text')
  }

  if (new Uint8Array(bytes).includes(0)) {
    return createFailure('text', 'binary')
  }

  let text: string

  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return createFailure('text', 'not-utf8')
  }

  if (text.trim().length === 0) {
    return createNoText('text')
  }

  return { extractor: 'text', extractStatus: 'ready', text }
}

function getExceptionName(exception: unknown): string {
  if (exception instanceof Error) {
    return exception.name
  }

  return ''
}

function mapPdfException(exception: unknown): string {
  const exceptionName = getExceptionName(exception)

  if (exceptionName === PDF_PASSWORD_EXCEPTION) {
    return 'password-protected'
  }

  if (exceptionName === PDF_INVALID_EXCEPTION) {
    return 'invalid-pdf'
  }

  return failureCodes.pdf
}

async function extractPdf(bytes: ArrayBuffer): Promise<ExtractionOutcome> {
  if (!hasIteratorGlobal()) {
    return createFailure('client-unpdf', 'ios-update-required')
  }

  const { getDocumentProxy, extractText: extractPdfText } = await import(
    'unpdf'
  )
  const pdf = await getDocumentProxy(new Uint8Array(bytes))

  try {
    if (pdf.numPages > KNOWLEDGE_LIMITS.maxPdfPages) {
      return createFailure('client-unpdf', 'too-many-pages')
    }

    const { totalPages, text } = await extractPdfText(pdf)
    const pageTexts = text.map(pageText => pageText.trim())
    const characterCount = pageTexts.reduce((sum, pageText) => {
      return sum + pageText.replace(/\s+/g, '').length
    }, 0)

    if (
      characterCount === 0
      || characterCount / totalPages < MIN_PDF_CHARS_PER_PAGE
    ) {
      return createNoText('client-unpdf', totalPages)
    }

    return {
      extractor: 'client-unpdf',
      extractStatus: 'ready',
      text: pageTexts.join('\n\n'),
      pageCount: totalPages,
    }
  } finally {
    await pdf.loadingTask.destroy()
  }
}

function inspectZipLimits(
  bytes: ArrayBuffer,
  extractor: ExtractionOutcome['extractor'],
  unreadableCode: string,
): ExtractionOutcome | null {
  const summary = readZipSummary(bytes)

  if (!summary) {
    return createFailure(extractor, unreadableCode)
  }

  if (
    summary.entries > MAX_ZIP_ENTRIES
    || summary.uncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES
    || summary.largestEntryBytes > MAX_ZIP_ENTRY_BYTES
  ) {
    return createFailure(extractor, 'too-large')
  }

  return null
}

async function extractDocx(bytes: ArrayBuffer): Promise<ExtractionOutcome> {
  const zipFailure = inspectZipLimits(
    bytes,
    'client-mammoth',
    failureCodes.docx,
  )

  if (zipFailure) {
    return zipFailure
  }

  const mammothModule = await import('mammoth')
  const mammoth = mammothModule.default ?? mammothModule
  const { value: html } = await mammoth.convertToHtml(
    { arrayBuffer: bytes },
    {
      convertImage: mammoth.images.imgElement(() => {
        return Promise.resolve({ src: '' })
      }),
    },
  )

  if (html.trim().length === 0) {
    return createNoText('client-mammoth')
  }

  return {
    extractor: 'client-mammoth',
    extractStatus: 'ready',
    html,
  }
}

function escapeTableCell(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  const text = value instanceof Date
    ? value.toISOString().replace('T00:00:00.000Z', '')
    : String(value)
  const boundedText = text.length > MAX_SHEET_CELL_CHARS
    ? `${text.slice(0, MAX_SHEET_CELL_CHARS)}…`
    : text

  return boundedText
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .trim()
}

function getUtf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function isBlankCell(cell: unknown): boolean {
  if (cell === null || cell === undefined) {
    return true
  }

  return typeof cell === 'string' && !/\S/.test(cell)
}

function isBlankRow(row: unknown[]): boolean {
  return row.every(isBlankCell)
}

interface TextBudget {
  remainingBytes: number
  isExhausted: boolean
}

function createTextBudget(): TextBudget {
  return {
    remainingBytes: KNOWLEDGE_LIMITS.maxItemTextBytes
      - TRUNCATION_RESERVE_BYTES,
    isExhausted: false,
  }
}

function takeFromBudget(line: string, budget: TextBudget): boolean {
  const lineBytes = getUtf8ByteLength(line) + 1

  if (lineBytes > budget.remainingBytes) {
    budget.isExhausted = true

    return false
  }

  budget.remainingBytes -= lineBytes

  return true
}

function formatTableRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}

function formatRowWithinBudget(
  row: unknown[],
  columnCount: number,
  budget: TextBudget,
): string | null {
  const cells: string[] = []
  let usedChars = 0

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const cell = escapeTableCell(row[columnIndex])

    usedChars += cell.length + 3

    if (usedChars > budget.remainingBytes) {
      budget.isExhausted = true

      return null
    }

    cells.push(cell)
  }

  return formatTableRow(cells)
}

function collectSheetRows(rows: unknown[][]): {
  tableRows: unknown[][]
  omittedRowCount: number
} {
  const tableRows: unknown[][] = []
  let omittedRowCount = 0

  for (const row of rows) {
    if (isBlankRow(row)) {
      continue
    }

    if (tableRows.length > MAX_SHEET_ROWS) {
      omittedRowCount += 1

      continue
    }

    tableRows.push(row)
  }

  return { tableRows, omittedRowCount }
}

function appendLineWithinBudget(
  lines: string[],
  line: string | null,
  budget: TextBudget,
): boolean {
  if (line === null || !takeFromBudget(line, budget)) {
    budget.isExhausted = true

    return false
  }

  lines.push(line)

  return true
}

function getWidestRowLength(rows: unknown[][]): number {
  return rows.reduce((widest, row) => Math.max(widest, row.length), 0)
}

function formatSheetAsMarkdown(
  sheetName: string,
  rows: unknown[][],
  budget: TextBudget,
): string | null {
  const { tableRows, omittedRowCount } = collectSheetRows(rows)
  const [headerRow, ...bodyRows] = tableRows

  if (!headerRow) {
    return null
  }

  const widestRowLength = getWidestRowLength(tableRows)
  const columnCount = Math.min(MAX_SHEET_COLUMNS, widestRowLength)
  const lines: string[] = []
  const separatorLine = formatTableRow(
    Array.from({ length: columnCount }, () => '---'),
  )

  if (
    !appendLineWithinBudget(lines, `## ${escapeTableCell(sheetName)}`, budget)
    || !appendLineWithinBudget(lines, '', budget)
    || !appendLineWithinBudget(
      lines,
      formatRowWithinBudget(headerRow, columnCount, budget),
      budget,
    )
    || !appendLineWithinBudget(lines, separatorLine, budget)
  ) {
    return null
  }

  for (const row of bodyRows) {
    const line = formatRowWithinBudget(row, columnCount, budget)

    if (!appendLineWithinBudget(lines, line, budget)) {
      break
    }
  }

  const notes = [
    omittedRowCount > 0 ? `(${omittedRowCount} more rows omitted)` : null,
    widestRowLength > MAX_SHEET_COLUMNS
      ? `(columns beyond ${MAX_SHEET_COLUMNS} omitted)`
      : null,
  ].filter((note): note is string => note !== null)

  if (notes.length > 0) {
    budget.remainingBytes -= getUtf8ByteLength(`\n\n${notes.join('\n')}`)
    lines.push('', ...notes)
  }

  return lines.join('\n')
}

function formatWorkbookAsMarkdown(
  sheets: Array<{ sheet: string, data: unknown[][] }>,
): string {
  const budget = createTextBudget()
  const visibleSheets = sheets.slice(0, MAX_XLSX_SHEETS)
  const sections: string[] = []

  for (const sheet of visibleSheets) {
    if (budget.isExhausted) {
      break
    }

    const separatorBytes = sections.length > 0 ? SECTION_SEPARATOR_BYTES : 0

    budget.remainingBytes -= separatorBytes

    const section = formatSheetAsMarkdown(sheet.sheet, sheet.data, budget)

    if (section !== null) {
      sections.push(section)
    } else {
      budget.remainingBytes += separatorBytes
    }
  }

  const omittedSheetCount = sheets.length - visibleSheets.length

  if (sections.length > 0 && budget.isExhausted) {
    sections.push(TRUNCATION_NOTICE)
  }

  if (sections.length > 0 && omittedSheetCount > 0) {
    sections.push(`(${omittedSheetCount} more sheets omitted)`)
  }

  return sections.join('\n\n')
}

async function extractXlsx(bytes: ArrayBuffer): Promise<ExtractionOutcome> {
  const zipFailure = inspectZipLimits(bytes, 'client-xlsx', failureCodes.xlsx)

  if (zipFailure) {
    return zipFailure
  }

  const { default: readXlsxFile } = await import('read-excel-file/web-worker')
  const sheets = await readXlsxFile(bytes)
  const text = formatWorkbookAsMarkdown(sheets)

  if (text.length === 0) {
    return createNoText('client-xlsx')
  }

  return { extractor: 'client-xlsx', extractStatus: 'ready', text }
}

async function extractDocument(
  extension: string,
  bytes: ArrayBuffer,
): Promise<ExtractionOutcome> {
  if (extension === 'pdf') {
    try {
      return await extractPdf(bytes)
    } catch (exception) {
      return createFailure('client-unpdf', mapPdfException(exception))
    }
  }

  if (extension === 'docx') {
    try {
      return await extractDocx(bytes)
    } catch {
      return createFailure('client-mammoth', failureCodes.docx)
    }
  }

  try {
    return await extractXlsx(bytes)
  } catch {
    return createFailure('client-xlsx', failureCodes.xlsx)
  }
}

async function extractOutcome(
  name: string,
  bytes: ArrayBuffer,
): Promise<ExtractionOutcome> {
  const category = getKnowledgeFileCategory(name)

  if (category === 'text') {
    return extractText(bytes)
  }

  if (category === 'image') {
    return createNoText('text')
  }

  if (category === 'document') {
    return await extractDocument(getFileExtension(name), bytes)
  }

  return createFailure('text', 'unsupported')
}

function toWorkerResult(
  outcome: ExtractionOutcome,
  contentHash: string,
): KnowledgeWorkerResult {
  const result: KnowledgeWorkerResult = {
    extractor: outcome.extractor,
    extractStatus: outcome.extractStatus,
    extractError: outcome.extractError ?? null,
    text: outcome.text ?? '',
    pageCount: outcome.pageCount ?? null,
    contentHash,
  }

  if (outcome.html !== undefined) {
    result.html = outcome.html
  }

  return result
}

/**
 * Pure extraction entry shared by the Web Worker and the main-thread
 * fallback. Never throws: every failure maps to a short error code.
 */
export async function extractKnowledgeBytes(
  { name, bytes }: { name: string, bytes: ArrayBuffer },
): Promise<KnowledgeWorkerResult> {
  if (bytes.byteLength > KNOWLEDGE_LIMITS.maxOriginalFileBytes) {
    return toWorkerResult(createFailure('text', 'too-large'), '')
  }

  let contentHash: string

  try {
    contentHash = await sha256Hex(bytes)
  } catch {
    return toWorkerResult(createFailure('text', 'hash-failed'), '')
  }

  try {
    return toWorkerResult(await extractOutcome(name, bytes), contentHash)
  } catch {
    return toWorkerResult(
      createFailure('text', failureCodes.generic),
      contentHash,
    )
  }
}

export async function handleKnowledgeWorkerRequest(
  request: KnowledgeWorkerRequest,
): Promise<KnowledgeWorkerResponse> {
  const result = await extractKnowledgeBytes({
    name: request.name,
    bytes: request.bytes,
  })

  return { id: request.id, ...result }
}

function isDedicatedWorkerScope(scope: object): boolean {
  const workerScopeConstructor = (globalThis as {
    WorkerGlobalScope?: new () => object
  }).WorkerGlobalScope

  return typeof workerScopeConstructor !== 'undefined'
    && scope instanceof workerScopeConstructor
}

const workerScope = globalThis as unknown as KnowledgeWorkerScope

if (isDedicatedWorkerScope(workerScope)) {
  workerScope.onmessage = async (event) => {
    workerScope.postMessage(await handleKnowledgeWorkerRequest(event.data))
  }
}
