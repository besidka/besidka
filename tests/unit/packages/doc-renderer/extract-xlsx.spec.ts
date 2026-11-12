import { describe, expect, it } from 'vitest'
import { extractOfficeText } from '@besidka/doc-renderer/extract'
import {
  SAMPLE_SPECS,
  renderSpec,
  worksheetXml,
  xlsxPackage,
} from '../../../fixtures/documents/extract/builders'

const DATE_STYLES = `
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd hh:mm"/>
    <numFmt numFmtId="165" formatCode="0.00&quot; days&quot;"/>
  </numFmts>
  <cellXfs count="6">
    <xf numFmtId="0"/>
    <xf numFmtId="14"/>
    <xf numFmtId="164"/>
    <xf numFmtId="165"/>
    <xf numFmtId="46"/>
    <xf numFmtId="2"/>
  </cellXfs>
`

function numberCell(
  reference: string,
  value: string | number,
  style = 0,
): string {
  return `<c r="${reference}" s="${style}"><v>${value}</v></c>`
}

function stringCell(reference: string, index: number): string {
  return `<c r="${reference}" t="s"><v>${index}</v></c>`
}

function inlineCell(reference: string, text: string): string {
  return `<c r="${reference}" t="inlineStr"><is><t>${text}</t></is></c>`
}

function row(index: number, cells: string): string {
  return `<row r="${index}">${cells}</row>`
}

function columnLetters(column: number): string {
  const first = column >= 26
    ? String.fromCharCode(64 + Math.floor(column / 26))
    : ''

  return `${first}${String.fromCharCode(65 + (column % 26))}`
}

function readyText(bytes: Uint8Array): string {
  const result = extractOfficeText(bytes, 'xlsx')

  expect(result.status).toBe('ready')

  return result.text
}

describe('extractOfficeText: xlsx from the renderer', () => {
  it('writes one CSV section per sheet with ISO dates', async () => {
    const bytes = await renderSpec(SAMPLE_SPECS.xlsx)
    const result = extractOfficeText(bytes, 'xlsx')

    expect(result.status).toBe('ready')
    expect(result.text).toBe([
      '## Sheet: Sales',
      '',
      'Day,Region,Units',
      '2026-07-01,Харків,5',
      '2026-07-02,"Lviv, West",7',
      '',
      '## Sheet: Costs',
      '',
      'Item',
      'Rent',
    ].join('\n'))
    expect(result.stats.sheets).toBe(2)
    expect(result.stats.sheetsTotal).toBe(2)
    expect(result.truncated).toBe(false)
  })
})

