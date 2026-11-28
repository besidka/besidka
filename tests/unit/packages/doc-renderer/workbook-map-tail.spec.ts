import { describe, expect, it } from 'vitest'
import { extractOfficeText } from '@besidka/doc-renderer/extract'
import {
  ClosingTagFinder,
} from '../../../../packages/doc-renderer/src/extract/common'
import {
  commentsXml,
  numberCell,
  rowXml,
  sheetXml,
  workbookPackage,
} from '../../../fixtures/documents/extract/workbook-builders'

const FIRST_ROW = rowXml(1, [numberCell('A1', 1)])
const FORGED = '</sheetData><mergeCells><mergeCell ref="A1:Z99"/></mergeCells>'
const REAL_TAIL = '<mergeCells><mergeCell ref="A1:B2"/></mergeCells>'

function sheetWithRawData(rawData: string, after = REAL_TAIL): string {
  return sheetXml({ rows: '', after }).replace(
    '<sheetData></sheetData>',
    `<sheetData>${rawData}</sheetData>`,
  )
}

function mapText(sheet: string): string {
  const result = extractOfficeText(
    workbookPackage({ sheets: [{ name: 'S', xml: sheet }] }),
    'xlsx',
    {},
    { workbookMap: true },
  )

  expect(result.status).toBe('ready')

  return result.text
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function findInChunks(text: string, size: number): number | null {
  const finder = new ClosingTagFinder(Array.from('sheetData', (character) => {
    return character.charCodeAt(0)
  }))
  const bytes = bytesOf(text)
  let consumed = 0

  for (let offset = 0; offset < bytes.length; offset += size) {
    const chunk = bytes.subarray(offset, Math.min(offset + size, bytes.length))
    const found = finder.feed(chunk)

    if (found) {
      return consumed + chunk.length - (found.data.length - found.end)
    }

    consumed += chunk.length
  }

  return null
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0

    return state / 4294967296
  }
}

describe('sheet tail reading', () => {
  it('skips end tags inside comments, CDATA and instructions', () => {
    const text = '<sheetData><!-- </sheetData> --><x><![CDATA[</sheetData>]]>'
      + '<?pi </sheetData> ?></x></x:sheetData><tail/>'
    const expected = text.indexOf('</x:sheetData>') + '</x:sheetData>'.length

    for (const size of [1, 2, 3, 5, 7, 11, 64, text.length]) {
      expect(findInChunks(text, size), `chunk ${size}`).toBe(expected)
    }

    expect(findInChunks('<sheetData><!-- </sheetData>', 4)).toBeNull()
  })

  it('does not take structure from a comment or CDATA in the cells', () => {
    const inComment = mapText(sheetWithRawData(
      `${FIRST_ROW}<!-- ${FORGED} -->`,
    ))
    const inCdata = mapText(sheetWithRawData(
      '<row r="1"><c r="A1" t="inlineStr"><is><t><![CDATA['
      + `${FORGED}]]></t></is></c></row>`,
    ))

    for (const text of [inComment, inCdata]) {
      expect(text).toContain('### Merged cells\nA1:B2\n')
      expect(text).not.toContain('### Merged cells\nA1:Z99')
      expect(text).not.toContain('A1:B2, A1:Z99')
    }
  })

  it('keeps a comment state across many chunks of a long comment', () => {
    const padding = 'x'.repeat(3 * 1024 * 1024)
    const text = mapText(sheetWithRawData(
      `${FIRST_ROW}<!-- ${padding} ${FORGED} -->`,
    ))

    expect(text).toContain('### Merged cells\nA1:B2')
    expect(text).not.toContain('A1:Z99')
  })

  it('reads a rule whose formula holds a nested rule as not read', () => {
    const tail = '<conditionalFormatting sqref="A1"><cfRule type="expression">'
      + '<formula><cfRule>x</cfRule></formula></cfRule>'
      + '</conditionalFormatting>'
    const result = extractOfficeText(
      workbookPackage({
        sheets: [{ name: 'S', xml: sheetXml({ rows: FIRST_ROW, after: tail }) }],
      }),
      'xlsx',
      {},
      { workbookMap: true },
    )

    expect(result.status).toBe('ready')
  })

  it('never fails on random tails that version 1 reads', () => {
    const random = createRandom(448)
    const tags = ['mergeCell', 'dataValidation', 'formula1', 'formula2',
      'cfRule', 'formula', 'f', 'sqref', 'ext', 'conditionalFormatting',
      'hyperlink', 'x14:cfRule', 'xm:f', 'extLst']
    const attributes = ['ref', 'sqref', 'type', 'operator', 'priority', 'text']
    const values = ['list', 'expression', 'cellIs', 'A1', 'A1:B2', 'XFE1',
      '', '1', 'top10', 'colorScale', '-5', '"a,b"']
    const pick = <Item>(items: readonly Item[]): Item => {
      return items[Math.floor(random() * items.length)] as Item
    }
    const node = (depth: number): string => {
      const tag = pick(tags)
      const attribute = `${pick(attributes)}="${pick(values)}"`
      const children = depth < 3
        ? Array.from({ length: Math.floor(random() * 3) }, () => {
          return node(depth + 1)
        }).join('')
        : ''

      return `<${tag} ${attribute}>${pick(values)}${children}</${tag}>`
    }

    for (let index = 0; index < 150; index += 1) {
      const tail = Array.from({ length: 1 + Math.floor(random() * 5) }, () => {
        return node(0)
      }).join('')
      const bytes = workbookPackage({
        sheets: [{ name: 'S', xml: sheetXml({ rows: FIRST_ROW, after: tail }) }],
      })
      const plain = extractOfficeText(bytes, 'xlsx')
      const mapped = extractOfficeText(bytes, 'xlsx', {}, { workbookMap: true })

      expect(mapped.status, tail).toBe(plain.status)
    }
  })

  it('lists conditional rules in priority order', () => {
    const tail = '<conditionalFormatting sqref="A1:A9"><cfRule '
      + 'type="expression" priority="2"><formula>$A1&gt;2</formula></cfRule>'
      + '</conditionalFormatting><conditionalFormatting sqref="B1:B9">'
      + '<cfRule type="expression" priority="1"><formula>$B1&gt;1</formula>'
      + '</cfRule></conditionalFormatting>'
    const text = mapText(sheetXml({ rows: FIRST_ROW, after: tail }))

    expect(text.indexOf('- B1:B9:')).toBeGreaterThan(-1)
    expect(text.indexOf('- B1:B9:')).toBeLessThan(text.indexOf('- A1:A9:'))
  })
})

