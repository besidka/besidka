import type { CellPosition } from './address.ts'
import {
  isInsideBounds,
  relativeFormulaHash,
  shiftBounds,
  shiftTokens,
  tokenizeFormula,
} from './formula.ts'
import type { ShiftBounds, TokenizedFormula } from './formula.ts'

export type FormulaPatternKind = 'down' | 'right' | 'block' | 'single'

export interface FormulaPattern {
  kind: FormulaPatternKind
  start: CellPosition
  end: CellPosition
  formula: string
  exceptions: Array<{ from: CellPosition, to: CellPosition }>
}

export interface FormulaInput {
  row: number
  column: number
  formula: string
}

/**
 * A shared formula as Excel stores it: one master cell with the text and
 * the cells that copy it. Every follower's formula is the master shifted by
 * the distance between them, so the group is already a fill pattern.
 */
export interface SharedFormulaGroup {
  master: FormulaInput
  followers: readonly CellPosition[]
}

export interface SharedFormulaCopies {
  master: CellPosition
  cells: CellPosition[]
}

export interface CollapseOptions {
  exceptionsMax: number
  cellsMax?: number
  workCharactersMax?: number
  derivedCharactersMax?: number
}

export interface CollapseResult {
  patterns: FormulaPattern[]
  copies: SharedFormulaCopies[]
  cellsNotGrouped: number
  firstRowNotGrouped?: number
  workCharacters: number
  derivedCharacters: number
}

type Axis = 'down' | 'right'

interface Run {
  axis: Axis
  members: number[]
  gaps: Array<[number, number]>
}

interface GroupState {
  masterEntry: number
  formula: string
  tokens: TokenizedFormula | null
  bounds: ShiftBounds | null
  copies: CellPosition[]
}

const GAP_MAX = 2
const NO_GROUP = -1
export const COLLAPSE_CELLS_MAX = 200_000
export const COLLAPSE_WORK_CHARACTERS_MAX = 24 * 1024 * 1024
export const DERIVED_CHARACTERS_MAX = 512 * 1024

/**
 * The formula cells of one sheet in compact columns: positions, the text of
 * each plain formula (shared with the model, never copied) and a group
 * index per shared-formula member. No token arrays are kept per cell.
 */
class EntryTable {
  readonly rows: Int32Array
  readonly columns: Int32Array
  readonly groups: Int32Array
  readonly used: Uint8Array
  readonly formulas: Array<string | undefined>
  count = 0

  constructor(capacity: number) {
    this.rows = new Int32Array(capacity)
    this.columns = new Int32Array(capacity)
    this.groups = new Int32Array(capacity)
    this.used = new Uint8Array(capacity)
    this.formulas = new Array(capacity)
  }

  add(row: number, column: number, formula: string | undefined, group: number) {
    const index = this.count

    this.rows[index] = row
    this.columns[index] = column
    this.groups[index] = group
    this.formulas[index] = formula
    this.count += 1

    return index
  }
}

class WorkBudget {
  private remaining: number
  spent = 0

  constructor(characters: number) {
    this.remaining = characters
  }

  spend(characters: number): boolean {
    if (this.remaining < characters) {
      this.remaining = 0

      return false
    }

    this.remaining -= characters
    this.spent += characters

    return true
  }
}

function positionOf(table: EntryTable, entry: number, axis: Axis): number {
  return axis === 'down' ? table.rows[entry] as number : table.columns[entry] as number
}

function lineOf(table: EntryTable, entry: number, axis: Axis): number {
  return axis === 'down' ? table.columns[entry] as number : table.rows[entry] as number
}

/**
 * Builds runs over the entry table. A plain cell joins a run only when the
 * run's formula shifted to it gives its exact text; only the run's master
 * is tokenized, and a candidate costs one shifted string. Members of one
 * shared group are copies of each other by definition; a plain cell and a
 * group meet when the group's master text is exactly the plain formula
 * shifted, checked once per run.
 */
class Collapser {
  private readonly table: EntryTable
  private readonly states: GroupState[]
  private readonly exceptionsMax: number
  private readonly work: WorkBudget
  private masterEntry = -1
  private masterTokens: TokenizedFormula | null = null
  private masterBounds: ShiftBounds | null = null
  private groupMatches = new Map<number, boolean>()

  constructor(
    table: EntryTable,
    states: GroupState[],
    exceptionsMax: number,
    work: WorkBudget,
  ) {
    this.table = table
    this.states = states
    this.exceptionsMax = exceptionsMax
    this.work = work
  }

