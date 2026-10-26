const textEncoder = new TextEncoder()

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256)

  for (let index = 0; index < 256; index += 1) {
    let value = index

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
    }

    table[index] = value >>> 0
  }

  return table
}

const crcTable = buildCrcTable()

function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF

  for (const byte of bytes) {
    crc = (crcTable[(crc ^ byte) & 0xFF] ?? 0) ^ (crc >>> 8)
  }

  return (crc ^ 0xFFFFFFFF) >>> 0
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

export function createStoredZip(files: Record<string, string>): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const [fileName, content] of Object.entries(files)) {
    const nameBytes = textEncoder.encode(fileName)
    const data = textEncoder.encode(content)
    const checksum = crc32(data)
    const localHeader = new DataView(new ArrayBuffer(30))

    localHeader.setUint32(0, 0x04034B50, true)
    localHeader.setUint16(4, 20, true)
    localHeader.setUint16(8, 0, true)
    localHeader.setUint32(14, checksum, true)
    localHeader.setUint32(18, data.length, true)
    localHeader.setUint32(22, data.length, true)
    localHeader.setUint16(26, nameBytes.length, true)

    const centralHeader = new DataView(new ArrayBuffer(46))

    centralHeader.setUint32(0, 0x02014B50, true)
    centralHeader.setUint16(4, 20, true)
    centralHeader.setUint16(6, 20, true)
    centralHeader.setUint32(16, checksum, true)
    centralHeader.setUint32(20, data.length, true)
    centralHeader.setUint32(24, data.length, true)
    centralHeader.setUint16(28, nameBytes.length, true)
    centralHeader.setUint32(42, offset, true)

    const localBytes = concatBytes([
      new Uint8Array(localHeader.buffer),
      nameBytes,
      data,
    ])

    localParts.push(localBytes)
    centralParts.push(
      concatBytes([new Uint8Array(centralHeader.buffer), nameBytes]),
    )
    offset += localBytes.length
  }

  const centralDirectory = concatBytes(centralParts)
  const endRecord = new DataView(new ArrayBuffer(22))

  endRecord.setUint32(0, 0x06054B50, true)
  endRecord.setUint16(8, centralParts.length, true)
  endRecord.setUint16(10, centralParts.length, true)
  endRecord.setUint32(12, centralDirectory.length, true)
  endRecord.setUint32(16, offset, true)

  return concatBytes([
    ...localParts,
    centralDirectory,
    new Uint8Array(endRecord.buffer),
  ])
}

export interface ForgedZipEntry {
  name: string
  uncompressedSize: number
  compressedSize?: number
}

export interface ForgedZipOptions {
  declaredEntries?: number
  withZip64Locator?: boolean
}

export function createZipWithDeclaredSizes(
  entries: ForgedZipEntry[],
  options: ForgedZipOptions = {},
): Uint8Array {
  const centralParts = entries.map((entry) => {
    const nameBytes = textEncoder.encode(entry.name)
    const centralHeader = new DataView(new ArrayBuffer(46))

    centralHeader.setUint32(0, 0x02014B50, true)
    centralHeader.setUint16(4, 20, true)
    centralHeader.setUint16(6, 20, true)
    centralHeader.setUint32(20, entry.compressedSize ?? 1, true)
    centralHeader.setUint32(24, entry.uncompressedSize, true)
    centralHeader.setUint16(28, nameBytes.length, true)

    return concatBytes([new Uint8Array(centralHeader.buffer), nameBytes])
  })
  const centralDirectory = concatBytes(centralParts)
  const locator = new DataView(new ArrayBuffer(20))
  const endRecord = new DataView(new ArrayBuffer(22))
  const declaredEntries = options.declaredEntries ?? entries.length

  locator.setUint32(0, 0x07064B50, true)
  endRecord.setUint32(0, 0x06054B50, true)
  endRecord.setUint16(8, declaredEntries, true)
  endRecord.setUint16(10, declaredEntries, true)
  endRecord.setUint32(12, centralDirectory.length, true)
  endRecord.setUint32(16, 0, true)

  return concatBytes([
    centralDirectory,
    ...(options.withZip64Locator ? [new Uint8Array(locator.buffer)] : []),
    new Uint8Array(endRecord.buffer),
  ])
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function createMinimalDocx(): Uint8Array {
  const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml'
    + '/2006/main'

  return createStoredZip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/'
      + 'content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats'
      + '-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/'
      + 'vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/'
      + 'vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '</Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
      + 'relationships"><Relationship Id="rId1" Type="http://schemas.'
      + 'openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
      + 'Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
      + 'relationships"><Relationship Id="rId1" Type="http://schemas.'
      + 'openxmlformats.org/officeDocument/2006/relationships/styles" '
      + 'Target="styles.xml"/></Relationships>',
    'word/styles.xml': '<?xml version="1.0" encoding="UTF-8"?>'
      + `<w:styles xmlns:w="${wordNamespace}">`
      + '<w:style w:type="paragraph" w:styleId="Heading1">'
      + '<w:name w:val="heading 1"/></w:style></w:styles>',
    'word/document.xml': '<?xml version="1.0" encoding="UTF-8"?>'
      + `<w:document xmlns:w="${wordNamespace}"><w:body>`
      + '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
      + '<w:r><w:t>Project Plan</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t xml:space="preserve">Ship the </w:t></w:r>'
      + '<w:r><w:rPr><w:b/></w:rPr><w:t>knowledge</w:t></w:r>'
      + '<w:r><w:t xml:space="preserve"> feature.</w:t></w:r></w:p>'
      + '</w:body></w:document>',
  })
}

