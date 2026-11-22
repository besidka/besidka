import { MAX_COLUMN, cellAddress, columnLetters, parseCell } from './address.ts'
import type { CellPosition } from './address.ts'
import { COLLAPSE_CELLS_MAX, collapseSheetFormulas } from './collapse.ts'
import type {
  FormulaInput,
  FormulaPattern,
  FormulaPatternKind,
  SharedFormulaGroup,
} from './collapse.ts'
import { cellsToRanges, formatRanges, listWithRest } from './ranges.ts'
import { renderConditionalRules, renderValidations } from './rules.ts'
import {
  cleanLine,
  escapeCsvField,
  plural,
  quote,
  utf8Length,
} from './text.ts'
import type {
  SheetCut,
  SheetNotRead,
  WorkbookCell,
  WorkbookMapCut,
  WorkbookMapOptions,
  WorkbookMapResult,
  WorkbookMapSheetSummary,
  WorkbookMapSummary,
  WorkbookModel,
  WorkbookSheet,
} from './types.ts'

export const WORKBOOK_MAP_DEFAULTS: WorkbookMapOptions = {
  maxBytes: 1024 * 1024,
  formulaPatternsMax: 300,
  formulaCellsMax: COLLAPSE_CELLS_MAX,
  formulaPrintCharactersMax: 1000,
  exceptionsMax: 20,
  validationRulesMax: 100,
  conditionalGroupsMax: 100,
  literalVariantsMax: 12,
  numberFormatsMax: 40,
  rangesPerItemMax: 20,
  mergedRangesMax: 200,
  notesMax: 100,
  noteCharactersMax: 500,
  namesMax: 200,
  nameCharactersMax: 500,
  sheetNameCharactersMax: 100,
  messageCharactersMax: 300,
  cellCharactersMax: 2000,
  columnsMax: 200,
}

export const WORKBOOK_MAP_TITLE = '# Workbook map'

export const WORKBOOK_MAP_LEGEND = 'How to read this map: cells use A1 '
  + 'notation. For example, `P8:P164 ↓ =D8*$C$2` means P8 holds that '
  + 'formula and it is filled down to P164: in each lower cell, references '
  + 'without `$` move down by the same number of rows and `$` parts stay. '
  + '`→` is the same, filled to the right, and `↘` filled down and right. '
  + '"except" lists cells inside the range that have their own line or no '
  + 'formula. A cell covered by a Formulas line and not under "except" is '
  + 'computed; any other cell in Values was typed in. `{array}` is one '
  + 'array formula for the whole range. A "copies of" line lists cells '
  + 'holding that cell\'s formula, moved the same way. Formulas in rules '
  + 'are written for the first cell of their range. `_xlfn.` before a '
  + 'function name only marks a newer Excel function. Values are the '
  + 'results last saved in the file, not recalculated: a formula cell with '
  + 'no saved value is blank, and if a saved value contradicts its formula, '
  + 'trust the formula. The first column of each Values table is the row '
  + 'number.'

export const WORKBOOK_MAP_TRUNCATION_MARKER
  = '[Truncated: the map size limit was reached and the rest is not included.]'

const SEPARATOR = '\n\n'
const DOWN_ARROW = '↓'
const RIGHT_ARROW = '→'
const BLOCK_ARROW = '↘'
const VALUES_CUT_NOTE_RESERVE = 120
const SUMMARY_SHEET_NAME_MAX = 64
const NAMED_RANGE_NAME_MAX = 120
const GENERAL_FORMAT = 'general'

const SHEET_CUT_NOTES: Record<SheetCut, string> = {
  rows: 'Only the first {rows} rows were read; later formulas and values are '
    + 'not included.',
  columns: 'Columns after {column} are not included.',
  cells: 'The cell limit was reached; the rest of this sheet is not included.',
  formulas: 'The formula limit was reached; later formulas are not included, '
    + 'so some computed cells may look typed in.',
  structure: 'Rules, merged cells and links stored after the cell data were '
    + 'not read because the sheet is too large.',
  limits: 'Some rules, ranges, merged cells or notes are left out because '
    + 'there are too many.',
  part: 'This sheet is too large; only its start was read.',
  not_read: 'The cell values, formulas, dropdowns and notes of this sheet '
    + 'were not read (a request, time or size limit was reached). Its frozen '
    + 'panes, merged cells and conditional formatting rules are included.',
}

