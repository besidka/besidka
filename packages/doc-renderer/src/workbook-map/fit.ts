import { plural, utf8Length } from './text.ts'

const SHEET_HEADING = '## Sheet: '
const VALUES_HEADING = '### Values'
const SEPARATOR = '\n\n'
const NOTE_PREFIX = '('
const TRUNCATION_PREFIX = '[Truncated'
const SHEET_NAMES_IN_NOTE_MAX = 10

interface SheetBlock {
  name: string
  structure: string
  values: string | null
  valueRows: number
}

interface ParsedMap {
  preamble: string
  sheets: SheetBlock[]
  trailer: string | null
}

function trimBlock(lines: readonly string[]): string {
  let end = lines.length

  while (end > 0 && (lines[end - 1] as string).trim() === '') {
    end -= 1
  }

  return lines.slice(0, end).join('\n')
}

function countValueRows(lines: readonly string[]): number {
  let rows = 0

  for (const line of lines.slice(2)) {
    if (line.length > 0 && !line.startsWith(NOTE_PREFIX)) {
      rows += 1
    }
  }

  return rows
}

function parseSheet(lines: readonly string[]): SheetBlock {
  const valuesAt = lines.indexOf(VALUES_HEADING)
  const structureLines = valuesAt === -1 ? lines : lines.slice(0, valuesAt)
  const valueLines = valuesAt === -1 ? [] : lines.slice(valuesAt)

  return {
    name: (lines[0] as string).slice(SHEET_HEADING.length),
    structure: trimBlock(structureLines),
    values: valueLines.length > 0 ? trimBlock(valueLines) : null,
    valueRows: countValueRows(valueLines),
  }
}

/**
 * Splits a map into the preamble (title, legend, named ranges), one block
 * per sheet and a trailing truncation marker, using only the headings the
 * renderer writes. Every workbook string in a map is flattened to one line
 * and cannot start with `## ` or `### `, so a cell value cannot forge a
 * heading.
 */
function parseMap(text: string): ParsedMap {
  const lines = text.split('\n')
  let trailer: string | null = null
  let end = lines.length

  while (end > 0 && (lines[end - 1] as string).trim() === '') {
    end -= 1
  }

  if (end > 0 && (lines[end - 1] as string).startsWith(TRUNCATION_PREFIX)) {
    trailer = lines[end - 1] as string
    end -= 1
  }

  const body = lines.slice(0, end)
  const firstSheet = body.findIndex(line => line.startsWith(SHEET_HEADING))
  const preambleEnd = firstSheet === -1 ? body.length : firstSheet
  const sheets: SheetBlock[] = []
  let start = preambleEnd

  while (start < body.length) {
    let next = start + 1

    while (next < body.length && !body[next]?.startsWith(SHEET_HEADING)) {
      next += 1
    }

    sheets.push(parseSheet(body.slice(start, next)))
    start = next
  }

  return { preamble: trimBlock(body.slice(0, preambleEnd)), sheets, trailer }
}

function droppedValues(sheet: SheetBlock): string {
  return `${VALUES_HEADING}\n(values of this sheet were left out of this `
    + `earlier turn: ${plural(sheet.valueRows, 'row', 'rows')})`
}

function sheetsLeftOutNote(names: readonly string[]): string {
  const shown = names.slice(0, SHEET_NAMES_IN_NOTE_MAX)
  const rest = names.length - shown.length
  const list = rest > 0
    ? `${shown.join(', ')} and ${rest} more`
    : shown.join(', ')

  return `[${plural(names.length, 'sheet was', 'sheets were')} left out of `
    + `this earlier turn: ${list}.]`
}

function cutToBytes(text: string, maxBytes: number): string {
  let low = 0
  let high = text.length

  while (low < high) {
    const middle = Math.ceil((low + high) / 2)

    if (utf8Length(text.slice(0, middle)) <= maxBytes) {
      low = middle
    } else {
      high = middle - 1
    }
  }

  const code = text.charCodeAt(low - 1)
  const isHighSurrogate = code >= 0xD800 && code <= 0xDBFF

  return text.slice(0, isHighSurrogate ? low - 1 : low)
}

function assemble(
  parsed: ParsedMap,
  sheetCount: number,
  keptValues: ReadonlySet<number>,
): string {
  const blocks = [parsed.preamble]

  parsed.sheets.slice(0, sheetCount).forEach((sheet, index) => {
    blocks.push(sheet.structure)

    if (sheet.values === null) {
      return
    }

    blocks.push(keptValues.has(index) ? sheet.values : droppedValues(sheet))
  })

  const leftOut = parsed.sheets.slice(sheetCount).map(sheet => sheet.name)

  if (leftOut.length > 0) {
    blocks.push(sheetsLeftOutNote(leftOut))
  }

  if (parsed.trailer) {
    blocks.push(parsed.trailer)
  }

  return blocks.filter(block => block.length > 0).join(SEPARATOR)
}

/**
 * Shortens a workbook map to at most `maxBytes` of UTF-8 for an earlier
 * turn of a chat, working on the map text alone. It keeps the title, the
 * legend, named ranges and the structure of every sheet (formulas,
 * validation, conditional formatting, formats, merged cells, notes), then
 * adds whole Values blocks, smallest first, while they fit, so small tabs
 * that dropdowns and lookups point at survive. A dropped block becomes one
 * line with its row count. If even the structure does not fit, sheets are
 * left out from the end with a note naming them. A map that already fits
 * is returned unchanged.
 */
export function fitWorkbookMap(text: string, maxBytes: number): string {
  if (utf8Length(text) <= maxBytes) {
    return text
  }

  const parsed = parseMap(text)
  let sheetCount = parsed.sheets.length

  while (
    sheetCount > 0
    && utf8Length(assemble(parsed, sheetCount, new Set())) > maxBytes
  ) {
    sheetCount -= 1
  }

  const base = assemble(parsed, sheetCount, new Set())

  if (utf8Length(base) > maxBytes) {
    return cutToBytes(base, maxBytes)
  }

  let used = utf8Length(base)
  const kept = new Set<number>()
  const order = parsed.sheets
    .slice(0, sheetCount)
    .map((sheet, index) => ({ sheet, index }))
    .filter(({ sheet }) => sheet.values !== null)
    .map(({ sheet, index }) => {
      return {
        index,
        extra: utf8Length(sheet.values as string)
          - utf8Length(droppedValues(sheet)),
      }
    })
    .sort((first, second) => first.extra - second.extra)

  for (const { index, extra } of order) {
    if (used + extra > maxBytes) {
      continue
    }

    kept.add(index)
    used += extra
  }

  return assemble(parsed, sheetCount, kept)
}