export function createEmptyDocx(): Uint8Array {
  const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml'
    + '/2006/main'

  return createStoredZip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/'
      + 'content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats'
      + '-package.relationships+xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/'
      + 'vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '</Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
      + 'relationships"><Relationship Id="rId1" Type="http://schemas.'
      + 'openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
      + 'Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0" encoding="UTF-8"?>'
      + `<w:document xmlns:w="${wordNamespace}"><w:body/></w:document>`,
  })
}

export interface FixtureSheet {
  name: string
  rows: Array<Array<string | number | null>>
}

function columnLetter(columnIndex: number): string {
  const alphabetSize = 26
  const lastLetter = String.fromCharCode(65 + (columnIndex % alphabetSize))

  if (columnIndex < alphabetSize) {
    return lastLetter
  }

  return `${columnLetter(Math.floor(columnIndex / alphabetSize) - 1)}${lastLetter}`
}

function buildSheetXml(rows: FixtureSheet['rows']): string {
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => {
      const reference = `${columnLetter(columnIndex)}${rowIndex + 1}`

      if (cell === null) {
        return ''
      }

      if (typeof cell === 'number') {
        return `<c r="${reference}"><v>${cell}</v></c>`
      }

      return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(cell)}`
        + '</t></is></c>'
    }).join('')

    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')

  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/'
    + `main"><sheetData>${rowXml}</sheetData></worksheet>`
}

export function createMinimalXlsx(sheets: FixtureSheet[]): Uint8Array {
  const sheetEntries = sheets.map((sheet, index) => {
    return `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" `
      + `r:id="rId${index + 1}"/>`
  }).join('')
  const relationships = sheets.map((_sheet, index) => {
    return `<Relationship Id="rId${index + 1}" Type="http://schemas.`
      + 'openxmlformats.org/officeDocument/2006/relationships/worksheet" '
      + `Target="worksheets/sheet${index + 1}.xml"/>`
  }).join('')
  const overrides = sheets.map((_sheet, index) => {
    return `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" `
      + 'ContentType="application/vnd.openxmlformats-officedocument.'
      + 'spreadsheetml.worksheet+xml"/>'
  }).join('')
  const sheetFiles: Record<string, string> = {}

  sheets.forEach((sheet, index) => {
    sheetFiles[`xl/worksheets/sheet${index + 1}.xml`] = buildSheetXml(
      sheet.rows,
    )
  })

  return createStoredZip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/'
      + 'content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats'
      + '-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/'
      + 'vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + `${overrides}</Types>`,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
      + 'relationships"><Relationship Id="rId1" Type="http://schemas.'
      + 'openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
      + 'Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/'
      + 'main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/'
      + `relationships"><sheets>${sheetEntries}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
      + `relationships">${relationships}</Relationships>`,
    ...sheetFiles,
  })
}

function escapePdfText(value: string): string {
  return value.replace(/[\\()]/g, '\\$&')
}

export function createMinimalPdf(pageTexts: string[]): Uint8Array {
  const objects: string[] = []
  const pageObjectNumbers = pageTexts.map((_text, index) => 4 + index * 2)

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Count ${pageTexts.length} /Kids [`
    + `${pageObjectNumbers.map(number => `${number} 0 R`).join(' ')}] >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'

  pageTexts.forEach((text, index) => {
    const pageNumber = 4 + index * 2
    const stream = text.length > 0
      ? `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`
      : ''

    objects[pageNumber] = '<< /Type /Page /Parent 2 0 R '
      + '/MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> '
      + `/Contents ${pageNumber + 1} 0 R >>`
    objects[pageNumber + 1] = `<< /Length ${stream.length} >>\nstream\n`
      + `${stream}\nendstream`
  })

  let document = '%PDF-1.4\n'
  const offsets: number[] = []

  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    offsets[objectNumber] = document.length
    document += `${objectNumber} 0 obj\n${objects[objectNumber]}\nendobj\n`
  }

  const xrefOffset = document.length
  const entries = offsets
    .slice(1)
    .map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')

  document += `xref\n0 ${objects.length}\n0000000000 65535 f \n${entries}`
    + `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n`
    + `startxref\n${xrefOffset}\n%%EOF\n`

  return textEncoder.encode(document)
}
