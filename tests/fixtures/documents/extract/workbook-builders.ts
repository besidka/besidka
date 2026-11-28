import {
  MAIN_CONTENT_TYPES,
  escapeXml,
  plainZip,
  relationshipsXml,
} from './builders'

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS_SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_RELATIONSHIPS
  = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main'
const NS_XM = 'http://schemas.microsoft.com/office/excel/2006/main'
const NS_CONTENT_TYPES
  = 'http://schemas.openxmlformats.org/package/2006/content-types'

export interface WorkbookSheetInput {
  name: string
  state?: 'hidden' | 'veryHidden'
  xml: string
  relationships?: Array<{ id: string, type: string, target: string }>
}

export interface WorkbookInput {
  sheets: WorkbookSheetInput[]
  definedNames?: string
  sharedStrings?: string[]
  stylesXml?: string
  extraFiles?: Record<string, string>
}

export function columnName(column: number): string {
  let remaining = column
  let text = ''

  while (remaining > 0) {
    const rest = (remaining - 1) % 26

    text = String.fromCharCode(65 + rest) + text
    remaining = Math.floor((remaining - 1) / 26)
  }

  return text
}

export function textCell(reference: string, text: string, style = 0): string {
  const styleAttribute = style ? ` s="${style}"` : ''

  return `<c r="${reference}" t="inlineStr"${styleAttribute}><is><t>${
    escapeXml(text)
  }</t></is></c>`
}

export function numberCell(
  reference: string,
  value: number | string,
  style = 0,
): string {
  const styleAttribute = style ? ` s="${style}"` : ''

  return `<c r="${reference}"${styleAttribute}><v>${value}</v></c>`
}

export interface FormulaCellOptions {
  style?: number
  shared?: { si: number, ref?: string }
  array?: string
  string?: boolean
}

export function formulaCell(
  reference: string,
  formula: string,
  value: number | string = 0,
  options: FormulaCellOptions = {},
): string {
  const styleAttribute = options.style ? ` s="${options.style}"` : ''
  const typeAttribute = options.string ? ' t="str"' : ''
  let formulaXml = `<f>${escapeXml(formula)}</f>`

  if (options.shared) {
    const ref = options.shared.ref ? ` ref="${options.shared.ref}"` : ''

    formulaXml = options.shared.ref
      ? `<f t="shared"${ref} si="${options.shared.si}">${escapeXml(formula)}</f>`
      : `<f t="shared" si="${options.shared.si}"/>`
  } else if (options.array) {
    formulaXml = `<f t="array" ref="${options.array}">${escapeXml(formula)}</f>`
  }

  return `<c r="${reference}"${styleAttribute}${typeAttribute}>${formulaXml}<v>${value}</v></c>`
}

export function rowXml(index: number, cells: string[]): string {
  return `<row r="${index}">${cells.join('')}</row>`
}

export function sheetXml(parts: {
  dimension?: string
  pane?: { rows: number, columns: number }
  rows: string
  after?: string
}): string {
  const dimension = parts.dimension ? `<dimension ref="${parts.dimension}"/>` : ''
  const pane = parts.pane
    ? '<sheetViews><sheetView workbookViewId="0"><pane '
    + `xSplit="${parts.pane.columns}" ySplit="${parts.pane.rows}" `
    + `topLeftCell="${columnName(parts.pane.columns + 1)}${parts.pane.rows + 1}" `
    + 'activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'
    : ''

  return `${XML_HEADER}<worksheet xmlns="${NS_SHEET}" xmlns:r="${NS_RELATIONSHIPS}" `
    + `xmlns:x14="${NS_X14}" xmlns:xm="${NS_XM}">${dimension}${pane}`
    + `<sheetData>${parts.rows}</sheetData>${parts.after ?? ''}</worksheet>`
}