interface SheetText {
  structure: string
  valueLines: Array<{ row: number, text: string }>
  valueHeader: string
  formulaCount: number
  patternCount: number
  validationCount: number
  conditionalCount: number
  cellCount: number
}

interface FormulaLine {
  position: CellPosition
  text?: string
  pattern?: FormulaPattern
}

interface FormulaSummary {
  lines: FormulaLine[]
  count: number
  missingValues: number
  cellsNotGrouped: number
}

type FormulaCell = WorkbookCell & { formula: string }

function emptyNotRead(): SheetNotRead {
  return {
    charts: 0,
    images: 0,
    pivotTables: 0,
    colorScales: 0,
    dataBars: 0,
    iconSets: 0,
    hyperlinks: 0,
  }
}

function stripEquals(formula: string): string {
  return formula.startsWith('=') ? formula.slice(1) : formula
}

function printFormula(formula: string, options: WorkbookMapOptions): string {
  return `=${cleanLine(stripEquals(formula), options.formulaPrintCharactersMax)}`
}

function addressOf(position: CellPosition): string {
  return cellAddress(position.row, position.column)
}

const PATTERN_ARROWS: Record<Exclude<FormulaPatternKind, 'single'>, string> = {
  down: DOWN_ARROW,
  right: RIGHT_ARROW,
  block: BLOCK_ARROW,
}

function describePattern(
  pattern: FormulaPattern,
  options: WorkbookMapOptions,
): string {
  const start = addressOf(pattern.start)
  const formula = printFormula(pattern.formula, options)

  if (pattern.kind === 'single') {
    return `- ${start} ${formula}`
  }

  const range = `${start}:${addressOf(pattern.end)}`
  const exceptions = pattern.exceptions.map(({ from, to }) => {
    const first = addressOf(from)

    return from.row === to.row && from.column === to.column
      ? first
      : `${first}:${addressOf(to)}`
  })
  const tail = exceptions.length > 0 ? ` · except ${exceptions.join(', ')}` : ''

  return `- ${range} ${PATTERN_ARROWS[pattern.kind]} ${formula}${tail}`
}

function describeDataTable(cell: WorkbookCell): string {
  const range = cleanLine(cell.arrayRange ?? addressOf(cell), 40)
  const inputs = [
    cell.dataTable?.rowInput
      ? `row input ${cleanLine(cell.dataTable.rowInput, 16)}`
      : null,
    cell.dataTable?.columnInput
      ? `column input ${cleanLine(cell.dataTable.columnInput, 16)}`
      : null,
  ].filter((input): input is string => input !== null)

  return `- ${range} data table`
    + (inputs.length > 0 ? `: ${inputs.join(', ')}` : '')
}

function copiesLine(
  positions: readonly CellPosition[],
  master: string,
  reason: string,
  options: WorkbookMapOptions,
): FormulaLine {
  const covered = cellsToRanges(positions)
  const first = covered[0] as { top: number, left: number }

  return {
    position: { row: first.top, column: first.left },
    text: `- ${listWithRest(formatRanges(covered), options.rangesPerItemMax)}`
      + `: copies of the shared formula in ${master} (not written out: `
      + `${reason})`,
  }
}

function isFormulaCell(cell: WorkbookCell): boolean {
  return cell.formula !== undefined || cell.formulaKind !== undefined
}

function positionKey(row: number, column: number): number {
  return row * (MAX_COLUMN + 1) + column
}

interface SharedFollowers {
  label: string
  positions: CellPosition[]
}

/**
 * The shared groups of a sheet: followers grouped by the address of their
 * master, and the master cells found for them. A master address held by
 * more than one formula cell is ambiguous, so its followers are listed as
 * copies instead of being tied to either text.
 */
