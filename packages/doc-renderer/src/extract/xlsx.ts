import { parseXml } from '../validate/xml.ts'
import type { XmlEvent } from '../validate/xml.ts'
import type { ZipEntry } from '../validate/zip.ts'
import {
  ExtractError,
  TextSink,
  WindowedPart,
  ATTRIBUTES_MAX,
  addTruncation,
  cutToCharacters,
  findEntry,
  meterEvents,
  readRelationships,
  relationshipIdOf,
  scanPart,
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

type SerialFormat
  = | 'date'
    | 'time'
    | 'elapsedHours'
    | 'elapsedMinutes'
    | 'elapsedSeconds'

interface RawCell {
  column: number
  text: string
  sharedIndex: number
}

interface SheetRow {
  number: number
  cells: RawCell[]
}

interface SheetData {
  rows: SheetRow[]
  cellCount: number
  sharedIndexes: Set<number>
  hasMoreRows: boolean
  hasDroppedColumns: boolean
  hasTruncatedCells: boolean
  hasCellLimit: boolean
}

const SHARED_STRING_RECORD = 'si'
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
  14, 15, 16, 17, 22,
  27, 28, 29, 30, 31, 36,
  50, 51, 52, 53, 54, 55, 56, 57, 58,
])
const BUILT_IN_TIME_FORMATS: ReadonlySet<number> = new Set([
  18, 19, 20, 21, 32, 33, 34, 35, 45, 47,
])
const BUILT_IN_ELAPSED_HOURS_FORMAT = 46
const FORMAT_CODE_MAX_CHARACTERS = 255
const FORMATS_MAX = 1024
const SHEET_NAME_MAX = 255
const STYLES_MAX = 65_536
const STORED_CHARACTERS_MAX = 8 * 1024 * 1024
const ROW_GAP_MAX = 20
const MILLISECONDS_PER_DAY = 86_400_000
const SECONDS_PER_DAY = 86_400
const DATE_1904_OFFSET_DAYS = 1462
const LAST_SERIAL = 2_958_465
const MAX_ELAPSED_SERIAL = 1e9
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

function elapsedFormatOf(unit: string): SerialFormat | null {
  const letter = unit.charAt(0).toLowerCase()

  if (!/^(?:h+|m+|s+)$/i.test(unit)) {
    return null
  }

  if (letter === 'h') {
    return 'elapsedHours'
  }

  return letter === 'm' ? 'elapsedMinutes' : 'elapsedSeconds'
}

function classifyFormatCode(formatCode: string): SerialFormat | null {
  const code = formatCode.slice(0, FORMAT_CODE_MAX_CHARACTERS)
  let hasYearOrDay = false
  let hasHourOrSecond = false
  let hasMonthOrMinute = false
  let elapsed: SerialFormat | null = null
  let index = 0

  while (index < code.length) {
    const character = code.charAt(index)

    if (character === '"') {
      const close = code.indexOf('"', index + 1)

      index = close === -1 ? code.length : close + 1
    } else if (character === '\\' || character === '_' || character === '*') {
      index += 2
    } else if (character === '[') {
      const close = code.indexOf(']', index + 1)

      if (close === -1) {
        index += 1
        continue
      }

      elapsed = elapsed ?? elapsedFormatOf(code.slice(index + 1, close))
      index = close + 1
    } else {
      const lower = character.toLowerCase()

      hasYearOrDay = hasYearOrDay || lower === 'y' || lower === 'd'
      hasHourOrSecond = hasHourOrSecond || lower === 'h' || lower === 's'
      hasMonthOrMinute = hasMonthOrMinute || lower === 'm'
      index += 1
    }
  }

  if (elapsed !== null) {
    return elapsed
  }

  if (hasYearOrDay || (hasMonthOrMinute && !hasHourOrSecond)) {
    return 'date'
  }

  return hasHourOrSecond ? 'time' : null
}

function builtInFormatOf(formatId: number): SerialFormat | null {
  if (formatId === BUILT_IN_ELAPSED_HOURS_FORMAT) {
    return 'elapsedHours'
  }

  if (BUILT_IN_TIME_FORMATS.has(formatId)) {
    return 'time'
  }

  return BUILT_IN_DATE_FORMATS.has(formatId) ? 'date' : null
}

function pad(part: number): string {
  return String(part).padStart(2, '0')
}

function formatElapsed(serial: number, format: SerialFormat): string | null {
  if (serial < 0 || serial > MAX_ELAPSED_SERIAL) {
    return null
  }

  const totalSeconds = Math.round(serial * SECONDS_PER_DAY)

  if (format === 'elapsedSeconds') {
    return String(totalSeconds)
  }

  const seconds = totalSeconds % 60

  if (format === 'elapsedMinutes') {
    return `${Math.floor(totalSeconds / 60)}:${pad(seconds)}`
  }

  const minutes = Math.floor((totalSeconds % 3600) / 60)

  return `${Math.floor(totalSeconds / 3600)}:${pad(minutes)}:${pad(seconds)}`
}