export function x14ListValidation(source: string, sqref: string): string {
  return '<extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}">'
    + '<x14:dataValidations count="1"><x14:dataValidation type="list" '
    + 'allowBlank="1" showInputMessage="1" showErrorMessage="1">'
    + `<x14:formula1><xm:f>${escapeXml(source)}</xm:f></x14:formula1>`
    + `<xm:sqref>${sqref}</xm:sqref></x14:dataValidation>`
    + '</x14:dataValidations></ext></extLst>'
}

export function commentsXml(
  notes: Array<{ ref: string, text: string }>,
): string {
  return `${XML_HEADER}<comments xmlns="${NS_SHEET}"><authors><author>Author</author>`
    + '</authors><commentList>'
    + notes.map((note) => {
      return `<comment ref="${note.ref}" authorId="0"><text><r><t xml:space="preserve">${
        escapeXml(note.text)
      }</t></r></text></comment>`
    }).join('')
    + '</commentList></comments>'
}

export function drawingRelationshipsXml(
  charts: number,
  images: number,
): string {
  const relationships = [
    ...Array.from({ length: charts }, (_value, index) => {
      return { id: `rIdC${index}`, type: 'chart', target: `../charts/chart${index + 1}.xml` }
    }),
    ...Array.from({ length: images }, (_value, index) => {
      return { id: `rIdI${index}`, type: 'image', target: `../media/image${index + 1}.png` }
    }),
  ]

  return relationshipsXml(relationships)
}

/**
 * Writes an XLSX package with what the workbook map reads: sheet states,
 * defined names, sheet relationships (comments, drawings) and extra parts.
 */
export function workbookPackage(input: WorkbookInput): Uint8Array {
  const relationships = input.sheets.map((_sheet, index) => {
    return {
      id: `rId${index + 1}`,
      type: 'worksheet',
      target: `worksheets/sheet${index + 1}.xml`,
    }
  })

  if (input.sharedStrings) {
    relationships.push({ id: 'rId100', type: 'sharedStrings', target: 'sharedStrings.xml' })
  }

  if (input.stylesXml) {
    relationships.push({ id: 'rId101', type: 'styles', target: 'styles.xml' })
  }

  const files: Record<string, string> = {
    '[Content_Types].xml': `${XML_HEADER}<Types xmlns="${NS_CONTENT_TYPES}">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + `<Override PartName="/xl/workbook.xml" ContentType="${MAIN_CONTENT_TYPES.xlsx}"/>`
      + '</Types>',
    '_rels/.rels': `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="${NS_RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/>`
      + '</Relationships>',
    'xl/workbook.xml': `${XML_HEADER}<workbook xmlns="${NS_SHEET}" xmlns:r="${NS_RELATIONSHIPS}">`
      + '<workbookPr/><sheets>'
      + input.sheets.map((sheet, index) => {
        const state = sheet.state ? ` state="${sheet.state}"` : ''

        return `<sheet name="${escapeXml(sheet.name).replace(/'/g, '&apos;')}" sheetId="${index + 1}"${state} r:id="rId${index + 1}"/>`
      }).join('')
      + '</sheets>'
      + (input.definedNames ? `<definedNames>${input.definedNames}</definedNames>` : '')
      + '</workbook>',
    'xl/_rels/workbook.xml.rels': relationshipsXml(relationships),
    ...input.extraFiles,
  }

  input.sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = sheet.xml

    if (sheet.relationships) {
      files[`xl/worksheets/_rels/sheet${index + 1}.xml.rels`]
        = relationshipsXml(sheet.relationships)
    }
  })

  if (input.sharedStrings) {
    files['xl/sharedStrings.xml'] = `${XML_HEADER}<sst xmlns="${NS_SHEET}">${
      input.sharedStrings.map((value) => {
        return `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`
      }).join('')
    }</sst>`
  }

  if (input.stylesXml) {
    files['xl/styles.xml'] = `${XML_HEADER}<styleSheet xmlns="${NS_SHEET}">${input.stylesXml}</styleSheet>`
  }

  return plainZip(files)
}