function sharedGroupsOf(cells: readonly WorkbookCell[]): {
  followers: Map<number, SharedFollowers>
  masters: Map<number, FormulaCell | null>
} {
  const followers = new Map<number, SharedFollowers>()
  const masters = new Map<number, FormulaCell | null>()

  for (const cell of cells) {
    if (cell.formulaKind !== 'shared') {
      continue
    }

    const master = parseCell(cell.sharedFrom ?? '')
    const key = master ? positionKey(master.row, master.column) : -1
    const group = followers.get(key)
    const position = { row: cell.row, column: cell.column }

    if (group) {
      group.positions.push(position)
    } else {
      followers.set(key, {
        label: cleanLine(cell.sharedFrom ?? '?', 16),
        positions: [position],
      })
    }
  }

  for (const cell of cells) {
    if (cell.formula === undefined || cell.formulaKind !== undefined) {
      continue
    }

    const key = positionKey(cell.row, cell.column)

    if (followers.has(key)) {
      masters.set(key, masters.has(key) ? null : cell as FormulaCell)
    }
  }

  return { followers, masters }
}

function formulaLines(
  cells: readonly WorkbookCell[],
  options: WorkbookMapOptions,
): FormulaSummary {
  const lines: FormulaLine[] = []
  const unshiftable = new Map<string, CellPosition[]>()
  const { followers, masters } = sharedGroupsOf(cells)
  const groups: SharedFormulaGroup[] = []
  const groupMasters = new Set<FormulaCell>()
  let count = 0
  let missingValues = 0

  for (const cell of cells) {
    if (!isFormulaCell(cell)) {
      continue
    }

    count += 1

    if (cell.value === undefined) {
      missingValues += 1
    }

    if (cell.formulaKind === 'array') {
      const range = cleanLine(cell.arrayRange ?? addressOf(cell), 40)

      lines.push({
        position: { row: cell.row, column: cell.column },
        text: `- ${range} {array} ${printFormula(cell.formula ?? '', options)}`,
      })
    } else if (cell.formulaKind === 'data-table') {
      lines.push({
        position: { row: cell.row, column: cell.column },
        text: describeDataTable(cell),
      })
    } else if (cell.formulaKind === 'shared-copy') {
      const master = cleanLine(cell.sharedFrom ?? '?', 16)
      const positions = unshiftable.get(master)
      const position = { row: cell.row, column: cell.column }

      if (positions) {
        positions.push(position)
      } else {
        unshiftable.set(master, [position])
      }
    }
  }

  for (const [key, group] of followers) {
    const master = masters.get(key)

    if (!master) {
      lines.push(copiesLine(
        group.positions,
        group.label,
        'its master cell was not read',
        options,
      ))
      continue
    }

    groupMasters.add(master)
    groups.push({
      master: {
        row: master.row,
        column: master.column,
        formula: stripEquals(master.formula),
      },
      followers: group.positions,
    })
  }

  const normal: FormulaInput[] = []

  for (const cell of cells) {
    const isPlain = cell.formula !== undefined
      && cell.formulaKind === undefined
      && !groupMasters.has(cell as FormulaCell)

    if (!isPlain) {
      continue
    }

    const formula = cell.formula as string

    normal.push(formula.startsWith('=')
      ? { row: cell.row, column: cell.column, formula: stripEquals(formula) }
      : cell as FormulaCell)
  }

  const collapsed = collapseSheetFormulas(normal, groups, {
    exceptionsMax: options.exceptionsMax,
    cellsMax: options.formulaCellsMax,
  })

  for (const pattern of collapsed.patterns) {
    lines.push({ position: pattern.start, pattern })
  }

  for (const copies of collapsed.copies) {
    lines.push(copiesLine(
      copies.cells,
      addressOf(copies.master),
      'too many to write out',
      options,
    ))
  }

  for (const [master, positions] of unshiftable) {
    lines.push(copiesLine(
      positions,
      master,
      'it uses references this reader does not move',
      options,
    ))
  }

  lines.sort((first, second) => {
    return first.position.row - second.position.row
      || first.position.column - second.position.column
  })

  return {
    lines,
    count,
    missingValues,
    cellsNotGrouped: collapsed.cellsNotGrouped,
  }
}

function lineText(line: FormulaLine, options: WorkbookMapOptions): string {
  return line.pattern ? describePattern(line.pattern, options) : line.text ?? ''
}

