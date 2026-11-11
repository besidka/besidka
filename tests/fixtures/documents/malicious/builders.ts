import { strToU8, zipSync, zlibSync } from 'fflate'
import type { Zippable } from 'fflate'

export type OfficeFormat = 'docx' | 'pptx' | 'xlsx'
export type PackageFiles = Record<string, string | Uint8Array | null>

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const NS_R
  = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const NS_TYPES
  = 'http://schemas.openxmlformats.org/package/2006/content-types'
const REL_OFFICE_DOCUMENT
  = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'

export const MAIN_CONTENT_TYPES: Record<OfficeFormat, string> = {
  docx:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  pptx:
    'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  xlsx:
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
}

const MAIN_PARTS: Record<OfficeFormat, string> = {
  docx: 'word/document.xml',
  pptx: 'ppt/presentation.xml',
  xlsx: 'xl/workbook.xml',
}

export interface PackageOptions {
  files?: PackageFiles
  contentTypes?: string
  rootRelationships?: string
  mainContentType?: string
  sheetXml?: string
  documentBody?: string
  slideXml?: string
}

function xmlHeader(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
}

export function sheetXmlWith(cells: string): string {
  return `${xmlHeader()}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetData><row r="1">${cells}</row></sheetData></worksheet>`
}

export function documentXmlWith(body: string): string {
  return `${xmlHeader()}<w:document xmlns:w="${NS_W}"><w:body>${body}</w:body></w:document>`
}

export function slideXmlWith(body: string): string {
  return `${xmlHeader()}<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`
    + ` xmlns:r="${NS_R}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`
    + `<p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
}

export function minimalPackage(
  format: OfficeFormat,
  options: PackageOptions = {},
): Zippable {
  const mainPart = MAIN_PARTS[format]
  const mainContentType = options.mainContentType ?? MAIN_CONTENT_TYPES[format]
  const files: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': options.contentTypes
      ?? `${xmlHeader()}<Types xmlns="${NS_TYPES}">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + `<Override PartName="/${mainPart}" ContentType="${mainContentType}"/>`
      + (format === 'xlsx'
        ? '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        : '')
      + '</Types>',
    '_rels/.rels': options.rootRelationships
      ?? `${xmlHeader()}<Relationships xmlns="${NS_RELS}">`
      + `<Relationship Id="rId1" Type="${REL_OFFICE_DOCUMENT}" Target="${mainPart}"/>`
      + '</Relationships>',
  }

  if (format === 'docx') {
    files[mainPart] = documentXmlWith(
      options.documentBody
      ?? '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>',
    )
  }

  if (format === 'pptx') {
    files[mainPart] = `${xmlHeader()}<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`
    files['ppt/slides/slide1.xml'] = options.slideXml ?? slideXmlWith('')
  }

  if (format === 'xlsx') {
    files[mainPart] = `${xmlHeader()}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`
      + ` xmlns:r="${NS_R}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`
    files['xl/_rels/workbook.xml.rels'] = `${xmlHeader()}<Relationships xmlns="${NS_RELS}">`
      + `<Relationship Id="rId1" Type="${NS_R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
    files['xl/worksheets/sheet1.xml'] = options.sheetXml
      ?? sheetXmlWith('<c r="A1" t="inlineStr"><is><t>Hello</t></is></c>')
  }

  const removed = new Set<string>()

  for (const [name, content] of Object.entries(options.files ?? {})) {
    if (content === null) {
      removed.add(name)
    } else {
      files[name] = content
    }
  }

  const archive: Zippable = {}

  for (const [name, content] of Object.entries(files)) {
    if (!removed.has(name)) {
      archive[name] = typeof content === 'string' ? strToU8(content) : content
    }
  }

  return archive
}

export function buildPackage(
  format: OfficeFormat,
  options: PackageOptions = {},
): Uint8Array {
  return zipSync(minimalPackage(format, options))
}

export function withContentTypeOverride(
  format: OfficeFormat,
  partName: string,
  contentType: string,
): string {
  return `${xmlHeader()}<Types xmlns="${NS_TYPES}">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + `<Override PartName="/${MAIN_PARTS[format]}" ContentType="${MAIN_CONTENT_TYPES[format]}"/>`
    + `<Override PartName="${partName}" ContentType="${contentType}"/>`
    + '</Types>'
}

export function withRootRelationship(
  format: OfficeFormat,
  relationship: string,
): string {
  return `${xmlHeader()}<Relationships xmlns="${NS_RELS}">`
    + `<Relationship Id="rId1" Type="${REL_OFFICE_DOCUMENT}" Target="${MAIN_PARTS[format]}"/>`
    + `${relationship}</Relationships>`
}

export function relationshipsXml(relationships: string): string {
  return `${xmlHeader()}<Relationships xmlns="${NS_RELS}">${relationships}</Relationships>`
}

function findCentralDirectoryOffsets(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let endOffset = bytes.length - 22

  while (endOffset >= 0 && view.getUint32(endOffset, true) !== 0x06054B50) {
    endOffset -= 1
  }

  const count = view.getUint16(endOffset + 10, true)
  let offset = view.getUint32(endOffset + 16, true)
  const offsets: number[] = []

  for (let index = 0; index < count; index += 1) {
    offsets.push(offset)
    offset += 46
      + view.getUint16(offset + 28, true)
      + view.getUint16(offset + 30, true)
      + view.getUint16(offset + 32, true)
  }

  return offsets
}

function findEntryIndex(bytes: Uint8Array, name: string): number {
  const offsets = findCentralDirectoryOffsets(bytes)
  const decoder = new TextDecoder()

  return offsets.findIndex((offset) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const nameLength = view.getUint16(offset + 28, true)

    return decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
      === name
  })
}