export const ESTIMATE_STYLES = '<numFmts count="2">'
  + '<numFmt numFmtId="164" formatCode="#,##0.00"/>'
  + '<numFmt numFmtId="165" formatCode="0.0&quot; h&quot;"/>'
  + '</numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="164"/>'
  + '<xf numFmtId="165"/><xf numFmtId="9"/></cellXfs>'

const ROLES = ['Lead', 'Designer', 'Developer', 'Tester', 'Writer']
const HOURS = [8, 6, 7, 5, 4]

/**
 * A small estimate workbook with invented content: a hidden "Lists" tab
 * feeding a dropdown, a "Parameters" tab read by INDEX/MATCH, line items
 * with shared formulas and a SUM(OFFSET(...)) subtotal, a summary that sums
 * across tabs, a defined name, merged cells, notes, conditional formats,
 * frozen panes and a tab whose name has a space and an apostrophe.
 */
export function estimateWorkbook(): Uint8Array {
  const listsRows = [rowXml(5, [textCell('B5', 'Roles')])]

  ROLES.forEach((role, index) => {
    listsRows.push(rowXml(6 + index, [textCell(`B${6 + index}`, role)]))
  })

  const parameterRows = [
    rowXml(3, [textCell('B3', 'Tax rate'), numberCell('C3', 0.2, 3)]),
    rowXml(6, [textCell('B6', 'Role'), textCell('D6', 'Hours per item')]),
    ...ROLES.map((role, index) => {
      return rowXml(7 + index, [
        textCell(`B${7 + index}`, role),
        numberCell(`D${7 + index}`, HOURS[index] as number, 2),
      ])
    }),
  ]

  const lineRows = [
    rowXml(1, [textCell('A1', 'Website estimate')]),
    rowXml(6, [
      textCell('A6', 'Item'),
      textCell('E6', 'Role'),
      textCell('F6', 'Hours'),
      textCell('G6', 'Quantity'),
      textCell('H6', 'Total hours'),
    ]),
  ]

  for (let row = 7; row <= 18; row += 1) {
    const role = ROLES[(row - 7) % ROLES.length] as string
    const isMaster = row === 7

    lineRows.push(rowXml(row, [
      textCell(`A${row}`, `Item ${row - 6}`),
      textCell(`E${row}`, role),
      formulaCell(
        `F${row}`,
        'INDEX(Parameters!$D$7:$D$11, MATCH(E7, Parameters!$B$7:$B$11, 0))',
        HOURS[(row - 7) % ROLES.length] as number,
        { style: 2, shared: isMaster ? { si: 0, ref: 'F7:F18' } : { si: 0 } },
      ),
      numberCell(`G${row}`, 2),
      formulaCell(`H${row}`, 'F7*G7', 0, {
        style: 1,
        shared: isMaster ? { si: 1, ref: 'H7:H18' } : { si: 1 },
      }),
    ]))
  }

  lineRows.push(rowXml(19, [
    textCell('A19', 'Subtotal'),
    formulaCell('H19', 'SUM(OFFSET(H19,-12,0,12,1))', 0, { style: 1 }),
  ]))

  for (let row = 20; row <= 24; row += 1) {
    lineRows.push(rowXml(row, [
      textCell(`A${row}`, `Extra ${row - 19}`),
      textCell(`E${row}`, 'Tester'),
      formulaCell(
        `F${row}`,
        `INDEX(Parameters!$D$7:$D$11, MATCH(E${row}, Parameters!$B$7:$B$11, 0))`,
        5,
        { style: 2 },
      ),
      numberCell(`G${row}`, 1),
      formulaCell(`H${row}`, `F${row}*G${row}`, 5, { style: 1 }),
    ]))
  }

  lineRows.push(rowXml(25, [
    textCell('A25', 'Total'),
    formulaCell('H25', 'H19+SUM(H20:H24)', 0, { style: 1 }),
  ]))

  const linesAfter = '<mergeCells count="1"><mergeCell ref="A1:H1"/></mergeCells>'
    + '<conditionalFormatting sqref="A7:H24">'
    + '<cfRule type="expression" dxfId="0" priority="1"><formula>$E7="Lead"</formula></cfRule>'
    + '</conditionalFormatting>'
    + '<conditionalFormatting sqref="H7:H24">'
    + '<cfRule type="cellIs" dxfId="1" priority="2" operator="greaterThan"><formula>100</formula></cfRule>'
    + '<cfRule type="colorScale" priority="3"><colorScale><cfvo type="min"/><cfvo type="max"/>'
    + '<color rgb="FFF8696B"/><color rgb="FF63BE7B"/></colorScale></cfRule>'
    + '</conditionalFormatting>'
    + '<dataValidations count="1"><dataValidation type="whole" allowBlank="1" '
    + 'showInputMessage="1" showErrorMessage="1" prompt="Whole items only" '
    + 'sqref="G7:G24"><formula1>0</formula1><formula2>1000</formula2>'
    + '</dataValidation></dataValidations>'
    + '<hyperlinks><hyperlink ref="A1" r:id="rIdLink"/></hyperlinks>'
    + x14ListValidation('Lists!$B$6:$B$45', 'E7:E24')

  const summaryRows = [
    rowXml(2, [textCell('A2', 'Role'), textCell('B2', 'Hours')]),
    ...ROLES.map((role, index) => {
      const row = 3 + index

      return rowXml(row, [
        textCell(`A${row}`, role),
        formulaCell(
          `B${row}`,
          'SUMIFS(Lines!$H$7:$H$24,Lines!$E$7:$E$24,A3)',
          10,
          { style: 1, shared: row === 3 ? { si: 0, ref: 'B3:B7' } : { si: 0 } },
        ),
        ...(row === 3
          ? [formulaCell('D3', 'Parameters!B7:B8', 'Lead', { array: 'D3:D4', string: true })]
          : []),
      ])
    }),
    rowXml(9, [
      textCell('A9', 'Lead lines'),
      formulaCell('B9', 'COUNTIFS(Lines!$E:$E,"Lead")', 3),
    ]),
    rowXml(10, [
      textCell('A10', 'Tax on extras'),
      formulaCell('B10', '\'Extra\'\'s tab\'!B2*TaxRate', 4, { style: 1 }),
    ]),
  ]

  return workbookPackage({
    stylesXml: ESTIMATE_STYLES,
    definedNames: '<definedName name="TaxRate">Parameters!$C$3</definedName>'
      + '<definedName name="_xlnm._FilterDatabase" localSheetId="2" hidden="1">Lines!$A$6:$H$24</definedName>',
    sheets: [
      { name: 'Lists', state: 'hidden', xml: sheetXml({ rows: listsRows.join('') }) },
      { name: 'Parameters', xml: sheetXml({ dimension: 'B3:D11', rows: parameterRows.join('') }) },
      {
        name: 'Lines',
        xml: sheetXml({
          dimension: 'A1:H25',
          pane: { rows: 6, columns: 2 },
          rows: lineRows.join(''),
          after: linesAfter,
        }),
        relationships: [
          { id: 'rIdNotes', type: 'comments', target: '../comments1.xml' },
        ],
      },
      {
        name: 'Extra\'s tab',
        xml: sheetXml({ rows: rowXml(2, [textCell('A2', 'Extras'), numberCell('B2', 20)]) }),
      },
      {
        name: 'Summary',
        xml: sheetXml({ dimension: 'A2:D10', rows: summaryRows.join('') }),
        relationships: [
          { id: 'rIdDrawing', type: 'drawing', target: '../drawings/drawing1.xml' },
        ],
      },
    ],
    extraFiles: {
      'xl/comments1.xml': commentsXml([
        { ref: 'E6', text: 'Pick a role from the list on the Lists tab.' },
      ]),
      'xl/drawings/drawing1.xml': `${XML_HEADER}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>`,
      'xl/drawings/_rels/drawing1.xml.rels': drawingRelationshipsXml(1, 1),
    },
  })
}