function numberFormatLines(
  cells: readonly WorkbookCell[],
  options: WorkbookMapOptions,
): { lines: string[], omitted: number } {
  const byFormat = new Map<string, CellPosition[]>()

  for (const cell of cells) {
    const format = cell.numberFormat

    if (!format || format.toLowerCase() === GENERAL_FORMAT) {
      continue
    }

    const group = byFormat.get(format)
    const position = { row: cell.row, column: cell.column }

    if (group) {
      group.push(position)
    } else {
      byFormat.set(format, [position])
    }
  }

  const entries = [...byFormat.entries()]
  const shown = entries.slice(0, options.numberFormatsMax)

  return {
    lines: shown.map(([format, positions]) => {
      const ranges = formatRanges(cellsToRanges(positions))

      return `- ${cleanLine(format, 80)}: `
        + listWithRest(ranges, options.rangesPerItemMax)
    }),
    omitted: entries.length - shown.length,
  }
}

function notReadLine(notRead: SheetNotRead): string | null {
  const parts = [
    notRead.charts > 0 ? plural(notRead.charts, 'chart', 'charts') : null,
    notRead.images > 0 ? plural(notRead.images, 'image', 'images') : null,
    notRead.pivotTables > 0
      ? plural(notRead.pivotTables, 'pivot table', 'pivot tables')
      : null,
    notRead.colorScales > 0
      ? plural(notRead.colorScales, 'color scale', 'color scales')
      : null,
    notRead.dataBars > 0
      ? plural(notRead.dataBars, 'data bar rule', 'data bar rules')
      : null,
    notRead.iconSets > 0
      ? plural(notRead.iconSets, 'icon set rule', 'icon set rules')
      : null,
    notRead.hyperlinks > 0
      ? `${plural(notRead.hyperlinks, 'link', 'links')} (count only)`
      : null,
    (notRead.protectedRanges ?? 0) > 0
      ? `${plural(
        notRead.protectedRanges ?? 0,
        'protected range',
        'protected ranges',
      )} (count only)`
      : null,
  ].filter((part): part is string => part !== null)

  return parts.length > 0 ? `Not read: ${parts.join(', ')}.` : null
}

function frozenText(sheet: WorkbookSheet): string | null {
  const parts: string[] = []

  if (sheet.frozenRows > 0) {
    parts.push(sheet.frozenRows === 1
      ? 'row 1'
      : `rows 1-${sheet.frozenRows}`)
  }

  if (sheet.frozenColumns > 0) {
    parts.push(sheet.frozenColumns === 1
      ? 'column A'
      : `columns A-${columnLetters(sheet.frozenColumns)}`)
  }

  return parts.length > 0 ? `Frozen: ${parts.join(' and ')}.` : null
}

function headingLines(
  sheet: WorkbookSheet,
  options: WorkbookMapOptions,
  missingValues: number,
): string[] {
  const facts: string[] = []

  if (sheet.usedRange) {
    facts.push(`Used range ${cleanLine(sheet.usedRange, 40)}.`)
  }

  const frozen = frozenText(sheet)

  if (frozen) {
    facts.push(frozen)
  }

  if (sheet.visibility === 'hidden') {
    facts.push('Hidden.')
  } else if (sheet.visibility === 'very-hidden') {
    facts.push('Very hidden (only code can show it).')
  }

  const lines = [
    `## Sheet: ${cleanLine(sheet.name, options.sheetNameCharactersMax)}`,
  ]

  if (facts.length > 0) {
    lines.push(facts.join(' '))
  }

  const notRead = notReadLine(sheet.notRead)

  if (notRead) {
    lines.push(notRead)
  }

  if (missingValues > 0) {
    lines.push(missingValues === 1
      ? '1 formula cell has no saved value.'
      : `${missingValues} formula cells have no saved value.`)
  }

  for (const cut of sheet.cuts) {
    lines.push(SHEET_CUT_NOTES[cut]
      .replace('{rows}', String(sheet.rowsRead ?? 0))
      .replace('{column}', columnLetters(options.columnsMax)))
  }

  return lines
}

function section(title: string, lines: readonly string[]): string | null {
  return lines.length > 0 ? `### ${title}\n${lines.join('\n')}` : null
}

function moreNote(count: number, singular: string, many: string): string[] {
  if (count <= 0) {
    return []
  }

  return [`(${count} more ${count === 1 ? singular : many} not shown)`]
}