  private formulaOf(entry: number): string {
    const group = this.table.groups[entry] as number

    return group === NO_GROUP
      ? this.table.formulas[entry] as string
      : (this.states[group] as GroupState).formula
  }

  private originOf(entry: number): number {
    const group = this.table.groups[entry] as number

    return group === NO_GROUP
      ? entry
      : (this.states[group] as GroupState).masterEntry
  }

  private tokensOf(master: number): TokenizedFormula {
    if (this.masterEntry !== master || this.masterTokens === null) {
      const formula = this.formulaOf(master)

      this.work.spend(formula.length)
      this.masterEntry = master
      this.masterTokens = tokenizeFormula(formula)
      this.masterBounds = shiftBounds(this.masterTokens)
      this.groupMatches = new Map()
    }

    return this.masterTokens
  }

  private shiftFrom(origin: number, target: number, tokens: TokenizedFormula) {
    const { table } = this

    return shiftTokens(
      tokens,
      (table.rows[target] as number) - (table.rows[origin] as number),
      (table.columns[target] as number) - (table.columns[origin] as number),
    )
  }

  private matchesGroup(master: number, group: number): boolean {
    const tokens = this.tokensOf(master)
    const known = this.groupMatches.get(group)

    if (known !== undefined) {
      return known
    }

    const state = this.states[group] as GroupState
    const matches = this.work.spend(state.formula.length)
      && this.shiftFrom(master, state.masterEntry, tokens) === state.formula

    this.groupMatches.set(group, matches)

    return matches
  }

  private isCopy(master: number, entry: number): boolean {
    const { table } = this
    const masterGroup = table.groups[master] as number
    const entryGroup = table.groups[entry] as number

    if (masterGroup !== NO_GROUP && masterGroup === entryGroup) {
      return true
    }

    if (masterGroup !== NO_GROUP && entryGroup !== NO_GROUP) {
      return false
    }

    if (entryGroup !== NO_GROUP) {
      if (!this.matchesGroup(master, entryGroup)) {
        return false
      }

      return this.masterBounds !== null && isInsideBounds(
        this.masterBounds,
        (table.rows[entry] as number) - (table.rows[master] as number),
        (table.columns[entry] as number) - (table.columns[master] as number),
      )
    }

    const formula = this.formulaOf(master)

    if (!this.work.spend(formula.length)) {
      return false
    }

    const origin = this.originOf(master)

    return this.shiftFrom(origin, entry, this.tokensOf(master))
      === table.formulas[entry]
  }

  private findRun(
    line: Int32Array,
    startIndex: number,
    axis: Axis,
  ): Run | null {
    const { table } = this
    const master = line[startIndex] as number
    const members = [master]
    const gaps: Array<[number, number]> = []
    let lastPosition = positionOf(table, master, axis)
    let best: { memberCount: number, gapCount: number } | null = null
    let exceptionCount = 0

    for (let index = startIndex + 1; index < line.length; index += 1) {
      const entry = line[index] as number
      const position = positionOf(table, entry, axis)
      const gap = position - lastPosition - 1

      if (lineOf(table, entry, axis) !== lineOf(table, master, axis)) {
        break
      }

      if (gap > GAP_MAX) {
        break
      }

      if (table.used[entry] || gap < 0 || !this.isCopy(master, entry)) {
        continue
      }

      if (gap > 0) {
        gaps.push([lastPosition + 1, position - 1])
        exceptionCount += gap
      }

      members.push(entry)
      lastPosition = position

      if (gaps.length > this.exceptionsMax) {
        break
      }

      if (exceptionCount <= members.length) {
        best = { memberCount: members.length, gapCount: gaps.length }
      }
    }

    if (best === null) {
      return null
    }

    return {
      axis,
      members: members.slice(0, best.memberCount),
      gaps: gaps.slice(0, best.gapCount),
    }
  }

  collectRuns(axis: Axis): Run[] {
    const { table } = this
    const order: number[] = []

    for (let entry = 0; entry < table.count; entry += 1) {
      if (!table.used[entry]) {
        order.push(entry)
      }
    }

    const line = Int32Array.from(order).sort((first, second) => {
      return lineOf(table, first, axis) - lineOf(table, second, axis)
        || positionOf(table, first, axis) - positionOf(table, second, axis)
    })
    const runs: Run[] = []

    for (let index = 0; index < line.length; index += 1) {
      const master = line[index] as number

      if (table.used[master]) {
        continue
      }

      const run = this.findRun(line, index, axis)

      if (run === null) {
        continue
      }

      for (const member of run.members) {
        table.used[member] = 1
      }

      runs.push(run)
    }

    return runs
  }
}

