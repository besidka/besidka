import { parseXml } from '../validate/xml.ts'
import type { ZipEntry } from '../validate/zip.ts'
import {
  ExtractError,
  TextSink,
  addTruncation,
  cutToCharacters,
  findEntry,
  readRelationships,
  relationshipIdOf,
  scanPart,
  scanPartWindows,
} from './common.ts'
import type { ExtractionOutput, OfficePackage } from './common.ts'

interface SheetReference {
  name: string
  partName: string
}

interface Workbook {
  sheets: SheetReference[]
  date1904: boolean
  sharedStringsPart: string
  stylesPart: string
}

interface RawCell {
  column: number
  text: string
  sharedIndex: number
}

interface SheetData {
  rows: RawCell[][]
  cellCount: number
  sharedIndexes: Set<number>
  hasMoreRows: boolean
  hasDroppedColumns: boolean
  hasTruncatedCells: boolean
  hasCellLimit: boolean
}

const RECORD_END = '</si>'
const WORKBOOK_PART = 'xl/workbook.xml'
const DEFAULT_SHARED_STRINGS_PART = 'xl/sharedStrings.xml'
const DEFAULT_STYLES_PART = 'xl/styles.xml'
const WORKSHEET_TYPE_SUFFIX = '/worksheet'
const SHARED_STRINGS_TYPE_SUFFIX = '/sharedStrings'
const STYLES_TYPE_SUFFIX = '/styles'
const MAX_COLUMN_LETTERS = 3
const FIRST_UPPERCASE_CODE = 65
const LAST_UPPERCASE_CODE = 90
const BUILT_IN_DATE_FORMATS: ReadonlySet<number> = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47,
  50, 51, 52, 53, 54, 55, 56, 57, 58,
])
const MILLISECONDS_PER_DAY = 86_400_000
const SECONDS_PER_DAY = 86_400
const DATE_1904_OFFSET_DAYS = 1462
const LAST_SERIAL = 2_958_465
const LEAP_BUG_SERIAL = 60
const EXCEL_EPOCH_AFTER_LEAP_BUG = Date.UTC(1899, 11, 30)
const EXCEL_EPOCH_BEFORE_LEAP_BUG = Date.UTC(1899, 11, 31)

function columnIndexOf(reference: string | undefined): number | null {
  if (reference === undefined) {
    return null
  }

  let index = 0
  let letters = 0

  for (const character of reference) {
    const code = character.charCodeAt(0)

    if (code < FIRST_UPPERCASE_CODE || code > LAST_UPPERCASE_CODE) {
      break
    }

    letters += 1

    if (letters > MAX_COLUMN_LETTERS) {
      return Number.MAX_SAFE_INTEGER
    }

    index = index * 26 + (code - FIRST_UPPERCASE_CODE + 1)
  }

  return letters === 0 ? null : index - 1
}

function escapeCsvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function isDateFormatCode(formatCode: string): boolean {
  const stripped = formatCode
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/_./g, '')
    .replace(/\*./g, '')
    .replace(/\[[^\]]*\]/g, (section) => {
      return /^\[(?:h+|m+|s+)\]$/i.test(section) ? 'h' : ''
    })

  return /[ymdhs]/i.test(stripped)
}

function formatSerial(raw: string, date1904: boolean): string | null {
  const serial = Number(raw)

  if (!Number.isFinite(serial) || serial <= 0 || serial > LAST_SERIAL) {
    return null
  }

  const shifted = date1904 && serial >= 1
    ? serial + DATE_1904_OFFSET_DAYS
    : serial
  let wholeDays = Math.floor(shifted)
  let seconds = Math.round((shifted - wholeDays) * SECONDS_PER_DAY)

  if (seconds >= SECONDS_PER_DAY) {
    wholeDays += 1
    seconds -= SECONDS_PER_DAY
  }

  const time = [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ].map(part => String(part).padStart(2, '0')).join(':')

  if (wholeDays === 0) {
    return time
  }

  let date: string

  if (wholeDays === LEAP_BUG_SERIAL) {
    date = '1900-02-29'
  } else {
    const epoch = wholeDays < LEAP_BUG_SERIAL
      ? EXCEL_EPOCH_BEFORE_LEAP_BUG
      : EXCEL_EPOCH_AFTER_LEAP_BUG

    date = new Date(epoch + wholeDays * MILLISECONDS_PER_DAY)
      .toISOString()
      .slice(0, 10)
  }

  return seconds === 0 ? date : `${date}T${time}`
}

