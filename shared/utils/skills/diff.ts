import {
  SKILL_DIFF_MAX_LINES,
  SKILL_DIFF_TOTAL_CELL_BUDGET,
} from '#shared/utils/skills-policy'

export const SKILL_DIFF_CONTEXT_LINES = 3
export const SKILL_DIFF_FILE_MAX_LINES = 5000
export const SKILL_DIFF_FILE_CELL_BUDGET = 2_000_000

export type SkillDiffLineKind = 'add' | 'remove' | 'context' | 'gap'

export interface SkillDiffLine {
  kind: SkillDiffLineKind
  text: string
}

export type SkillFileDiffStatus = 'added' | 'removed' | 'modified'

export interface SkillFileDiff {
  path: string
  status: SkillFileDiffStatus
  added: number
  removed: number
  lines: SkillDiffLine[]
  truncated: boolean
}

export interface SkillDiff {
  files: SkillFileDiff[]
  added: number
  removed: number
  unchanged: number
  truncated: boolean
}

type EditKind = 'add' | 'remove' | 'same'

interface Edit {
  kind: EditKind
  text: string
}

function splitLines(text: string): string[] {
  if (text === '') {
    return []
  }

  const lines = text.split('\n')

  if (lines.at(-1) === '') {
    lines.pop()
  }

  return lines
}

function replaceAll(before: string[], after: string[]): Edit[] {
  return [
    ...before.map((text): Edit => {
      return { kind: 'remove', text }
    }),
    ...after.map((text): Edit => {
      return { kind: 'add', text }
    }),
  ]
}

interface CellBudget {
  remaining: number
}

function diffMiddle(
  before: string[],
  after: string[],
  budget: CellBudget,
): Edit[] | null {
  const rows = before.length
  const columns = after.length

  if (rows === 0 || columns === 0) {
    return replaceAll(before, after)
  }

  const cells = (rows + 1) * (columns + 1)

  if (cells > SKILL_DIFF_FILE_CELL_BUDGET) {
    return replaceAll(before, after)
  }

  if (cells > budget.remaining) {
    return null
  }

  budget.remaining -= cells

  const width = columns + 1
  const table = new Uint32Array((rows + 1) * width)

  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      table[row * width + column] = before[row] === after[column]
        ? table[(row + 1) * width + column + 1]! + 1
        : Math.max(
          table[(row + 1) * width + column]!,
          table[row * width + column + 1]!,
        )
    }
  }

  const edits: Edit[] = []
  let row = 0
  let column = 0

  while (row < rows && column < columns) {
    if (before[row] === after[column]) {
      edits.push({ kind: 'same', text: before[row]! })
      row++
      column++
    } else if (
      table[(row + 1) * width + column]! >= table[row * width + column + 1]!
    ) {
      edits.push({ kind: 'remove', text: before[row]! })
      row++
    } else {
      edits.push({ kind: 'add', text: after[column]! })
      column++
    }
  }

  while (row < rows) {
    edits.push({ kind: 'remove', text: before[row++]! })
  }

  while (column < columns) {
    edits.push({ kind: 'add', text: after[column++]! })
  }

  return edits
}

function computeEdits(
  before: string[],
  after: string[],
  budget: CellBudget,
): Edit[] | null {
  let prefix = 0

  while (
    prefix < before.length
    && prefix < after.length
    && before[prefix] === after[prefix]
  ) {
    prefix++
  }

  let suffix = 0

  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++
  }

  const middle = diffMiddle(
    before.slice(prefix, before.length - suffix),
    after.slice(prefix, after.length - suffix),
    budget,
  )

  if (middle === null) {
    return null
  }

  return [
    ...before.slice(0, prefix).map((text): Edit => {
      return { kind: 'same', text }
    }),
    ...middle,
    ...before.slice(before.length - suffix).map((text): Edit => {
      return { kind: 'same', text }
    }),
  ]
}

function toHunkLines(edits: Edit[]): SkillDiffLine[] {
  const keep = new Array<boolean>(edits.length).fill(false)

  edits.forEach((edit, index) => {
    if (edit.kind === 'same') {
      return
    }

    const first = Math.max(0, index - SKILL_DIFF_CONTEXT_LINES)
    const last = Math.min(edits.length - 1, index + SKILL_DIFF_CONTEXT_LINES)

    for (let position = first; position <= last; position++) {
      keep[position] = true
    }
  })

  const lines: SkillDiffLine[] = []
  let skipped = 0

  edits.forEach((edit, index) => {
    if (!keep[index]) {
      skipped++

      return
    }

    if (skipped > 0) {
      lines.push({
        kind: 'gap',
        text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}`,
      })
      skipped = 0
    }

    lines.push({
      kind: edit.kind === 'same' ? 'context' : edit.kind,
      text: edit.text,
    })
  })

  if (skipped > 0) {
    lines.push({
      kind: 'gap',
      text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}`,
    })
  }

  return lines
}

function diffOneFile(input: {
  path: string
  before: string | null
  after: string | null
  budget: CellBudget
}): SkillFileDiff | null {
  const beforeLines = splitLines(input.before ?? '')
  const afterLines = splitLines(input.after ?? '')
  const status: SkillFileDiffStatus = input.before === null
    ? 'added'
    : input.after === null ? 'removed' : 'modified'

  if (input.before === input.after) {
    return null
  }

  const countsOnly: SkillFileDiff = {
    path: input.path,
    status,
    added: afterLines.length,
    removed: beforeLines.length,
    lines: [],
    truncated: true,
  }
  const tooLarge = beforeLines.length > SKILL_DIFF_FILE_MAX_LINES
    || afterLines.length > SKILL_DIFF_FILE_MAX_LINES

  if (tooLarge) {
    return countsOnly
  }

  const edits = computeEdits(beforeLines, afterLines, input.budget)

  if (edits === null) {
    return countsOnly
  }

  return {
    path: input.path,
    status,
    added: edits.filter((edit) => {
      return edit.kind === 'add'
    }).length,
    removed: edits.filter((edit) => {
      return edit.kind === 'remove'
    }).length,
    lines: toHunkLines(edits),
    truncated: false,
  }
}

/**
 * A per-file line diff of two file sets (path to text), bounded twice: a file
 * with more than 5,000 lines on either side is reported by counts only, and
 * the lines of all files together stop at `SKILL_DIFF_MAX_LINES`, after which
 * files are listed with counts and no lines. Output is hunks with three
 * lines of context and a gap marker, so a one-line change in a long file is
 * a few lines.
 */
export function diffSkillFiles(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
  maxLines = SKILL_DIFF_MAX_LINES,
): SkillDiff {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort()
  const files: SkillFileDiff[] = []
  let unchanged = 0
  let remaining = maxLines
  const budget: CellBudget = { remaining: SKILL_DIFF_TOTAL_CELL_BUDGET }
  let truncated = false

  for (const path of paths) {
    const diff = diffOneFile({
      path,
      before: before.get(path) ?? null,
      after: after.get(path) ?? null,
      budget,
    })

    if (!diff) {
      unchanged++

      continue
    }

    if (diff.lines.length > remaining) {
      diff.lines = diff.lines.slice(0, remaining)
      diff.truncated = true
    }

    remaining -= diff.lines.length
    truncated = truncated || diff.truncated
    files.push(diff)
  }

  return {
    files,
    added: files.reduce((total, file) => {
      return total + file.added
    }, 0),
    removed: files.reduce((total, file) => {
      return total + file.removed
    }, 0),
    unchanged,
    truncated,
  }
}