/**
 * The per-cell formulas `estimateWorkbook` stores, written out by hand, so
 * the map can be checked against them without the code under test.
 */
export function estimateLinesFormulas(): Map<string, string> {
  const formulas = new Map<string, string>()

  for (let row = 7; row <= 18; row += 1) {
    formulas.set(
      `F${row}`,
      `INDEX(Parameters!$D$7:$D$11, MATCH(E${row}, Parameters!$B$7:$B$11, 0))`,
    )
    formulas.set(`H${row}`, `F${row}*G${row}`)
  }

  formulas.set('H19', 'SUM(OFFSET(H19,-12,0,12,1))')

  for (let row = 20; row <= 24; row += 1) {
    formulas.set(
      `F${row}`,
      `INDEX(Parameters!$D$7:$D$11, MATCH(E${row}, Parameters!$B$7:$B$11, 0))`,
    )
    formulas.set(`H${row}`, `F${row}*G${row}`)
  }

  formulas.set('H25', 'H19+SUM(H20:H24)')

  return formulas
}

const LONG_TEXT = 'Includes discovery workshops, two review rounds, '
  + 'accessibility checks, handover notes and a short training session for '
  + 'the people who will maintain the pages afterwards.'

/**
 * A sheet shaped like a real estimate: 165 rows by 40 columns, about 24
 * formula columns, 12 dropdown columns, about 50 conditional rules and long
 * text in two columns. Content is invented.
 */