describe('extractOfficeText: xlsx cells', () => {
  it('resolves shared strings, inline strings and cached formula values', () => {
    const sheet = worksheetXml(
      row(1, stringCell('A1', 0) + stringCell('B1', 1) + stringCell('C1', 2))
      + row(
        2,
        inlineCell('A2', 'inline')
        + '<c r="B2" t="str"><f>A2&amp;"!"</f><v>inline!</v></c>'
        + '<c r="C2"><f>SUM(1,2)</f><v>3</v></c>',
      )
      + row(3, '<c r="A3"><f>NOW()</f></c>' + numberCell('B3', '0.25')),
    )
    const bytes = xlsxPackage([{ name: 'Data', xml: sheet }], {
      sharedStrings: ['Name', 'Quote "x"', 'Line\nbreak'],
    })

    expect(readyText(bytes)).toBe([
      '## Sheet: Data',
      '',
      'Name,"Quote ""x""","Line\nbreak"',
      'inline,inline!,3',
      ',0.25',
    ].join('\n'))
  })

  it('skips phonetic runs and joins rich text runs', () => {
    const sheet = worksheetXml(row(1, stringCell('A1', 0)))
    const withRich = xlsxPackage([{ name: 'Rich', xml: sheet }], {
      sharedStrings: [],
      options: {
        extraFiles: {
          'xl/sharedStrings.xml': '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            + '<si><r><t>Hel</t></r><r><t>lo</t></r><rPh sb="0" eb="1"><t>ハロー</t></rPh></si></sst>',
        },
      },
    })

    expect(readyText(withRich)).toBe('## Sheet: Rich\n\nHello')
  })

  it('renders dates from built-in and custom formats and handles 1904', () => {
    const sheet = worksheetXml(
      row(
        1,
        numberCell('A1', 46204, 1)
        + numberCell('B1', 46204.5, 2)
        + numberCell('C1', 46204, 3)
        + numberCell('D1', 0.75, 4)
        + numberCell('E1', 46204, 5),
      ),
    )
    const standard = xlsxPackage([{ name: 'D', xml: sheet }], {
      stylesXml: DATE_STYLES,
    })
    const shifted = xlsxPackage([{ name: 'D', xml: sheet }], {
      stylesXml: DATE_STYLES,
      date1904: true,
    })

    expect(readyText(standard)).toBe(
      '## Sheet: D\n\n2026-07-01,2026-07-01T12:00:00,46204,18:00:00,46204',
    )
    expect(readyText(shifted)).toBe(
      '## Sheet: D\n\n2030-07-02,2030-07-02T12:00:00,46204,18:00:00,46204',
    )
  })

  it('renders booleans, errors and ISO date cells as written', () => {
    const sheet = worksheetXml(
      row(
        1,
        '<c r="A1" t="b"><v>1</v></c>'
        + '<c r="B1" t="b"><v>0</v></c>'
        + '<c r="C1" t="e"><v>#DIV/0!</v></c>'
        + '<c r="D1" t="d"><v>2026-01-02T03:04:05Z</v></c>',
      ),
    )

    expect(readyText(xlsxPackage([{ name: 'T', xml: sheet }]))).toBe(
      '## Sheet: T\n\nTRUE,FALSE,#DIV/0!,2026-01-02T03:04:05Z',
    )
  })

  it('writes merged cells once and keeps column positions', () => {
    const sheet = worksheetXml(
      row(1, inlineCell('B1', 'Merged title'))
      + row(2, inlineCell('A2', 'left') + inlineCell('D2', 'right'))
      + row(3, '<c r="A3"/>')
      + row(7, inlineCell('C7', 'late')),
      '<mergeCells count="1"><mergeCell ref="B1:D1"/></mergeCells>',
    )

    expect(readyText(xlsxPackage([{ name: 'M', xml: sheet }]))).toBe([
      '## Sheet: M',
      '',
      ',Merged title',
      'left,,,right',
      ',,late',
    ].join('\n'))
  })

  it('does not allocate for a lone cell at the last column', () => {
    const sheet = worksheetXml(
      row(1, inlineCell('A1', 'first') + inlineCell('XFD1048576', 'far away')),
    )
    const result = extractOfficeText(
      xlsxPackage([{ name: 'Far', xml: sheet }]),
      'xlsx',
    )

    expect(result.text).toBe('## Sheet: Far\n\nfirst\n\n[Truncated: columns beyond 200 are not included.]')
    expect(result.stats.truncations).toEqual(['columns_limit'])
  })

  it('reports workbooks without cell values as empty', () => {
    const sheet = worksheetXml('<row r="1"><c r="A1" s="1"/></row>')
    const result = extractOfficeText(
      xlsxPackage([{ name: 'Blank', xml: sheet }]),
      'xlsx',
    )

    expect(result.status).toBe('empty')
    expect(result.text).toBe('')
  })

  it('reads sheets in workbook order, not in file order', () => {
    const first = worksheetXml(row(1, inlineCell('A1', 'one')))
    const second = worksheetXml(row(1, inlineCell('A1', 'two')))
    const bytes = xlsxPackage([
      { name: 'Second tab', xml: second },
      { name: 'First tab', xml: first },
    ])

    expect(readyText(bytes)).toBe(
      '## Sheet: Second tab\n\ntwo\n\n## Sheet: First tab\n\none',
    )
  })
})

