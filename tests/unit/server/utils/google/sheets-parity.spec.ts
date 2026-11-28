import { describe, expect, it } from 'vitest'
import { extractOfficeText } from '@besidka/doc-renderer/extract'
import { renderWorkbookMap } from '@besidka/doc-renderer/workbook-map'
import {
  buildWorkbookModel,
  parseSheetGrid,
  parseSheetsMetadata,
} from '~~/server/utils/google/sheets-model'
import type { SheetGridRead } from '~~/server/utils/google/sheets-model'
import { OFFICE_TEXT_INLINE_MAX_BYTES } from '#shared/utils/office-files'
import { estimateWorkbook } from '../../../../fixtures/documents/extract/workbook-builders'
import {
  estimateGridAnswers,
  estimateMetadata,
} from '../../../../fixtures/google/sheets-estimate'

function sheetsMap(): string {
  const metadata = parseSheetsMetadata(
    estimateMetadata() as Record<string, unknown>,
  )

  expect(metadata).not.toBeNull()

  const answers = estimateGridAnswers()
  const reads = new Map<number, SheetGridRead>()

  for (const sheet of metadata!.sheets) {
    const grid = parseSheetGrid(
      answers[sheet.sheetId] as Record<string, unknown>,
      sheet.sheetId,
      { rows: 1000, columns: 200 },
    )

    reads.set(sheet.sheetId, {
      status: 'read',
      grid: grid!,
      rowsRead: 1000,
      cuts: [],
    })
  }

  return renderWorkbookMap(
    buildWorkbookModel({ metadata: metadata!, reads }),
    { maxBytes: OFFICE_TEXT_INLINE_MAX_BYTES },
  ).text
}

function xlsxMap(): string {
  const result = extractOfficeText(
    estimateWorkbook(),
    'xlsx',
    {},
    { workbookMap: true },
  )

  expect(result.status).toBe('ready')

  return result.text
}

/**
 * The sections the two readers can both express. Dropped from both: the
 * values (the XLSX reader prints the saved raw number, Sheets the displayed
 * text) and the used range (an XLSX `dimension` is optional). Dropped from
 * one side: Excel's whole-number rule (Sheets has only a number rule), the
 * `{array}` line (Sheets writes `ARRAYFORMULA` in one cell and shows the
 * rest as values), and the image count (Sheets does not report images).
 */
function comparable(text: string, side: 'xlsx' | 'sheets'): string {
  const withoutValues = text.replace(
    /\n\n### Values\n[\s\S]*?(?=\n\n## |$)/g,
    '',
  )

  return withoutValues
    .split('\n')
    .map(line => line.replace(/^Used range [A-Z0-9:]+\.\s?/, ''))
    .filter((line) => {
      if (line === '') {
        return true
      }

      const isNumberRule = line.startsWith('- G7:G24: ')
      const isArray = line.startsWith('- ') && line.includes(' {array} ')
      const isSheetsArray = line.startsWith('- D3 =ARRAYFORMULA')

      return !isNumberRule
        && !(side === 'xlsx' && isArray)
        && !(side === 'sheets' && isSheetsArray)
    })
    .join('\n')
    .replace('Not read: 1 chart, 1 image.', 'Not read: 1 chart.')
    .replace(/\n{3,}/g, '\n\n')
}

describe('Google Sheets adapter against the XLSX reader', () => {
  it('writes the same structure for the same workbook', () => {
    expect(comparable(sheetsMap(), 'sheets'))
      .toBe(comparable(xlsxMap(), 'xlsx'))
  })
})