export function estimateShapedWorkbook(): Uint8Array {
  const rows: string[] = []
  const header: string[] = []

  for (let column = 1; column <= 40; column += 1) {
    header.push(textCell(`${columnName(column)}6`, `Column ${column}`))
  }

  rows.push(rowXml(6, header))

  for (let row = 7; row <= 171; row += 1) {
    const cells: string[] = []
    const isSubtotal = row % 20 === 0

    for (let column = 1; column <= 40; column += 1) {
      const reference = `${columnName(column)}${row}`

      if (column <= 2) {
        cells.push(textCell(reference, `${LONG_TEXT} Line ${row}.`))
      } else if (column <= 14) {
        const role = ROLES[(row + column) % ROLES.length] as string

        cells.push(textCell(reference, role))
      } else if (column <= 16) {
        cells.push(numberCell(reference, (row * column) % 17))
      } else {
        const previous = columnName(column - 1)
        const formula = isSubtotal
          ? `SUM(OFFSET(${reference},-19,0,19,1))`
          : column % 3 === 0
            ? `INDEX(Parameters!$D$7:$D$11, MATCH(${columnName(3 + (column % 12))}${row}, Parameters!$B$7:$B$11, 0))`
            : `${previous}${row}*$P$3+IF(${columnName(column - 2)}${row}>10,1,0)`

        const value = (row + column) % 50

        cells.push(formulaCell(reference, formula, value, { style: 1 }))
      }
    }

    rows.push(rowXml(row, cells))
  }

  const conditional: string[] = []

  for (let index = 0; index < 50; index += 1) {
    conditional.push(
      `<cfRule type="expression" dxfId="${index}" priority="${index + 1}">`
      + `<formula>$C7="Category ${index + 1}"</formula></cfRule>`,
    )
  }

  const validations = Array.from({ length: 12 }, (_value, index) => {
    const column = columnName(3 + index)

    return '<x14:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1">'
      + `<x14:formula1><xm:f>Lists!$B$6:$B$45</xm:f></x14:formula1><xm:sqref>${column}7:${column}171</xm:sqref>`
      + '</x14:dataValidation>'
  }).join('')
  const after = `<conditionalFormatting sqref="A7:AN171">${conditional.join('')}</conditionalFormatting>`
    + '<extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}">'
    + `<x14:dataValidations count="12">${validations}</x14:dataValidations></ext></extLst>`

  return workbookPackage({
    stylesXml: ESTIMATE_STYLES,
    sheets: [{
      name: 'Lines',
      xml: sheetXml({
        dimension: 'A6:AN171',
        pane: { rows: 6, columns: 2 },
        rows: rows.join(''),
        after,
      }),
    }],
  })
}