function cellAt(
  table: EntryTable,
  master: number,
  axis: Axis,
  position: number,
): CellPosition {
  return axis === 'down'
    ? { row: position, column: table.columns[master] as number }
    : { row: table.rows[master] as number, column: position }
}

function positionAt(table: EntryTable, entry: number): CellPosition {
  return {
    row: table.rows[entry] as number,
    column: table.columns[entry] as number,
  }
}

function runPattern(
  table: EntryTable,
  run: Run,
  formula: string,
): FormulaPattern {
  const master = run.members[0] as number
  const last = run.members[run.members.length - 1] as number

  return {
    kind: run.axis,
    start: positionAt(table, master),
    end: positionAt(table, last),
    formula,
    exceptions: run.gaps.map(([from, to]) => {
      return {
        from: cellAt(table, master, run.axis, from),
        to: cellAt(table, master, run.axis, to),
      }
    }),
  }
}

function gapSignature(run: Run): string {
  return run.gaps.map(([from, to]) => `${from}-${to}`).join(',')
}

/**
 * Joins down runs of one shared formula that cover the same rows (and skip
 * the same rows) in neighboring columns into one block, so a formula filled
 * across a rectangle is one line instead of one line per column.
 */
function joinBlocks(table: EntryTable, runs: Run[]): FormulaPattern[] {
  const keyed = runs.map((run) => {
    const first = run.members[0] as number
    const last = run.members[run.members.length - 1] as number

    return {
      run,
      top: table.rows[first] as number,
      bottom: table.rows[last] as number,
      column: table.columns[first] as number,
      signature: gapSignature(run),
    }
  }).sort((first, second) => {
    return first.top - second.top
      || first.bottom - second.bottom
      || first.signature.localeCompare(second.signature)
      || first.column - second.column
  })
  const patterns: FormulaPattern[] = []
  let index = 0

  while (index < keyed.length) {
    const head = keyed[index] as typeof keyed[number]
    let next = index + 1

    while (next < keyed.length) {
      const candidate = keyed[next] as typeof keyed[number]
      const previous = keyed[next - 1] as typeof keyed[number]

      if (
        candidate.top !== head.top
        || candidate.bottom !== head.bottom
        || candidate.signature !== head.signature
        || candidate.column !== previous.column + 1
      ) {
        break
      }

      next += 1
    }

    const pattern = runPattern(table, head.run, '')

    if (next - index > 1) {
      const right = (keyed[next - 1] as typeof keyed[number]).column

      pattern.kind = 'block'
      pattern.end = { row: head.bottom, column: right }
      pattern.exceptions = pattern.exceptions.map(({ from, to }) => {
        return { from, to: { row: to.row, column: right } }
      })
    }

    patterns.push(pattern)
    index = next
  }

  return patterns
}

function singlePattern(
  table: EntryTable,
  entry: number,
  formula: string,
): FormulaPattern {
  const position = positionAt(table, entry)

  return {
    kind: 'single',
    start: position,
    end: { ...position },
    formula,
    exceptions: [],
  }
}

function patternCells(pattern: FormulaPattern): CellPosition[] {
  const cells: CellPosition[] = []

  for (let row = pattern.start.row; row <= pattern.end.row; row += 1) {
    for (
      let column = pattern.start.column;
      column <= pattern.end.column;
      column += 1
    ) {
      const isException = pattern.exceptions.some(({ from, to }) => {
        return row >= from.row && row <= to.row
          && column >= from.column && column <= to.column
      })

      if (!isException) {
        cells.push({ row, column })
      }
    }
  }

  return cells
}

/**
 * Gives a pattern of a shared group its first cell's formula: the master's
 * own text, or the master shifted once to the first cell, charged against
 * `derived`. Both corners are checked against the master's shift bounds, so
 * every cell in between is known to shift. Null when the pattern has to be
 * listed as copies instead.
 */