function valueLinesOf(
  sheet: WorkbookSheet,
  options: WorkbookMapOptions,
): { header: string, lines: Array<{ row: number, text: string }> } {
  const rows = new Map<number, WorkbookCell[]>()
  let widest = 0

  for (const cell of sheet.cells) {
    if (cell.value === undefined || cell.value.length === 0) {
      continue
    }

    if (cell.column > options.columnsMax) {
      continue
    }

    widest = Math.max(widest, cell.column)

    const row = rows.get(cell.row)

    if (row) {
      row.push(cell)
    } else {
      rows.set(cell.row, [cell])
    }
  }

  const header = ['#']

  for (let column = 1; column <= widest; column += 1) {
    header.push(columnLetters(column))
  }

  const lines = [...rows.entries()]
    .sort(([first], [second]) => first - second)
    .map(([row, cells]) => {
      cells.sort((first, second) => first.column - second.column)

      const fields = [String(row)]

      for (const cell of cells) {
        while (fields.length < cell.column) {
          fields.push('')
        }

        if (fields.length > cell.column) {
          continue
        }

        fields.push(escapeCsvField(
          cleanLine(cell.value ?? '', options.cellCharactersMax),
        ))
      }

      return { row, text: fields.join(',') }
    })

  return { header: header.join(','), lines }
}

function formulaNotes(
  hiddenLines: number,
  cellsNotGrouped: number,
  options: WorkbookMapOptions,
): string[] {
  const notes: string[] = []

  if (hiddenLines > 0) {
    notes.push(
      `(${plural(hiddenLines, 'more formula line', 'more formula lines')} `
      + 'not shown; cells they cover may look typed in)',
    )
  }

  if (cellsNotGrouped > 0) {
    notes.push(
      `(${plural(cellsNotGrouped, 'formula cell', 'formula cells')} not `
      + `shown: at most ${options.formulaCellsMax} are read per sheet, so `
      + 'these cells may look typed in)',
    )
  }

  return notes
}

function renderSheet(
  sheet: WorkbookSheet,
  options: WorkbookMapOptions,
  cuts: Set<WorkbookMapCut>,
): SheetText {
  const formulas = formulaLines(sheet.cells, options)
  const values = valueLinesOf(sheet, options)
  const blocks: string[] = [
    headingLines(sheet, options, formulas.missingValues).join('\n'),
  ]
  const shownFormulas = formulas.lines.slice(0, options.formulaPatternsMax)
  const hiddenFormulas = formulas.lines.length - shownFormulas.length

  if (hiddenFormulas > 0 || formulas.cellsNotGrouped > 0) {
    cuts.add('formula_patterns')
  }

  const validations = renderValidations(sheet.validations, options)

  if (validations.omitted > 0) {
    cuts.add('validations')
  }

  const conditional = renderConditionalRules(sheet.conditionalRules, options)

  if (conditional.omitted > 0) {
    cuts.add('conditional_rules')
  }

  const formats = numberFormatLines(sheet.cells, options)

  if (formats.omitted > 0) {
    cuts.add('number_formats')
  }

  const merged = sheet.mergedRanges.map(range => cleanLine(range, 40))

  if (merged.length > options.mergedRangesMax) {
    cuts.add('merged_cells')
  }

  const notes = sheet.notes.slice(0, options.notesMax).map((note) => {
    return `- ${cleanLine(note.address, 16)}: `
      + quote(note.text, options.noteCharactersMax)
  })

  if (sheet.notes.length > options.notesMax) {
    cuts.add('notes')
  }

  const sections = [
    section('Formulas', [
      ...shownFormulas.map(line => lineText(line, options)),
      ...formulaNotes(hiddenFormulas, formulas.cellsNotGrouped, options),
    ]),
    section('Dropdowns and validation', [
      ...validations.lines,
      ...moreNote(validations.omitted, 'rule', 'rules'),
    ]),
    section('Conditional formatting', [
      ...conditional.lines,
      ...moreNote(conditional.omitted, 'rule line', 'rule lines'),
    ]),
    section('Number formats', [
      ...formats.lines,
      ...moreNote(formats.omitted, 'format', 'formats'),
    ]),
    section('Merged cells', merged.length > 0
      ? [listWithRest(merged, options.mergedRangesMax)]
      : []),
    section('Notes', [
      ...notes,
      ...moreNote(sheet.notes.length - notes.length, 'note', 'notes'),
    ]),
  ]

  for (const block of sections) {
    if (block) {
      blocks.push(block)
    }
  }

  const isEmpty = blocks.length === 1
    && values.lines.length === 0
    && sheet.cuts.length === 0

  if (isEmpty) {
    blocks[0] = `${blocks[0]}\nEmpty.`
  }

  return {
    structure: blocks.join(SEPARATOR),
    valueLines: values.lines,
    valueHeader: values.header,
    formulaCount: formulas.count,
    patternCount: shownFormulas.length,
    validationCount: sheet.validations.length,
    conditionalCount: sheet.conditionalRules.length,
    cellCount: sheet.cells.filter(cell => !!cell.value).length,
  }
}

