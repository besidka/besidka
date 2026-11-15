import { strToU8, zipSync } from 'fflate'
import type { Zippable } from 'fflate'
import { render } from '@besidka/doc-renderer/render'
import { parseDocumentSpec } from '@besidka/doc-renderer/spec'

export type OfficeKind = 'docx' | 'xlsx' | 'pptx'

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS_WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const NS_SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_PRESENTATION
  = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const NS_DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const NS_RELATIONSHIPS
  = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PACKAGE_RELATIONSHIPS
  = 'http://schemas.openxmlformats.org/package/2006/relationships'
const NS_CONTENT_TYPES
  = 'http://schemas.openxmlformats.org/package/2006/content-types'

export const MAIN_CONTENT_TYPES: Record<OfficeKind, string> = {
  docx:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  xlsx:
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  pptx:
    'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
}

export const MAIN_PARTS: Record<OfficeKind, string> = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
}

export interface PackageOptions {
  mainContentType?: string
  extraContentTypes?: string
  extraFiles?: Record<string, string | Uint8Array>
}

export async function renderSpec(spec: unknown): Promise<Uint8Array> {
  const parsed = parseDocumentSpec(spec)

  if (!parsed.ok) {
    throw new Error(`Invalid spec: ${JSON.stringify(parsed.issues)}`)
  }

  const result = await render(parsed.spec, new Map())

  return result.bytes
}

function contentTypesXml(
  kind: OfficeKind,
  options: PackageOptions,
  overrides: string,
): string {
  return `${XML_HEADER}<Types xmlns="${NS_CONTENT_TYPES}">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + `<Override PartName="/${MAIN_PARTS[kind]}" ContentType="${
      options.mainContentType ?? MAIN_CONTENT_TYPES[kind]
    }"/>`
    + overrides
    + (options.extraContentTypes ?? '')
    + '</Types>'
}

function rootRelationshipsXml(kind: OfficeKind): string {
  return `${XML_HEADER}<Relationships xmlns="${NS_PACKAGE_RELATIONSHIPS}">`
    + `<Relationship Id="rId1" Type="${NS_RELATIONSHIPS}/officeDocument" Target="${MAIN_PARTS[kind]}"/>`
    + '</Relationships>'
}

export function relationshipsXml(
  relationships: Array<{ id: string, type: string, target: string }>,
): string {
  return `${XML_HEADER}<Relationships xmlns="${NS_PACKAGE_RELATIONSHIPS}">`
    + relationships.map((relationship) => {
      return `<Relationship Id="${relationship.id}" Type="${NS_RELATIONSHIPS}/${relationship.type}" Target="${relationship.target}"/>`
    }).join('')
    + '</Relationships>'
}

function toZippable(files: Record<string, string | Uint8Array>): Zippable {
  const archive: Zippable = {}

  for (const [name, content] of Object.entries(files)) {
    archive[name] = typeof content === 'string' ? strToU8(content) : content
  }

  return archive
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function docxPackage(
  body: string,
  extra: {
    stylesXml?: string
    numberingXml?: string
    options?: PackageOptions
  } = {},
): Uint8Array {
  const options = extra.options ?? {}
  const files: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': contentTypesXml('docx', options, ''),
    '_rels/.rels': rootRelationshipsXml('docx'),
    'word/document.xml': `${XML_HEADER}<w:document xmlns:w="${NS_WORD}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>${body}</w:body></w:document>`,
  }

  if (extra.stylesXml) {
    files['word/styles.xml'] = `${XML_HEADER}<w:styles xmlns:w="${NS_WORD}">${extra.stylesXml}</w:styles>`
  }

  if (extra.numberingXml) {
    files['word/numbering.xml'] = `${XML_HEADER}<w:numbering xmlns:w="${NS_WORD}">${extra.numberingXml}</w:numbering>`
  }

  return zipSync(toZippable({ ...files, ...options.extraFiles }))
}