describe('extractOfficeText: xlsx limits', () => {
  it('stops at 1000 rows and says so', () => {
    const rows = Array.from({ length: 1500 }, (_value, index) => {
      return row(index + 1, numberCell(`A${index + 1}`, index + 1))
    }).join('')
    const result = extractOfficeText(
      xlsxPackage([{ name: 'Long', xml: worksheetXml(rows) }]),
      'xlsx',
    )
    const lines = result.text.split('\n')

    expect(result.status).toBe('ready')
    expect(result.truncated).toBe(true)
    expect(result.stats.truncations).toEqual(['rows_limit'])
    expect(lines).toContain('1000')
    expect(lines).not.toContain('1001')
    expect(result.text).toContain('more than 1000 rows')
  })

  it('grows the inflated prefix until 1000 rows are read', () => {
    const rows = Array.from({ length: 1200 }, (_value, rowIndex) => {
      return row(rowIndex + 1, Array.from({ length: 60 }, (_cell, column) => {
        return numberCell(
          `${columnLetters(column)}${rowIndex + 1}`,
          `${rowIndex}${column}.125`,
        )
      }).join(''))
    }).join('')
    const sheetXml = worksheetXml(rows)

    expect(sheetXml.length).toBeGreaterThan(1024 * 1024)

    const result = extractOfficeText(
      xlsxPackage([{ name: 'Wide', xml: sheetXml }]),
      'xlsx',
      { textBytesMax: 10 * 1024 * 1024 },
    )

    expect(result.status).toBe('ready')
    expect(result.stats.truncations).toEqual(['rows_limit'])
    expect(result.text).toContain('9990.125')
    expect(result.text.split('\n').filter(line => line.includes(',')))
      .toHaveLength(1000)
  })

  it('stops at 200 columns', () => {
    const cells = Array.from({ length: 250 }, (_value, column) => {
      return inlineCell(`${columnLetters(column)}1`, `c${column}`)
    }).join('')
    const result = extractOfficeText(
      xlsxPackage([{ name: 'Wide', xml: worksheetXml(row(1, cells)) }]),
      'xlsx',
    )

    expect(result.text).toContain('c199')
    expect(result.text).not.toContain('c200')
    expect(result.stats.truncations).toEqual(['columns_limit'])
  })

  it('cuts cells at 2000 characters', () => {
    const sheet = worksheetXml(
      row(1, inlineCell('A1', 'x'.repeat(2500)) + stringCell('B1', 0)),
    )
    const result = extractOfficeText(
      xlsxPackage([{ name: 'Big', xml: sheet }], {
        sharedStrings: ['y'.repeat(3000)],
      }),
      'xlsx',
    )
    const [, , dataRow] = result.text.split('\n')
    const [inline, shared] = dataRow?.split(',') ?? []

    expect(inline?.length).toBe(2001)
    expect(shared?.length).toBe(2001)
    expect(result.stats.truncations).toContain('cell_chars_limit')
    expect(result.truncated).toBe(true)
  })

  it('reads at most 50 sheets', () => {
    const sheets = Array.from({ length: 55 }, (_value, index) => {
      return {
        name: `S${index + 1}`,
        xml: worksheetXml(row(1, inlineCell('A1', `value ${index + 1}`))),
      }
    })
    const result = extractOfficeText(xlsxPackage(sheets), 'xlsx')

    expect(result.stats.sheets).toBe(50)
    expect(result.stats.sheetsTotal).toBe(55)
    expect(result.stats.truncations).toEqual(['sheets_limit'])
    expect(result.text).toContain('## Sheet: S50')
    expect(result.text).not.toContain('## Sheet: S51')
    expect(result.text).toContain('only the first 50 of 55 sheets')
  })

  it('stops at the text limit with the marker inside the limit', () => {
    const rows = Array.from({ length: 900 }, (_value, index) => {
      return row(index + 1, inlineCell(`A${index + 1}`, `Рядок ${index}`))
    }).join('')
    const result = extractOfficeText(
      xlsxPackage([{ name: 'Cap', xml: worksheetXml(rows) }]),
      'xlsx',
      { textBytesMax: 1000 },
    )

    expect(new TextEncoder().encode(result.text).length)
      .toBeLessThanOrEqual(1000)
    expect(result.truncated).toBe(true)
    expect(result.stats.truncations).toContain('text_limit')
    expect(result.text).toMatch(/\[Truncated: .+\]$/)
  })

  it('keeps the rows it could read when a sheet exceeds the part cap', () => {
    const rows = Array.from({ length: 900 }, (_value, index) => {
      return row(index + 1, inlineCell(`A${index + 1}`, `Рядок ${index}`))
    }).join('')
    const result = extractOfficeText(
      xlsxPackage([{ name: 'Cut', xml: worksheetXml(rows) }]),
      'xlsx',
      { partBytesMax: 6000 },
    )

    expect(result.status).toBe('ready')
    expect(result.stats.truncations).toContain('part_limit')
    expect(result.text).toContain('Рядок 0')
    expect(result.text).not.toContain('Рядок 899')
    expect(result.text).not.toContain('�')
  })

  it('stops reading sheets once the cell cap is reached', () => {
    const rows = Array.from({ length: 50 }, (_value, index) => {
      return row(index + 1, numberCell(`A${index + 1}`, index))
    }).join('')
    const result = extractOfficeText(
      xlsxPackage([{ name: 'Cells', xml: worksheetXml(rows) }]),
      'xlsx',
      { cellsMax: 10 },
    )

    expect(result.stats.truncations).toEqual(['cells_limit'])
    expect(result.text.split('\n').filter(line => /^\d+$/.test(line)))
      .toHaveLength(10)
  })
})