function namesBlock(
  model: WorkbookModel,
  options: WorkbookMapOptions,
  cuts: Set<WorkbookMapCut>,
): string | null {
  const notRead = model.namesNotRead ?? 0

  if (model.names.length === 0 && notRead === 0) {
    return null
  }

  const shown = model.names.slice(0, options.namesMax)
  const hidden = model.names.length - shown.length + notRead

  if (hidden > 0) {
    cuts.add('names')
  }

  const lines = shown.map((name) => {
    const scope = name.sheet
      ? ` (only in sheet ${cleanLine(name.sheet, options.sheetNameCharactersMax)})`
      : ''

    return `- ${cleanLine(name.name, NAMED_RANGE_NAME_MAX)}${scope} = `
      + cleanLine(stripEquals(name.refersTo), options.nameCharactersMax)
  })

  return `## Named ranges\n${[
    ...lines,
    ...moreNote(hidden, 'name', 'names'),
  ].join('\n')}`
}

/**
 * Splits `budget` bytes between sheets that need `needs[i]` bytes each, so a
 * small sheet gets all it needs and the rest is shared evenly by the larger
 * ones.
 */
function shareBudget(needs: readonly number[], budget: number): number[] {
  const order = needs
    .map((need, index) => ({ need, index }))
    .sort((first, second) => first.need - second.need)
  const shares = needs.map(() => 0)
  let remaining = Math.max(budget, 0)

  order.forEach(({ need, index }, position) => {
    const fair = Math.floor(remaining / (order.length - position))
    const share = Math.min(need, fair)

    shares[index] = share
    remaining -= share
  })

  return shares
}

function valuesBlock(
  text: SheetText,
  allowance: number,
  summary: WorkbookMapSheetSummary,
  cuts: Set<WorkbookMapCut>,
): string | null {
  if (text.valueLines.length === 0) {
    return null
  }

  const lines = ['### Values', text.valueHeader]
  let used = utf8Length(lines.join('\n')) + 1

  if (used + VALUES_CUT_NOTE_RESERVE > allowance) {
    cuts.add('values')
    summary.rowsNotShown = text.valueLines.length

    return '### Values\n(values not shown: the map size limit was reached; '
      + `${plural(text.valueLines.length, 'row', 'rows')} not shown)`
  }

  let shown = 0

  for (const line of text.valueLines) {
    const bytes = utf8Length(line.text) + 1
    const isLast = shown === text.valueLines.length - 1
    const reserve = isLast ? 0 : VALUES_CUT_NOTE_RESERVE

    if (used + bytes + reserve > allowance) {
      break
    }

    lines.push(line.text)
    used += bytes
    shown += 1
  }

  if (shown < text.valueLines.length) {
    const lastRow = text.valueLines[shown - 1]?.row ?? 0
    const rest = text.valueLines.length - shown

    cuts.add('values')
    summary.valuesCutAfterRow = lastRow
    summary.rowsNotShown = rest
    lines.push(
      `(values cut after row ${lastRow}: `
      + `${plural(rest, 'more row', 'more rows')} not shown)`,
    )
  }

  return lines.join('\n')
}

function cutToBytes(text: string, maxBytes: number): string {
  let bytes = 0
  let index = 0

  while (index < text.length) {
    const code = text.charCodeAt(index)
    const isPair = code >= 0xD800 && code <= 0xDBFF
    const width = code < 0x80 ? 1 : code < 0x800 ? 2 : isPair ? 4 : 3

    if (bytes + width > maxBytes) {
      break
    }

    bytes += width
    index += isPair ? 2 : 1
  }

  return text.slice(0, index)
}

function totalNotRead(sheets: readonly WorkbookSheet[]): SheetNotRead {
  const total = emptyNotRead()

  let protectedRanges = 0

  for (const sheet of sheets) {
    for (const key of Object.keys(total) as Array<keyof SheetNotRead>) {
      total[key] = (total[key] ?? 0) + (sheet.notRead[key] ?? 0)
    }

    protectedRanges += sheet.notRead.protectedRanges ?? 0
  }

  return protectedRanges > 0 ? { ...total, protectedRanges } : total
}