function headFormula(
  group: GroupState,
  table: EntryTable,
  pattern: FormulaPattern,
  derived: WorkBudget,
): string | null {
  const masterRow = table.rows[group.masterEntry] as number
  const masterColumn = table.columns[group.masterEntry] as number
  const rowDelta = pattern.start.row - masterRow
  const columnDelta = pattern.start.column - masterColumn

  if (rowDelta === 0 && columnDelta === 0) {
    return group.formula
  }

  if (group.tokens === null) {
    group.tokens = tokenizeFormula(group.formula)
    group.bounds = shiftBounds(group.tokens)
  }

  const { bounds } = group
  const isValid = bounds !== null
    && isInsideBounds(bounds, rowDelta, columnDelta)
    && isInsideBounds(
      bounds,
      pattern.end.row - masterRow,
      pattern.end.column - masterColumn,
    )

  if (!isValid || !derived.spend(group.formula.length)) {
    return null
  }

  return shiftTokens(group.tokens, rowDelta, columnDelta)
}

interface TableBuild {
  table: EntryTable
  states: GroupState[]
  skipped: number
  firstRow?: number
}

function addTable(
  normal: readonly FormulaInput[],
  groups: readonly SharedFormulaGroup[],
  cellsMax: number,
): TableBuild {
  const total = groups.reduce((sum, group) => {
    return sum + group.followers.length + 1
  }, normal.length)
  const table = new EntryTable(Math.min(total, cellsMax))
  const states: GroupState[] = []
  let skipped = 0
  let firstRow: number | undefined

  const skip = (row: number): void => {
    skipped += 1
    firstRow = firstRow === undefined ? row : Math.min(firstRow, row)
  }

  for (const input of normal) {
    if (table.count >= cellsMax) {
      skip(input.row)
      continue
    }

    table.add(input.row, input.column, input.formula, NO_GROUP)
  }

  for (const group of groups) {
    if (table.count >= cellsMax) {
      skip(group.master.row)
      skipped += group.followers.length
      continue
    }

    const groupIndex = states.length
    const masterEntry = table.add(
      group.master.row,
      group.master.column,
      undefined,
      groupIndex,
    )

    states.push({
      masterEntry,
      formula: group.master.formula,
      tokens: null,
      bounds: null,
      copies: [],
    })

    for (const follower of group.followers) {
      if (table.count >= cellsMax) {
        skip(follower.row)
        continue
      }

      table.add(follower.row, follower.column, undefined, groupIndex)
    }
  }

  return { table, states, skipped, firstRow }
}

function comparePositions(first: CellPosition, second: CellPosition): number {
  return first.row - second.row || first.column - second.column
}

interface GroupKey {
  index: number
  master: FormulaInput
}

/**
 * Joins shared groups whose masters are fill copies of each other (Excel
 * starts a new group after a cell that breaks a fill, such as a subtotal
 * row), so the fill reads as one pattern. The earliest master leads; the
 * other masters become followers. Only one master's key is kept per group,
 * and a candidate is tokenized again to check its text.
 */
function joinGroups(
  groups: readonly SharedFormulaGroup[],
  work: WorkBudget,
): SharedFormulaGroup[] {
  const ordered = [...groups].sort((first, second) => {
    return comparePositions(first.master, second.master)
  })
  const joined: Array<{ master: FormulaInput, followers: CellPosition[] }> = []
  const byKey = new Map<number, GroupKey[]>()

  for (const group of ordered) {
    const { master } = group

    if (!work.spend(master.formula.length)) {
      joined.push({ master, followers: [...group.followers] })
      continue
    }

    const key = relativeFormulaHash(
      tokenizeFormula(master.formula),
      master.row,
      master.column,
    )
    const candidates = byKey.get(key) ?? []
    const match = candidates.find((candidate) => {
      const formula = candidate.master.formula

      return work.spend(formula.length * 2)
        && shiftTokens(
          tokenizeFormula(formula),
          master.row - candidate.master.row,
          master.column - candidate.master.column,
        ) === master.formula
    })

    if (match) {
      const target = joined[match.index] as typeof joined[number]

      target.followers.push({ row: master.row, column: master.column })
      target.followers.push(...group.followers)
      continue
    }

    candidates.push({ index: joined.length, master })
    byKey.set(key, candidates)
    joined.push({ master, followers: [...group.followers] })
  }

  return joined
}

function comparePatterns(
  first: FormulaPattern,
  second: FormulaPattern,
): number {
  return comparePositions(first.start, second.start)
}

