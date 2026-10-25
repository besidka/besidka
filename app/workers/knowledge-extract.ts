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

async function extractDocx(bytes: ArrayBuffer): Promise<ExtractionOutcome> {
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

  return text
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .trim()
}

function formatTableRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}

function formatSheetAsMarkdown(
  sheetName: string,
  rows: unknown[][],
): string | null {
  const nonEmptyRows = rows.filter((row) => {
    return row.some(cell => escapeTableCell(cell).length > 0)
  })

  if (nonEmptyRows.length === 0) {
    return null
  }

  const [headerRow = [], ...bodyRows] = nonEmptyRows
  const visibleRows = bodyRows.slice(0, MAX_SHEET_ROWS)
  const omittedRowCount = bodyRows.length - visibleRows.length
  const columnCount = Math.max(
    headerRow.length,
    ...visibleRows.map(row => row.length),
  )

  function toCells(row: unknown[]): string[] {
    return Array.from({ length: columnCount }, (_cell, columnIndex) => {
      return escapeTableCell(row[columnIndex])
    })
  }

  const lines = [
    `## ${escapeTableCell(sheetName)}`,
    '',
    formatTableRow(toCells(headerRow)),
    formatTableRow(Array.from({ length: columnCount }, () => '---')),
    ...visibleRows.map(row => formatTableRow(toCells(row))),
  ]

  if (omittedRowCount > 0) {
    lines.push('', `(${omittedRowCount} more rows omitted)`)
  }

  return lines.join('\n')
}

async function extractXlsx(bytes: ArrayBuffer): Promise<ExtractionOutcome> {
  const { default: readXlsxFile } = await import('read-excel-file/web-worker')
  const sheets = await readXlsxFile(bytes)
  const sections = sheets
    .map(sheet => formatSheetAsMarkdown(sheet.sheet, sheet.data))
    .filter((section): section is string => section !== null)

  if (sections.length === 0) {
    return createNoText('client-xlsx')
  }

  return {
    extractor: 'client-xlsx',
    extractStatus: 'ready',
    text: sections.join('\n\n'),
  }
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
