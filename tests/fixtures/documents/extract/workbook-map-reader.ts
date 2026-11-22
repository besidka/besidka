import {
  cellAddress,
  parseRange,
  shiftFormula,
} from '@besidka/doc-renderer/workbook-map'

const EXCEPT_SEPARATOR = ' · except '

export function formulaLines(text: string, sheetName: string): string[] {
  const start = text.indexOf(`## Sheet: ${sheetName}\n`)

  if (start === -1) {
    return []
  }

  const nextSheet = text.indexOf('\n## Sheet: ', start + 1)
  const sheetText = text.slice(start, nextSheet === -1 ? undefined : nextSheet)
  const formulas = sheetText.indexOf('### Formulas\n')

  if (formulas === -1) {
    return []
  }

  const end = sheetText.indexOf('\n\n', formulas)

  return sheetText.slice(formulas, end === -1 ? undefined : end)
    .split('\n')
    .slice(1)
    .filter(line => line.startsWith('- '))
}

/**
 * Expands printed formula lines back into cells the way the map's legend
 * tells a reader to: the first cell keeps the printed formula, every other
 * cell of an arrow line gets it shifted by its distance, cells after
 * "except" are skipped. Array and copy lines are ignored.
 */
export function expandFormulaLines(lines: string[]): Map<string, string> {
  const cells = new Map<string, string>()

  for (const line of lines) {
    const body = line.slice(2)

    if (body.includes(' {array} ') || body.includes(': copies of')) {
      continue
    }

    const exceptAt = body.lastIndexOf(EXCEPT_SEPARATOR)
    const main = exceptAt === -1 ? body : body.slice(0, exceptAt)
    const exceptions = exceptAt === -1
      ? []
      : body.slice(exceptAt + EXCEPT_SEPARATOR.length).split(', ').map((item) => {
        return parseRange(item)
      })
    let separator = ' ='

    if (main.includes(' ↓ =')) {
      separator = ' ↓ ='
    } else if (main.includes(' → =')) {
      separator = ' → ='
    }

    const separatorAt = main.indexOf(separator)
    const bounds = parseRange(main.slice(0, separatorAt))
    const formula = main.slice(separatorAt + separator.length)

    if (!bounds) {
      throw new Error(`Unreadable formula line: ${line}`)
    }

    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      for (let column = bounds.left; column <= bounds.right; column += 1) {
        const isException = exceptions.some((item) => {
          return item !== null
            && row >= item.top && row <= item.bottom
            && column >= item.left && column <= item.right
        })

        if (isException) {
          continue
        }

        const isFirst = row === bounds.top && column === bounds.left
        const shifted = isFirst
          ? formula
          : shiftFormula(formula, row - bounds.top, column - bounds.left)

        cells.set(cellAddress(row, column), shifted ?? '<not shiftable>')
      }
    }
  }

  return cells
}
