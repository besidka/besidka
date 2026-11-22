import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSpreadsheetMap } from '~~/server/utils/google/sheets-read'
import type { SheetsReservation } from '~~/server/utils/google/sheets-rate-limit'
import { columnLetters } from '@besidka/doc-renderer/workbook-map'
import {
  SPREADSHEET_ID,
  gridAnswer,
} from '../../../../fixtures/google/sheets-estimate'
import type { CellMap } from '../../../../fixtures/google/sheets-estimate'

const MEBIBYTE = 1024 * 1024
const LIST_RULE = {
  condition: {
    type: 'ONE_OF_RANGE',
    values: [{ userEnteredValue: '=Lists!$B$6:$B$45' }],
  },
  strict: true,
  showCustomUi: true,
}

function heavyCells(columns: number, rows: number): CellMap {
  const cells: CellMap = {}

  for (let row = 2; row <= rows + 1; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const address = `${columnLetters(column)}${row}`
      const isFormula = column % 3 !== 0

      cells[address] = {
        ...(isFormula
          ? {
            formula: `ARRAYFORMULA(IFERROR(INDEX(Parameters!$D$7:$D$11, `
              + `MATCH(${columnLetters(column)}${row - 1}, `
              + `Parameters!$B$7:$B$11, 0)) * ${column}, ""))`,
            shown: `${row * column}.00`,
          }
          : { text: `Item ${row}-${column} with a longer description` }),
        format: '#,##0.00',
        note: row % 50 === 0 ? 'Check this row with the owner.' : undefined,
        validation: LIST_RULE,
      }
    }
  }

  return cells
}

function metadataFor(titles: string[]) {
  return {
    spreadsheetId: SPREADSHEET_ID,
    sheets: titles.map((title, index) => ({
      properties: {
        sheetId: index + 1,
        title,
        gridProperties: { rowCount: 1000, columnCount: 40 },
      },
    })),
  }
}

function grant() {
  return vi.fn(async (count: number): Promise<SheetsReservation> => ({
    granted: count,
    limitedBy: null,
    kvUnavailable: false,
  }))
}

function createFetch(bodies: Map<string, string>, metadata: object) {
  const metadataText = JSON.stringify(metadata)

  return vi.fn(async (input: string) => {
    const range = new URL(input).searchParams.get('ranges')

    await new Promise((resolve) => {
      setTimeout(resolve, 1)
    })

    return new Response(range ? bodies.get(range.split('!')[0] as string) : metadataText)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a heavy spreadsheet', () => {
  it('prints one line for a dropdown rule repeated on 5,000 cells',
    async () => {
      const cells = heavyCells(40, 130)
      const bodies = new Map([[
        'Estimate',
        JSON.stringify(gridAnswer(1, 'Estimate', cells)),
      ]])
      const result = await readSpreadsheetMap({
        spreadsheetId: SPREADSHEET_ID,
        accessToken: 'token',
        reserve: grant(),
        fetchImpl: createFetch(bodies, metadataFor(['Estimate'])),
      })

      if (!result.ok) {
        throw new Error('expected a map')
      }

      const dropdownLines = result.text.split('\n').filter((line) => {
        return line.includes(': dropdown of the values in ')
      })

      expect(Object.keys(cells).length).toBeGreaterThan(5000)
      expect(dropdownLines).toEqual([
        '- A2:AN131: dropdown of the values in Lists!$B$6:$B$45 (strict)',
      ])
      expect(result.text).toContain('ARRAYFORMULA(IFERROR(INDEX(')
    })

  it.each([
    {
      label: '4 MiB',
      rows: 270,
      minMebibytes: 3.5,
      maxMebibytes: 5,
      requests: 12,
    },
    {
      label: '8 MiB',
      rows: 500,
      minMebibytes: 6.2,
      maxMebibytes: 8,
      requests: 13,
    },
  ])('reads a $label tab and ten small tabs in bounded CPU, and in bounded '
    + 'heap when run with NODE_OPTIONS=--expose-gc pnpm vitest run '
    + 'tests/unit/server/utils/google/sheets-weight.spec.ts',
  async ({ rows, minMebibytes, maxMebibytes, requests, label }) => {
    const titles = ['Estimate', ...Array.from({ length: 10 }, (_item, index) => {
      return `Small${index + 1}`
    })]
    const bodies = new Map<string, string>()

    bodies.set('Estimate', JSON.stringify(
      gridAnswer(1, 'Estimate', heavyCells(40, rows)),
    ))

    titles.slice(1).forEach((title, index) => {
      bodies.set(title, JSON.stringify(
        gridAnswer(index + 2, title, heavyCells(8, 60)),
      ))
    })

    const bigBytes = (bodies.get('Estimate') as string).length
    const smallBytes = (bodies.get('Small1') as string).length
    const fetchImpl = createFetch(bodies, metadataFor(titles))
    const hasGc = typeof globalThis.gc === 'function'

    globalThis.gc?.()

    const baseline = process.memoryUsage().heapUsed
    let peak = baseline
    const realParse = JSON.parse
    const sample = () => {
      peak = Math.max(peak, process.memoryUsage().heapUsed)
    }

    vi.spyOn(JSON, 'parse').mockImplementation((...args) => {
      const parsed = realParse(...args as [string])

      sample()

      return parsed
    })

    const cpuStart = process.cpuUsage()
    const result = await readSpreadsheetMap({
      spreadsheetId: SPREADSHEET_ID,
      accessToken: 'token',
      reserve: grant(),
      fetchImpl,
    })
    const cpu = process.cpuUsage(cpuStart)

    sample()

    expect(result.ok).toBe(true)
    expect(result.diagnostics.tabsNotRead).toBe(0)
    expect(bigBytes).toBeGreaterThan(minMebibytes * MEBIBYTE)
    expect(bigBytes).toBeLessThan(maxMebibytes * MEBIBYTE)
    expect(smallBytes).toBeLessThan(MEBIBYTE)
    expect(result.diagnostics.requests).toBe(requests)
    expect((cpu.user + cpu.system) / 1000).toBeLessThan(5000)

    if (process.env.SHEETS_WEIGHT_REPORT) {
      process.stdout.write(
        `sheets-weight ${label}: tab ${(bigBytes / MEBIBYTE).toFixed(2)} MiB,`
        + ` heap above baseline ${((peak - baseline) / MEBIBYTE).toFixed(1)}`
        + ` MiB, gc ${hasGc}, cpu ${((cpu.user + cpu.system) / 1000)
          .toFixed(0)} ms\n`,
      )
    }

    if (hasGc) {
      expect((peak - baseline) / MEBIBYTE).toBeLessThan(64)
    }
  })
})