export function paragraphXml(
  text: string,
  properties = '',
): string {
  const pPr = properties ? `<w:pPr>${properties}</w:pPr>` : ''

  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

export interface XlsxSheetInput {
  name: string
  xml: string
}

export function worksheetXml(
  rows: string,
  after = '',
): string {
  return `${XML_HEADER}<worksheet xmlns="${NS_SHEET}"><sheetData>${rows}</sheetData>${after}</worksheet>`
}

export function xlsxPackage(
  sheets: XlsxSheetInput[],
  extra: {
    sharedStrings?: string[]
    stylesXml?: string
    date1904?: boolean
    options?: PackageOptions
  } = {},
): Uint8Array {
  const options = extra.options ?? {}
  const relationships = sheets.map((_sheet, index) => {
    return {
      id: `rId${index + 1}`,
      type: 'worksheet',
      target: `worksheets/sheet${index + 1}.xml`,
    }
  })

  if (extra.sharedStrings) {
    relationships.push({
      id: 'rId100',
      type: 'sharedStrings',
      target: 'sharedStrings.xml',
    })
  }

  if (extra.stylesXml) {
    relationships.push({ id: 'rId101', type: 'styles', target: 'styles.xml' })
  }

  const files: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': contentTypesXml('xlsx', options, ''),
    '_rels/.rels': rootRelationshipsXml('xlsx'),
    'xl/workbook.xml': `${XML_HEADER}<workbook xmlns="${NS_SHEET}" xmlns:r="${NS_RELATIONSHIPS}">`
      + (extra.date1904 ? '<workbookPr date1904="1"/>' : '<workbookPr/>')
      + `<sheets>${sheets.map((sheet, index) => {
        return `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
      }).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': relationshipsXml(relationships),
  }

  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = sheet.xml
  })

  if (extra.sharedStrings) {
    files['xl/sharedStrings.xml'] = `${XML_HEADER}<sst xmlns="${NS_SHEET}">${
      extra.sharedStrings.map((value) => {
        return `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`
      }).join('')
    }</sst>`
  }

  if (extra.stylesXml) {
    files['xl/styles.xml'] = `${XML_HEADER}<styleSheet xmlns="${NS_SHEET}">${extra.stylesXml}</styleSheet>`
  }

  return zipSync(toZippable({ ...files, ...options.extraFiles }))
}

export interface SlideInput {
  xml: string
  notesXml?: string
}

export function slideXml(shapes: string): string {
  return `${XML_HEADER}<p:sld xmlns:a="${NS_DRAWING}" xmlns:r="${NS_RELATIONSHIPS}" xmlns:p="${NS_PRESENTATION}"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`
}

export function notesXml(shapes: string): string {
  return `${XML_HEADER}<p:notes xmlns:a="${NS_DRAWING}" xmlns:r="${NS_RELATIONSHIPS}" xmlns:p="${NS_PRESENTATION}"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:notes>`
}

export function shapeXml(
  paragraphs: string[],
  placeholder = '',
): string {
  const nvPr = placeholder ? `<p:nvPr>${placeholder}</p:nvPr>` : '<p:nvPr/>'

  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Shape"/><p:cNvSpPr/>${nvPr}</p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.join('')}</p:txBody></p:sp>`
}

export function runParagraphXml(text: string, paragraphProperties = ''): string {
  return `<a:p>${paragraphProperties}<a:r><a:t>${escapeXml(text)}</a:t></a:r></a:p>`
}