function readWorkbook(pkg: OfficePackage): Workbook {
  const entry = findEntry(pkg, WORKBOOK_PART)

  if (!entry) {
    throw new ExtractError(
      'ooxml_main_part_missing',
      'The workbook has no xl/workbook.xml part',
    )
  }

  const declared: Array<{ name: string, relationshipId: string | null }> = []
  let date1904 = false

  scanPart(pkg, entry, (events) => {
    declared.length = 0
    date1904 = false

    for (const event of events) {
      if (event.type !== 'start') {
        continue
      }

      if (event.name === 'sheet') {
        declared.push({
          name: event.attributes.name ?? '',
          relationshipId: relationshipIdOf(event.attributes),
        })
      } else if (event.name === 'workbookPr') {
        const flag = event.attributes.date1904

        date1904 = flag === '1' || flag === 'true'
      }
    }

    return false
  }, { keepAttributePrefixes: true })

  const relationships = readRelationships(pkg, WORKBOOK_PART)
  const byId = new Map(relationships.map((relationship) => {
    return [relationship.id, relationship] as const
  }))
  const sheets: SheetReference[] = []

  for (const sheet of declared) {
    const relationship = sheet.relationshipId === null
      ? undefined
      : byId.get(sheet.relationshipId)

    if (relationship?.type.endsWith(WORKSHEET_TYPE_SUFFIX)) {
      sheets.push({ name: sheet.name, partName: relationship.target })
    }
  }

  const sharedStrings = relationships.find((relationship) => {
    return relationship.type.endsWith(SHARED_STRINGS_TYPE_SUFFIX)
  })
  const styles = relationships.find((relationship) => {
    return relationship.type.endsWith(STYLES_TYPE_SUFFIX)
  })

  return {
    sheets,
    date1904,
    sharedStringsPart: sharedStrings?.target ?? DEFAULT_SHARED_STRINGS_PART,
    stylesPart: styles?.target ?? DEFAULT_STYLES_PART,
  }
}

function readDateStyles(pkg: OfficePackage, partName: string): Set<number> {
  const dateStyles = new Set<number>()
  const entry = findEntry(pkg, partName)

  if (!entry) {
    return dateStyles
  }

  scanPart(pkg, entry, (events) => {
    dateStyles.clear()

    const customFormats = new Map<number, string>()
    let isInCellFormats = false
    let styleIndex = 0

    for (const event of events) {
      if (event.type === 'start') {
        if (event.name === 'numFmt') {
          customFormats.set(
            Number(event.attributes.numFmtId),
            event.attributes.formatCode ?? '',
          )
        } else if (event.name === 'cellXfs') {
          isInCellFormats = true
        } else if (event.name === 'xf' && isInCellFormats) {
          const formatId = Number(event.attributes.numFmtId ?? 0)
          const customCode = customFormats.get(formatId)
          const isDate = customCode === undefined
            ? BUILT_IN_DATE_FORMATS.has(formatId)
            : isDateFormatCode(customCode)

          if (isDate) {
            dateStyles.add(styleIndex)
          }

          styleIndex += 1
        }
      } else if (event.type === 'end' && event.name === 'cellXfs') {
        return true
      }
    }

    return false
  })

  return dateStyles
}

class SharedStrings {
  private readonly strings = new Map<number, string>()
  private readonly needed = new Set<number>()
  private isComplete = false
  private highestNeeded = -1
  private readonly pkg: OfficePackage
  private readonly entry: ZipEntry | null

  constructor(pkg: OfficePackage, entry: ZipEntry | null) {
    this.pkg = pkg
    this.entry = entry
  }

  resolve(index: number): string {
    return this.strings.get(index) ?? ''
  }

  ensure(indexes: Iterable<number>): void {
    if (this.entry === null || this.isComplete) {
      return
    }

    let hasNew = false

    for (const index of indexes) {
      if (!this.needed.has(index)) {
        this.needed.add(index)
        this.highestNeeded = Math.max(this.highestNeeded, index)
        hasNew = true
      }
    }

    if (hasNew) {
      this.load()
    }
  }