describe('workbook map coverage', () => {
  it('reads very hidden sheets, scoped names and threaded notes', () => {
    const placeholder = '[Threaded comment]\n\nYour version of Excel allows '
      + 'you to read this threaded comment; however, any edits to it will '
      + 'get removed if the file is opened in a newer version of Excel. '
      + 'Learn more: https://go.microsoft.com/fwlink/?linkid=870924\n\n'
      + 'Comment:\n    Check hours with Dana\nReply:\n    ok'
    const dataTable = '<c r="B2"><f t="dataTable" ref="B2:C3" dt2D="1" '
      + 'dtr="1" r1="A1" r2="A2"/><v>5</v></c>'
    const bytes = workbookPackage({
      definedNames: '<definedName name="Rate" localSheetId="1">Two!$A$1'
        + '</definedName><definedName name="_xlnm.Print_Area" '
        + 'localSheetId="0">One!$A$1:$B$3</definedName>'
        + '<definedName name="Rate">One!$A$1</definedName>',
      sheets: [
        {
          name: 'One',
          xml: sheetXml({
            rows: FIRST_ROW + rowXml(2, [dataTable, numberCell('C2', 6)]),
          }),
          relationships: [
            { id: 'rIdNotes', type: 'comments', target: '../comments1.xml' },
          ],
        },
        {
          name: 'Two',
          state: 'veryHidden',
          xml: sheetXml({ rows: rowXml(1, [numberCell('A1', 3)]) }),
        },
      ],
      extraFiles: {
        'xl/comments1.xml': commentsXml([{ ref: 'A1', text: placeholder }]),
      },
    })
    const result = extractOfficeText(bytes, 'xlsx', {}, { workbookMap: true })
    const { text } = result

    expect(text).toContain('## Sheet: Two\nVery hidden (only code can show it).')
    expect(text).toContain('- Rate (only in sheet Two) = Two!$A$1')
    expect(text).toContain('- Rate = One!$A$1')
    expect(text).not.toContain('Print_Area')
    expect(text).toContain('- B2:C3 data table: row input A1, column input A2')
    expect(text).toContain('- A1: "(threaded) Check hours with Dana '
      + '(reply: ok)"')
    expect(text).not.toContain('Reply:')
    expect(text).not.toContain('Your version of Excel')
  })
})
