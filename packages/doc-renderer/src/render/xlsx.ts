import writeExcelFile from 'write-excel-file/universal'
import type { Cell as ExcelCell, SheetData } from 'write-excel-file/universal'
import { PINNED_DOCUMENT_DATE } from '../constants.ts'
import { stampOoxml } from '../stamp/ooxml.ts'
import type { Cell, XlsxSpec } from '../spec/v1.ts'
import { checkFormula } from '../validate/formula.ts'
import {
  ACCENT_COLORS,
  ACCENT_TINTS,
  DEFAULT_PROVENANCE,
  MEDIA_TYPES,
  resolveTheme,
} from './common.ts'
import type { RenderOptions, RenderResult } from './common.ts'
import { RenderError } from './errors.ts'

const COLUMN_FORMATS: Record<string, string | undefined> = {
  string: undefined,
  number: '#,##0.00',
  integer: '0',
  currency: '#,##0.00',
  percent: '0.0%',
  date: 'yyyy-mm-dd',
  boolean: undefined,
}
const FUTURE_FUNCTIONS = ['IFS', 'XLOOKUP', 'CONCAT']
const DEFAULT_COLUMN_WIDTH = 14

function parseIsoDate(value: string): Date {
  const hasTime = value.length > 10
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  const normalized = hasTime && !hasZone ? `${value}Z` : value

  return new Date(hasTime ? normalized : `${value}T00:00:00Z`)
}

function prefixFutureFunctions(formula: string): string {
  const pattern = new RegExp(`(?<![\\w.])(${FUTURE_FUNCTIONS.join('|')})\\(`, 'gi')
  const segments = formula.split(/("(?:[^"]|"")*")/)

  return segments.map((segment, index) => {
    return index % 2 === 1
      ? segment
      : segment.replace(pattern, (_match, name: string) => {
        return `_xlfn.${name.toUpperCase()}(`
      })
  }).join('')
}

function buildCell(
  cell: Cell | undefined,
  columnType: string,
  format: string | undefined,
  location: string,
): ExcelCell {
  if (cell === null || cell === undefined) {
    return null
  }

  if (typeof cell === 'string') {
    return { type: String, value: cell }
  }

  if (typeof cell === 'number') {
    return { type: Number, value: cell, format }
  }

  if (typeof cell === 'boolean') {
    return { type: Boolean, value: cell }
  }

  if ('date' in cell) {
    return {
      type: Date,
      value: parseIsoDate(cell.date),
      format: COLUMN_FORMATS.date,
    }
  }

  const checked = checkFormula(cell.formula)

  if (!checked.ok) {
    throw new RenderError(
      'invalid_spec',
      `Formula at ${location} is not allowed: ${checked.detail}`,
    )
  }

  const body = cell.formula.startsWith('=') ? cell.formula.slice(1) : cell.formula

  return {
    type: 'Formula',
    value: prefixFutureFunctions(body),
    format: columnType === 'string' ? undefined : format,
  }
}

function columnLetters(index: number): string {
  let letters = ''
  let value = index + 1

  while (value > 0) {
    const remainder = (value - 1) % 26

    letters = String.fromCharCode(65 + remainder) + letters
    value = Math.floor((value - 1) / 26)
  }

  return letters
}

export async function renderXlsx(
  spec: XlsxSpec,
  options: RenderOptions,
): Promise<RenderResult> {
  const theme = resolveTheme(spec)
  const headerStyle = {
    fontWeight: 'bold' as const,
    textColor: `#${ACCENT_COLORS[theme.accent]}`,
    backgroundColor: `#${ACCENT_TINTS[theme.accent]}`,
    borderColor: '#C7CCD4',
    borderStyle: 'thin' as const,
    alignVertical: 'center' as const,
  }
  let cells = 0

  const sheets = spec.sheets.map((sheet) => {
    const header: ExcelCell[] = sheet.columns.map((column) => {
      return { type: String, value: column.header, ...headerStyle }
    })
    const rows = sheet.rows.map((row, rowIndex) => {
      return sheet.columns.map((column, columnIndex) => {
        return buildCell(
          row[columnIndex],
          column.type,
          COLUMN_FORMATS[column.type],
          `${sheet.name}!${columnLetters(columnIndex)}${rowIndex + 2}`,
        )
      })
    })
    const data: SheetData = [header, ...rows]

    cells += data.length * sheet.columns.length

    return {
      data,
      sheet: sheet.name,
      columns: sheet.columns.map((column) => {
        return { width: column.width ?? DEFAULT_COLUMN_WIDTH }
      }),
      stickyRowsCount: sheet.freezeHeader === false ? undefined : 1,
    }
  })

  let packed: Uint8Array

  try {
    const blob = await writeExcelFile(sheets, {
      fontFamily: theme.font === 'serif' ? 'Times New Roman' : 'Arial',
    }).toBlob()

    packed = new Uint8Array(await blob.arrayBuffer())
  } catch (exception) {
    if (exception instanceof RenderError) {
      throw exception
    }

    throw new RenderError(
      'render_failed',
      `XLSX writing failed: ${exception instanceof Error ? exception.message : 'unknown'}`,
    )
  }

  const stamped = stampOoxml(packed, {
    ...(options.provenance ?? DEFAULT_PROVENANCE),
    title: spec.title,
    language: spec.language,
    createdAt: options.createdAt ?? PINNED_DOCUMENT_DATE,
  })

  if (!stamped.ok) {
    throw new RenderError('render_failed', `XLSX stamp failed: ${stamped.code}`)
  }

  return {
    bytes: stamped.bytes,
    mediaType: MEDIA_TYPES.xlsx,
    extension: 'xlsx',
    stats: { sheets: spec.sheets.length, cells },
    warnings: [],
  }
}