  private load(): void {
    const { pkg, needed, strings } = this
    const { cellCharsMax } = pkg.limits
    const highest = this.highestNeeded
    let position = 0
    let hasTruncatedString = false

    const outcome = scanPartWindows(
      pkg,
      this.entry as ZipEntry,
      RECORD_END,
      (windowText, isFirstWindow) => {
        if (isFirstWindow) {
          strings.clear()
          position = 0
        }

        let cursor = 0

        for (;;) {
          const recordEnd = windowText.indexOf(RECORD_END, cursor)

          if (recordEnd === -1) {
            return false
          }

          const nextCursor = recordEnd + RECORD_END.length

          if (needed.has(position)) {
            const value = readSharedStringText(
              windowText.slice(cursor, nextCursor),
            )

            hasTruncatedString = hasTruncatedString
              || value.length > cellCharsMax
            strings.set(position, cutToCharacters(value, cellCharsMax))
          }

          position += 1
          cursor = nextCursor

          if (position > highest) {
            return true
          }
        }
      },
    )

    this.isComplete = !outcome.enough

    if (outcome.cut) {
      addTruncation(pkg.stats, 'part_limit')
    }

    if (hasTruncatedString) {
      addTruncation(pkg.stats, 'cell_chars_limit')
    }
  }
}

function readSharedStringText(record: string): string {
  let value = ''
  let isInText = false
  let phoneticDepth = 0

  for (const event of parseXml(record)) {
    if (event.type === 'start') {
      if (event.name === 'rPh') {
        phoneticDepth += 1
      } else if (event.name === 't') {
        isInText = phoneticDepth === 0
      }
    } else if (event.type === 'text') {
      if (isInText) {
        value += event.text
      }
    } else if (event.name === 't') {
      isInText = false
    } else if (event.name === 'rPh') {
      phoneticDepth -= 1
    }
  }

  return value
}

function readSheet(
  pkg: OfficePackage,
  entry: ZipEntry,
  dateStyles: Set<number>,
  date1904: boolean,
  cellsAvailable: number,
): { data: SheetData, isCut: boolean } {
  const { rowsMax, columnsMax, cellCharsMax } = pkg.limits
  let data = createSheetData()

  const outcome = scanPart(pkg, entry, (events) => {
    data = createSheetData()

    let isInSheetData = false
    let rowCells: RawCell[] = []
    let nextColumn = 0
    let column: number | null = null
    let type = 'n'
    let styleIndex = 0
    let valueText = ''
    let inlineText = ''
    let isInValue = false
    let isInInline = false
    let isInInlineText = false
    let phoneticDepth = 0

    for (const event of events) {
      if (event.type === 'start') {
        if (event.name === 'sheetData') {
          isInSheetData = true
        } else if (!isInSheetData) {
          continue
        } else if (event.name === 'row') {
          rowCells = []
          nextColumn = 0
        } else if (event.name === 'c') {
          column = columnIndexOf(event.attributes.r) ?? nextColumn
          type = event.attributes.t ?? 'n'
          styleIndex = Number(event.attributes.s ?? 0)
          valueText = ''
          inlineText = ''
          nextColumn = column + 1
        } else if (event.name === 'v') {
          isInValue = true
        } else if (event.name === 'is') {
          isInInline = true
        } else if (event.name === 'rPh') {
          phoneticDepth += 1
        } else if (event.name === 't') {
          isInInlineText = isInInline && phoneticDepth === 0
        }
      } else if (event.type === 'text') {
        if (isInValue) {
          valueText += event.text
        } else if (isInInlineText) {
          inlineText += event.text
        }
      } else if (event.name === 'v') {
        isInValue = false
      } else if (event.name === 't') {
        isInInlineText = false
      } else if (event.name === 'rPh') {
        phoneticDepth -= 1
      } else if (event.name === 'is') {
        isInInline = false
      } else if (event.name === 'c' && column !== null) {
        const cell = buildCell(
          column,
          type,
          styleIndex,
          valueText,
          inlineText,
          dateStyles,
          date1904,
        )

        column = null

        if (cell === null) {
          continue
        }

        if (cell.column >= columnsMax) {
          data.hasDroppedColumns = true
          continue
        }

        if (data.cellCount >= cellsAvailable) {
          data.hasCellLimit = true

          return true
        }

        if (cell.text.length > cellCharsMax) {
          data.hasTruncatedCells = true
          cell.text = cutToCharacters(cell.text, cellCharsMax)
        }

        data.cellCount += 1

        if (cell.sharedIndex >= 0) {
          data.sharedIndexes.add(cell.sharedIndex)
        }

        rowCells.push(cell)
      } else if (event.name === 'row') {
        if (rowCells.length === 0) {
          continue
        }

        if (data.rows.length >= rowsMax) {
          data.hasMoreRows = true

          return true
        }

        data.rows.push(rowCells)
        rowCells = []
      } else if (event.name === 'sheetData') {
        return true
      }
    }

    return false
  })

  return { data, isCut: outcome.cut }
}