/**
 * Groups the formulas of one sheet into fill patterns. Plain formulas form a
 * run down a column (then, for what is left, along a row) only from cells
 * whose formula is exactly the first cell's formula shifted by the distance
 * between them, so expanding a pattern gives back every original text.
 * Shared formulas are patterns already: their members form runs without any
 * text being derived, runs over the same rows join into blocks, and only
 * the first cell of a pattern that does not start at the master gets its
 * text derived, within `derivedCharactersMax`. Cells inside a run that are
 * not copies are listed as exceptions; a gap of more than two such cells
 * ends the run, and a run never has more exception cells than copies.
 * At most `cellsMax` formula cells enter; tokenizing and comparing stop at
 * `workCharactersMax` characters, after which the rest stay single.
 */
export function collapseSheetFormulas(
  normal: readonly FormulaInput[],
  groups: readonly SharedFormulaGroup[],
  options: CollapseOptions,
): CollapseResult {
  const work = new WorkBudget(
    options.workCharactersMax ?? COLLAPSE_WORK_CHARACTERS_MAX,
  )
  const { table, states, skipped, firstRow } = addTable(
    normal,
    joinGroups(groups, work),
    options.cellsMax ?? COLLAPSE_CELLS_MAX,
  )
  const derived = new WorkBudget(
    options.derivedCharactersMax ?? DERIVED_CHARACTERS_MAX,
  )
  const collapser = new Collapser(table, states, options.exceptionsMax, work)

  const runs = [...collapser.collectRuns('down'), ...collapser.collectRuns('right')]
  const patterns: FormulaPattern[] = []
  const groupRuns = new Map<number, Run[]>()

  for (const run of runs) {
    const master = run.members[0] as number
    const group = table.groups[master] as number

    if (group === NO_GROUP) {
      patterns.push(runPattern(table, run, table.formulas[master] as string))
      continue
    }

    const list = groupRuns.get(group)

    if (list) {
      list.push(run)
    } else {
      groupRuns.set(group, [run])
    }
  }

  const groupPatterns: Array<{ group: number, pattern: FormulaPattern }> = []

  for (const [group, list] of groupRuns) {
    const downRuns = list.filter(run => run.axis === 'down')
    const rightRuns = list.filter(run => run.axis === 'right')

    for (const pattern of joinBlocks(table, downRuns)) {
      groupPatterns.push({ group, pattern })
    }

    for (const run of rightRuns) {
      groupPatterns.push({ group, pattern: runPattern(table, run, '') })
    }
  }

  for (let entry = 0; entry < table.count; entry += 1) {
    if (table.used[entry]) {
      continue
    }

    const group = table.groups[entry] as number

    if (group === NO_GROUP) {
      const formula = table.formulas[entry] as string

      patterns.push(singlePattern(table, entry, formula))
    } else {
      groupPatterns.push({ group, pattern: singlePattern(table, entry, '') })
    }
  }

  groupPatterns.sort((first, second) => {
    return comparePatterns(first.pattern, second.pattern)
  })

  for (const { group, pattern } of groupPatterns) {
    const state = states[group] as GroupState
    const formula = headFormula(state, table, pattern, derived)

    if (formula === null) {
      state.copies.push(...patternCells(pattern))
      continue
    }

    pattern.formula = formula
    patterns.push(pattern)
  }

  const copies = states
    .filter(state => state.copies.length > 0)
    .map((state) => {
      return {
        master: positionAt(table, state.masterEntry),
        cells: state.copies,
      }
    })

  return {
    patterns: patterns.sort(comparePatterns),
    copies,
    cellsNotGrouped: skipped,
    firstRowNotGrouped: firstRow,
    workCharacters: work.spent,
    derivedCharacters: derived.spent,
  }
}

/**
 * Groups plain formulas into fill patterns; see `collapseSheetFormulas`.
 */
export function collapseFormulas(
  inputs: readonly FormulaInput[],
  exceptionsMax: number,
): FormulaPattern[] {
  return collapseSheetFormulas(inputs, [], {
    exceptionsMax,
    cellsMax: Number.MAX_SAFE_INTEGER,
  }).patterns
}

/**
 * Every cell a pattern stands for, with the formula it gives that cell. The
 * inverse of `collapseFormulas`, used by the round-trip tests and by readers
 * of the model that want the cells back.
 */
export function expandPattern(
  pattern: FormulaPattern,
): Array<FormulaInput | { row: number, column: number, formula: null }> {
  const tokens = tokenizeFormula(pattern.formula)

  return patternCells(pattern).map(({ row, column }) => {
    const rowDelta = row - pattern.start.row
    const columnDelta = column - pattern.start.column

    return {
      row,
      column,
      formula: rowDelta === 0 && columnDelta === 0
        ? pattern.formula
        : shiftTokens(tokens, rowDelta, columnDelta),
    }
  })
}