function formatSerial(
  raw: string,
  date1904: boolean,
  format: SerialFormat,
): string | null {
  const serial = Number(raw)

  if (raw === '' || !Number.isFinite(serial)) {
    return null
  }

  if (format !== 'date' && format !== 'time') {
    return formatElapsed(serial, format)
  }

  if (serial <= 0 || serial > LAST_SERIAL) {
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
  ].map(pad).join(':')

  if (wholeDays === 0 || format === 'time') {
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

function readWorkbook(officePackage: OfficePackage): Workbook {
  const workbookPart = officePackage.mainPart || WORKBOOK_PART
  const entry = findEntry(officePackage, workbookPart)

  if (!entry) {
    throw new ExtractError(
      'ooxml_main_part_missing',
      'The workbook has no xl/workbook.xml part',
    )
  }

  const declared: Array<{ name: string, relationshipId: string | null }> = []
  let date1904 = false

  scanPart(officePackage, entry, (events) => {
    declared.length = 0
    date1904 = false

    for (const event of events) {
      if (event.type !== 'start') {
        continue
      }

      if (event.name === 'sheet') {
        declared.push({
          name: (event.attributes.name ?? '').slice(0, SHEET_NAME_MAX),
          relationshipId: relationshipIdOf(event.attributes),
        })
      } else if (event.name === 'workbookPr') {
        const flag = event.attributes.date1904

        date1904 = flag === '1' || flag === 'true'
      }
    }

    return false
  }, { keepAttributePrefixes: true })

  const relationships = readRelationships(officePackage, workbookPart)
  const byId = new Map(relationships.map((relationship) => {
    return [relationship.id, relationship] as const
  }))
  const sheets: SheetReference[] = []
  const seenParts = new Set<string>()

  for (const sheet of declared) {
    const relationship = sheet.relationshipId === null
      ? undefined
      : byId.get(sheet.relationshipId)

    if (!relationship?.type.endsWith(WORKSHEET_TYPE_SUFFIX)) {
      continue
    }

    const partKey = relationship.target.toLowerCase()

    if (!seenParts.has(partKey)) {
      seenParts.add(partKey)
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

function readSerialFormats(
  officePackage: OfficePackage,
  partName: string,
): Map<number, SerialFormat> {
  const serialFormats = new Map<number, SerialFormat>()
  const entry = findEntry(officePackage, partName)

  if (!entry) {
    return serialFormats
  }

  scanPart(officePackage, entry, (events) => {
    serialFormats.clear()

    const customFormats = new Map<number, SerialFormat | null>()
    let isInCellFormats = false
    let styleIndex = 0

    for (const event of events) {
      if (event.type === 'start') {
        if (event.name === 'numFmt' && customFormats.size < FORMATS_MAX) {
          customFormats.set(
            Number(event.attributes.numFmtId),
            classifyFormatCode(event.attributes.formatCode ?? ''),
          )
        } else if (event.name === 'cellXfs') {
          isInCellFormats = true
        } else if (event.name === 'xf' && isInCellFormats) {
          const formatId = Number(event.attributes.numFmtId ?? 0)
          const format = customFormats.has(formatId)
            ? customFormats.get(formatId)
            : builtInFormatOf(formatId)

          if (format) {
            serialFormats.set(styleIndex, format)
          }

          styleIndex += 1

          if (styleIndex >= STYLES_MAX) {
            return true
          }
        }
      } else if (event.type === 'end' && event.name === 'cellXfs') {
        return true
      }
    }

    return false
  })

  return serialFormats
}

class SharedStrings {
  private readonly strings: string[] = []
  private readonly needed = new Set<number>()
  private readonly officePackage: OfficePackage
  private readonly part: WindowedPart | null
  private events: Iterator<XmlEvent> | null = null
  private knownRecordCount: number | null = null
  private highestNeeded = -1
  private storedCharacters = 0
  private position = 0
  private isInRecord = false
  private isWanted = false
  private isInText = false
  private phoneticDepth = 0
  private value = ''

  constructor(officePackage: OfficePackage, entry: ZipEntry | null) {
    this.officePackage = officePackage
    this.part = entry === null
      ? null
      : new WindowedPart(officePackage, entry, SHARED_STRING_RECORD)
  }

  resolve(index: number): string {
    return this.strings[index] ?? ''
  }

  /**
   * Makes the strings at `indexes` available. The part is read forward only
   * as far as the highest index asked for. Every record passed on the way is
   * kept, up to a character budget, so a later sheet that shares strings with
   * an earlier one finds them; the part is read again from the start only
   * when a record was passed after that budget was spent.
   */
  ensure(indexes: Iterable<number>): void {
    if (this.part === null) {
      return
    }

    let hasNew = false
    let isBehind = false

    for (const index of indexes) {
      const isBeyondTable = this.knownRecordCount !== null
        && index >= this.knownRecordCount

      if (
        isBeyondTable
        || this.strings[index] !== undefined
        || this.needed.has(index)
      ) {
        continue
      }

      this.needed.add(index)
      this.highestNeeded = Math.max(this.highestNeeded, index)
      hasNew = true
      isBehind = isBehind || index < this.position
    }

    if (!hasNew) {
      return
    }

    if (isBehind) {
      this.part.rewind()
      this.events = null
      this.position = 0
      this.isInRecord = false
    }

    this.advance(this.part)
  }

  private advance(part: WindowedPart): void {
    while (this.position <= this.highestNeeded) {
      if (this.events === null) {
        const text = part.next()

        if (text === null) {
          this.knownRecordCount = this.position

          if (part.isCut) {
            addTruncation(this.officePackage.stats, 'part_limit')
          }

          return
        }

        this.events = meterEvents(
          this.officePackage,
          parseXml(text, { attributesMax: ATTRIBUTES_MAX }),
        )[Symbol.iterator]()
      }

      const step = this.events.next()

      if (step.done) {
        this.events = null
        continue
      }

      this.consume(step.value)
    }
  }

  private consume(event: XmlEvent): void {
    if (event.type === 'start') {
      if (event.name === 'si') {
        this.isInRecord = true
        this.isWanted = this.needed.has(this.position)
          || this.storedCharacters < STORED_CHARACTERS_MAX
        this.isInText = false
        this.phoneticDepth = 0
        this.value = ''
      } else if (this.isInRecord && event.name === 'rPh') {
        this.phoneticDepth += 1
      } else if (this.isInRecord && event.name === 't') {
        this.isInText = this.phoneticDepth === 0
      }

      return
    }

    if (event.type === 'text') {
      const { cellCharsMax } = this.officePackage.limits

      if (this.isInText && this.isWanted && this.value.length <= cellCharsMax) {
        this.value += event.text
      }

      return
    }

    if (event.name === 't') {
      this.isInText = false
    } else if (event.name === 'rPh') {
      this.phoneticDepth -= 1
    } else if (event.name === 'si') {
      this.finishRecord()
    }
  }

  private finishRecord(): void {
    const { cellCharsMax } = this.officePackage.limits

    if (this.isWanted) {
      if (this.value.length > cellCharsMax) {
        addTruncation(this.officePackage.stats, 'cell_chars_limit')
      }

      const kept = cutToCharacters(this.value, cellCharsMax)

      this.strings[this.position] = kept
      this.storedCharacters += kept.length
    }

    this.position += 1
    this.isInRecord = false
    this.isWanted = false
    this.value = ''
  }
}

function readSheet(
  officePackage: OfficePackage,
  entry: ZipEntry,
  serialFormats: Map<number, SerialFormat>,
  date1904: boolean,
  cellsAvailable: number,
): { data: SheetData, isCut: boolean } {
  const { rowsMax, columnsMax, cellCharsMax } = officePackage.limits
  let data = createSheetData()

  const outcome = scanPart(officePackage, entry, (events) => {
    data = createSheetData()

    let isInSheetData = false
    let rowCells: RawCell[] = []
    let rowNumber = 0
    let lastRowNumber = 0
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
          const declared = Number.parseInt(event.attributes.r ?? '', 10)

          rowNumber = Number.isInteger(declared) && declared > lastRowNumber
            ? declared
            : lastRowNumber + 1
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
          serialFormats,
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

          if (rowCells.length > 0 && data.rows.length < rowsMax) {
            data.rows.push({ number: rowNumber, cells: rowCells })
          }

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
        lastRowNumber = rowNumber

        if (rowCells.length === 0) {
          continue
        }

        if (data.rows.length >= rowsMax) {
          data.hasMoreRows = true

          return true
        }

        data.rows.push({ number: rowNumber, cells: rowCells })
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
  serialFormats: Map<number, SerialFormat>,
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
  } else if (type === 'n' && serialFormats.has(styleIndex)) {
    text = formatSerial(
      valueText.trim(),
      date1904,
      serialFormats.get(styleIndex) as SerialFormat,
    ) ?? valueText.trim()
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

export function extractXlsx(officePackage: OfficePackage): ExtractionOutput {
  const { limits, stats } = officePackage
  const workbook = readWorkbook(officePackage)
  const serialFormats = readSerialFormats(officePackage, workbook.stylesPart)
  const shared = new SharedStrings(
    officePackage,
    findEntry(officePackage, workbook.sharedStringsPart),
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
    const entry = findEntry(officePackage, sheet.partName)

    if (!entry) {
      continue
    }

    const { data, isCut } = readSheet(
      officePackage,
      entry,
      serialFormats,
      workbook.date1904,
      limits.cellsMax - cellsUsed,
    )

    cellsUsed += data.cellCount
    shared.ensure(data.sharedIndexes)
    sheetsWritten += 1
    sink.add(`## Sheet: ${sheet.name}`)

    let rowsWritten = 0
    let previousRowNumber = 0

    for (const row of data.rows) {
      const line = renderRow(row.cells, shared)

      if (line === null) {
        continue
      }

      hasContent = true
      rowsWritten += 1

      if (rowsWritten > 1) {
        sink.addBlankLines(
          Math.min(row.number - previousRowNumber - 1, ROW_GAP_MAX),
        )
      }

      previousRowNumber = row.number

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