/**
 * Renders a workbook model as the Markdown "workbook map": the title and a
 * legend, named ranges, then per sheet a heading and the structure sections
 * (formulas as fill patterns, dropdowns and validation, conditional
 * formatting, number formats, merged cells, notes) followed by the values.
 * Structure is sized first and values share what is left of `maxBytes`, so a
 * size cut removes value rows and never the structure of a later sheet. Every
 * workbook string is cleaned (control characters, backticks, length) before
 * it is written. The summary says what was counted and what was cut.
 */
export function renderWorkbookMap(
  model: WorkbookModel,
  overrides: Partial<WorkbookMapOptions> = {},
): WorkbookMapResult {
  const options: WorkbookMapOptions = { ...WORKBOOK_MAP_DEFAULTS, ...overrides }
  const cuts = new Set<WorkbookMapCut>()
  const preamble = [WORKBOOK_MAP_TITLE, WORKBOOK_MAP_LEGEND]

  if (model.sheetsTotal > model.sheets.length) {
    cuts.add('sheets')
    preamble.push(
      `[Only the first ${model.sheets.length} of ${model.sheetsTotal} sheets `
      + 'are included.]',
    )
  }

  const names = namesBlock(model, options, cuts)

  if (names) {
    preamble.push(names)
  }

  for (const sheet of model.sheets) {
    for (const cut of sheet.cuts) {
      cuts.add(cut)
    }
  }

  const sheetTexts = model.sheets.map((sheet) => {
    return renderSheet(sheet, options, cuts)
  })
  const sheetSummaries = model.sheets.map((sheet): WorkbookMapSheetSummary => {
    return {
      name: cleanLine(sheet.name, SUMMARY_SHEET_NAME_MAX),
      visibility: sheet.visibility,
    }
  })
  const preambleText = preamble.join(SEPARATOR)
  const markerBytes = utf8Length(WORKBOOK_MAP_TRUNCATION_MARKER) + 2
  const budget = options.maxBytes - markerBytes
  const structureBytes = utf8Length(preambleText) + sheetTexts.reduce(
    (total, text) => total + utf8Length(text.structure) + SEPARATOR.length * 2,
    0,
  )
  const needs = sheetTexts.map((text) => {
    if (text.valueLines.length === 0) {
      return 0
    }

    return text.valueLines.reduce((total, line) => {
      return total + utf8Length(line.text) + 1
    }, utf8Length(text.valueHeader) + 16 + VALUES_CUT_NOTE_RESERVE)
  })
  const allowances = shareBudget(needs, budget - structureBytes)
  const blocks = [preambleText]

  sheetTexts.forEach((text, index) => {
    blocks.push(text.structure)

    const values = valuesBlock(
      text,
      allowances[index] as number,
      sheetSummaries[index] as WorkbookMapSheetSummary,
      cuts,
    )

    if (values) {
      blocks.push(values)
    }
  })

  let output = blocks.join(SEPARATOR)

  if (utf8Length(output) > options.maxBytes) {
    cuts.add('structure')
    output = `${cutToBytes(output, budget)}${SEPARATOR}`
      + WORKBOOK_MAP_TRUNCATION_MARKER
  }

  const summary: WorkbookMapSummary = {
    sheets: model.sheets.length,
    sheetsTotal: model.sheetsTotal,
    hiddenSheets: model.sheets.filter((sheet) => {
      return sheet.visibility !== 'visible'
    }).length,
    cells: sheetTexts.reduce((total, text) => total + text.cellCount, 0),
    formulas: sheetTexts.reduce((total, text) => total + text.formulaCount, 0),
    patterns: sheetTexts.reduce((total, text) => total + text.patternCount, 0),
    validations: sheetTexts.reduce((total, text) => {
      return total + text.validationCount
    }, 0),
    conditionalRules: sheetTexts.reduce((total, text) => {
      return total + text.conditionalCount
    }, 0),
    names: model.names.length,
    bytes: utf8Length(output),
    cut: [...cuts],
    notRead: totalNotRead(model.sheets),
    sheetSummaries,
  }

  return { text: output, summary }
}