export function patchCentralEntry(
  archive: Uint8Array,
  name: string,
  patch: (view: DataView, offset: number) => void,
): Uint8Array {
  const copy = archive.slice()
  const view = new DataView(copy.buffer)
  const index = findEntryIndex(copy, name)

  if (index === -1) {
    throw new Error(`Entry ${name} not found`)
  }

  patch(view, findCentralDirectoryOffsets(copy)[index] as number)

  return copy
}

export function declareUncompressedSize(
  archive: Uint8Array,
  name: string,
  size: number,
): Uint8Array {
  return patchCentralEntry(archive, name, (view, offset) => {
    view.setUint32(offset + 24, size, true)
  })
}

export function declareCompressedSize(
  archive: Uint8Array,
  name: string,
  size: number,
): Uint8Array {
  return patchCentralEntry(archive, name, (view, offset) => {
    view.setUint32(offset + 20, size, true)
  })
}

export function markEncrypted(archive: Uint8Array, name: string): Uint8Array {
  return patchCentralEntry(archive, name, (view, offset) => {
    view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 1, true)
  })
}

export function setCompressionMethod(
  archive: Uint8Array,
  name: string,
  method: number,
): Uint8Array {
  return patchCentralEntry(archive, name, (view, offset) => {
    view.setUint16(offset + 10, method, true)
  })
}

export function markZip64(archive: Uint8Array): Uint8Array {
  const copy = archive.slice()
  const view = new DataView(copy.buffer)
  let endOffset = copy.length - 22

  while (endOffset >= 0 && view.getUint32(endOffset, true) !== 0x06054B50) {
    endOffset -= 1
  }

  view.setUint16(endOffset + 10, 0xFFFF, true)
  view.setUint32(endOffset + 12, 0xFFFFFFFF, true)
  view.setUint32(endOffset + 16, 0xFFFFFFFF, true)

  return copy
}