export function pptxPackage(
  slides: SlideInput[],
  extra: {
    listedOrder?: number[]
    swapIdAttributes?: boolean
    omitSlideList?: boolean
    options?: PackageOptions
  } = {},
): Uint8Array {
  const options = extra.options ?? {}
  const order = extra.listedOrder ?? slides.map((_slide, index) => index + 1)
  const presentationRelationships = slides.map((_slide, index) => {
    return {
      id: `rId${index + 10}`,
      type: 'slide',
      target: `slides/slide${index + 1}.xml`,
    }
  })
  const slideList = order.map((slideNumber, position) => {
    const relationshipId = `rId${slideNumber + 9}`
    const identifier = 256 + position

    return extra.swapIdAttributes
      ? `<p:sldId r:id="${relationshipId}" id="${identifier}"/>`
      : `<p:sldId id="${identifier}" r:id="${relationshipId}"/>`
  }).join('')
  const files: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': contentTypesXml('pptx', options, ''),
    '_rels/.rels': rootRelationshipsXml('pptx'),
    'ppt/presentation.xml': `${XML_HEADER}<p:presentation xmlns:p="${NS_PRESENTATION}" xmlns:r="${NS_RELATIONSHIPS}">`
      + (extra.omitSlideList ? '' : `<p:sldIdLst>${slideList}</p:sldIdLst>`)
      + '</p:presentation>',
    'ppt/_rels/presentation.xml.rels': relationshipsXml(
      presentationRelationships,
    ),
  }

  slides.forEach((slide, index) => {
    const number = index + 1

    files[`ppt/slides/slide${number}.xml`] = slide.xml

    if (slide.notesXml) {
      files[`ppt/slides/_rels/slide${number}.xml.rels`] = relationshipsXml([{
        id: 'rId1',
        type: 'notesSlide',
        target: `../notesSlides/notesSlide${number}.xml`,
      }])
      files[`ppt/notesSlides/notesSlide${number}.xml`] = slide.notesXml
    }
  })

  return zipSync(toZippable({ ...files, ...options.extraFiles }))
}

export function plainZip(
  files: Record<string, string | Uint8Array>,
): Uint8Array {
  return zipSync(toZippable(files))
}

export const SAMPLE_SPECS = {
  docx: {
    specVersion: 1,
    format: 'docx',
    title: 'Report',
    blocks: [
      { type: 'heading', level: 1, text: 'Quarterly report' },
      {
        type: 'paragraph',
        runs: [
          { text: 'Revenue grew. See ' },
          { text: 'the dashboard', link: { href: 'https://example.com/d' } },
          { text: ' for details.' },
        ],
      },
      { type: 'heading', level: 2, text: 'Highlights' },
      {
        type: 'list',
        ordered: false,
        items: [
          {
            runs: [{ text: 'First point' }],
            children: [{ runs: [{ text: 'Nested point' }] }],
          },
          { runs: [{ text: 'Second point' }] },
        ],
      },
      {
        type: 'list',
        ordered: true,
        items: [
          { runs: [{ text: 'Step one' }] },
          { runs: [{ text: 'Step two' }] },
        ],
      },
      {
        type: 'table',
        header: true,
        columns: [{ text: 'Region' }, { text: 'Revenue' }],
        rows: [
          [[{ text: 'Київ' }], [{ text: '120' }]],
          [[{ text: 'Lviv | West' }], [{ text: '90' }]],
        ],
      },
    ],
  },
  xlsx: {
    specVersion: 1,
    format: 'xlsx',
    title: 'Book',
    sheets: [
      {
        name: 'Sales',
        columns: [
          { header: 'Day', type: 'date' },
          { header: 'Region', type: 'string' },
          { header: 'Units', type: 'integer' },
        ],
        rows: [
          [{ date: '2026-07-01' }, 'Харків', 5],
          [{ date: '2026-07-02' }, 'Lviv, West', 7],
        ],
      },
      {
        name: 'Costs',
        columns: [{ header: 'Item', type: 'string' }],
        rows: [['Rent']],
      },
    ],
  },
  pptx: {
    specVersion: 1,
    format: 'pptx',
    title: 'Deck',
    aspect: '16:9',
    slides: [
      { layout: 'title', title: 'Launch plan', subtitle: 'Autumn 2026' },
      {
        layout: 'title-content',
        title: 'Goals',
        bullets: [[{ text: 'Ship the beta' }], [{ text: 'Hire two people' }]],
        notes: 'Mention the budget.',
      },
    ],
  },
} as const