function createSheetData(): SheetData {
  return {
    rows: [],
    cellCount: 0,
    sharedIndexes: new Set(),
    hasMoreRows: false,
    hasDroppedColumns: false,
    hasTruncatedCells: false,
    hasCellLimit: false,
  }
}

function buildCell(
  column: number,
  type: string,
  styleIndex: number,
  valueText: string,
  inlineText: string,
  dateStyles: Set<number>,
  date1904: boolean,
): RawCell | null {
  if (type === 's') {
    const sharedIndex = Number.parseInt(valueText, 10)

    return Number.isInteger(sharedIndex) && sharedIndex >= 0
      ? { column, text: '', sharedIndex }
      : null
  }

  let text: string

  if (type === 'inlineStr') {
    text = inlineText
  } else if (type === 'b') {
    text = valueText.trim() === '1' ? 'TRUE' : 'FALSE'
  } else if (type === 'n' && dateStyles.has(styleIndex)) {
    text = formatSerial(valueText.trim(), date1904) ?? valueText.trim()
  } else {
    text = valueText.trim()
  }

  return text.length === 0 ? null : { column, text, sharedIndex: -1 }
}

function renderRow(row: RawCell[], shared: SharedStrings): string | null {
  const fields: string[] = []
  let hasText = false

  for (const cell of row) {
    const text = cell.sharedIndex >= 0
      ? shared.resolve(cell.sharedIndex)
      : cell.text

    if (cell.column < fields.length) {
      continue
    }

    while (fields.length < cell.column) {
      fields.push('')
    }

    hasText = hasText || text.length > 0
    fields.push(escapeCsvField(text))
  }

  return hasText ? fields.join(',') : null
}

export function extractXlsx(pkg: OfficePackage): ExtractionOutput {
  const { limits, stats } = pkg
  const workbook = readWorkbook(pkg)
  const dateStyles = readDateStyles(pkg, workbook.stylesPart)
  const shared = new SharedStrings(
    pkg,
    findEntry(pkg, workbook.sharedStringsPart),
  )
  const sink = new TextSink(limits.textBytesMax)
  const sheetsIncluded = Math.min(workbook.sheets.length, limits.sheetsMax)
  let cellsUsed = 0
  let sheetsWritten = 0
  let hasContent = false

  stats.sheetsTotal = workbook.sheets.length

  if (workbook.sheets.length > limits.sheetsMax) {
    addTruncation(stats, 'sheets_limit')
  }

  for (const sheet of workbook.sheets.slice(0, sheetsIncluded)) {
    const entry = findEntry(pkg, sheet.partName)

    if (!entry) {
      continue
    }

    const { data, isCut } = readSheet(
      pkg,
      entry,
      dateStyles,
      workbook.date1904,
      limits.cellsMax - cellsUsed,
    )

    cellsUsed += data.cellCount
    shared.ensure(data.sharedIndexes)
    sheetsWritten += 1
    sink.add(`## Sheet: ${sheet.name}`)

    let rowsWritten = 0

    for (const row of data.rows) {
      const line = renderRow(row, shared)

      if (line === null) {
        continue
      }

      hasContent = true
      rowsWritten += 1

      if (!sink.add(line, rowsWritten === 1 ? 'block' : 'line')) {
        break
      }
    }

    if (rowsWritten === 0) {
      sink.add('(empty sheet)')
    }

    if (data.hasMoreRows) {
      addTruncation(stats, 'rows_limit')
      sink.add(
        `[Truncated: this sheet has more than ${limits.rowsMax} rows; `
        + 'the rest are not included.]',
      )
    }

    if (data.hasDroppedColumns) {
      addTruncation(stats, 'columns_limit')
      sink.add(
        `[Truncated: columns beyond ${limits.columnsMax} are not included.]`,
      )
    }

    if (data.hasTruncatedCells) {
      addTruncation(stats, 'cell_chars_limit')
    }

    if (data.hasCellLimit || isCut) {
      addTruncation(stats, data.hasCellLimit ? 'cells_limit' : 'part_limit')
      sink.add('[Truncated: this sheet is too large; the rest is not included.]')
    }

    if (sink.isFull) {
      addTruncation(stats, 'text_limit')
      break
    }
  }

  if (workbook.sheets.length > sheetsIncluded) {
    sink.add(
      `[Truncated: only the first ${limits.sheetsMax} of `
      + `${workbook.sheets.length} sheets are included.]`,
    )
  }

  stats.sheets = sheetsWritten

  return { sink, hasContent }
}