export function renameEntry(
  archive: Uint8Array,
  from: string,
  to: string,
): Uint8Array {
  if (from.length !== to.length) {
    throw new Error('Names must have the same length')
  }

  const encoder = new TextEncoder()
  const copy = archive.slice()
  const source = encoder.encode(from)
  const target = encoder.encode(to)

  for (let start = 0; start <= copy.length - source.length; start += 1) {
    if (source.every((byte, index) => copy[start + index] === byte)) {
      copy.set(target, start)
    }
  }

  return copy
}

export function zipWithManyEntries(count: number): Uint8Array {
  const archive: Zippable = {
    '[Content_Types].xml': strToU8('<Types/>'),
  }

  for (let index = 0; index < count; index += 1) {
    archive[`word/media/image${index}.png`] = strToU8('x')
  }

  return zipSync(archive, { level: 0 })
}

export function highRatioPackage(format: OfficeFormat): Uint8Array {
  const zeros = new Uint8Array(20 * 1024 * 1024)

  return buildPackage(format, { files: { 'word/media/filler.png': zeros } })
}

export interface PdfOptions {
  objects?: string[]
  trailer?: string
  eof?: string
  header?: string
  rawSuffix?: Uint8Array
}

const BASE_PDF_OBJECTS = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
]

export function buildPdf(options: PdfOptions = {}): Uint8Array {
  const objects = options.objects ?? BASE_PDF_OBJECTS
  const body = objects
    .map((object, index) => `${index + 1} 0 obj\n${object}\nendobj\n`)
    .join('')
  const text = `${options.header ?? '%PDF-1.7'}\n${body}`
    + `trailer\n${options.trailer ?? '<< /Root 1 0 R /Size 4 >>'}\n`
    + `${options.eof ?? '%%EOF'}\n`
  const encoded = strToU8(text)

  if (!options.rawSuffix) {
    return encoded
  }

  const combined = new Uint8Array(encoded.length + options.rawSuffix.length)

  combined.set(encoded)
  combined.set(options.rawSuffix, encoded.length)

  return combined
}

export function pdfWithCatalogEntry(entry: string): Uint8Array {
  return buildPdf({
    objects: [
      `<< /Type /Catalog /Pages 2 0 R ${entry} >>`,
      BASE_PDF_OBJECTS[1] as string,
      BASE_PDF_OBJECTS[2] as string,
    ],
  })
}

export function pdfWithAnnotation(annotation: string): Uint8Array {
  return buildPdf({
    objects: [
      BASE_PDF_OBJECTS[0] as string,
      BASE_PDF_OBJECTS[1] as string,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R] >>',
      annotation,
    ],
  })
}

export function pdfWithCompressedObjectStream(inner: string): Uint8Array {
  const header = '4 0 '
  const first = header.length
  const content = `${header}${inner}`
  const compressed = zlibSync(strToU8(content))
  const prefix = strToU8(
    '%PDF-1.7\n'
    + '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
    + '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
    + '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n'
    + `5 0 obj\n<< /Type /ObjStm /N 1 /First ${first} /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`,
  )
  const suffix = strToU8('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n')
  const result = new Uint8Array(
    prefix.length + compressed.length + suffix.length,
  )

  result.set(prefix)
  result.set(compressed, prefix.length)
  result.set(suffix, prefix.length + compressed.length)

  return result
}

export function pdfWithMetadata(xmp: string, compress = false): Uint8Array {
  const data = compress ? zlibSync(strToU8(xmp)) : strToU8(xmp)
  const filter = compress ? ' /Filter /FlateDecode' : ''
  const prefix = strToU8(
    '%PDF-1.7\n'
    + '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Metadata 4 0 R >>\nendobj\n'
    + '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
    + '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n'
    + `4 0 obj\n<< /Type /Metadata /Subtype /XML${filter} /Length ${data.length} >>\nstream\n`,
  )
  const suffix = strToU8('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Size 5 >>\n%%EOF\n')
  const result = new Uint8Array(prefix.length + data.length + suffix.length)

  result.set(prefix)
  result.set(data, prefix.length)
  result.set(suffix, prefix.length + data.length)

  return result
}
