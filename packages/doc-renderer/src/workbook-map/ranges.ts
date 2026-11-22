import { rangeAddress } from './address.ts'
import type { CellPosition, CellRange } from './address.ts'

function compareRanges(first: CellRange, second: CellRange): number {
  return first.top - second.top || first.left - second.left
}

/**
 * Covers a set of cells with rectangles: vertical runs per column first, then
 * runs with the same rows in neighboring columns are joined. Every cell is
 * covered exactly once, and no cell outside the set is.
 */
export function cellsToRanges(cells: readonly CellPosition[]): CellRange[] {
  const byColumn = new Map<number, number[]>()

  for (const cell of cells) {
    const rows = byColumn.get(cell.column)

    if (rows) {
      rows.push(cell.row)
    } else {
      byColumn.set(cell.column, [cell.row])
    }
  }

  const runs: CellRange[] = []

  for (const [column, rows] of byColumn) {
    rows.sort((first, second) => first - second)

    let top = rows[0] as number
    let bottom = top

    for (let index = 1; index <= rows.length; index += 1) {
      const row = rows[index]

      if (row === bottom) {
        continue
      }

      if (row === bottom + 1) {
        bottom = row
        continue
      }

      runs.push({ top, left: column, bottom, right: column })

      if (row !== undefined) {
        top = row
        bottom = row
      }
    }
  }

  runs.sort((first, second) => {
    return first.top - second.top
      || first.bottom - second.bottom
      || first.left - second.left
  })

  const joined: CellRange[] = []

  for (const run of runs) {
    const last = joined[joined.length - 1]

    if (
      last
      && last.top === run.top
      && last.bottom === run.bottom
      && last.right + 1 === run.left
    ) {
      last.right = run.right
      continue
    }

    joined.push({ ...run })
  }

  return joined.sort(compareRanges)
}

export function formatRanges(ranges: readonly CellRange[]): string[] {
  return ranges.map(rangeAddress)
}

/**
 * Joins range texts with commas, at most `max` of them, and says how many
 * more there are.
 */
export function listWithRest(items: readonly string[], max: number): string {
  if (items.length <= max) {
    return items.join(', ')
  }

  return `${items.slice(0, max).join(', ')} and ${items.length - max} more`
}
