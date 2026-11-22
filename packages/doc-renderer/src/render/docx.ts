import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type { ParagraphChild } from 'docx'
import { PINNED_DOCUMENT_DATE } from '../constants.ts'
import { stampOoxml } from '../stamp/ooxml.ts'
import type {
  Block,
  DocxSpec,
  ListItem,
  Run,
} from '../spec/v1.ts'
import {
  ACCENT_COLORS,
  ACCENT_TINTS,
  DEFAULT_PROVENANCE,
  MEDIA_TYPES,
  resolveTheme,
  splitLines,
} from './common.ts'
import type { RenderOptions, RenderResult } from './common.ts'
import { RenderError } from './errors.ts'
import type { PreparedImage } from './images.ts'

const BODY_FONT = { sans: 'Arial', serif: 'Times New Roman' } as const
const CODE_FONT = 'Courier New'
const TEXT_WIDTH_PIXELS = 600
const BODY_SIZE_HALF_POINTS = 22
const HEADING_SIZES_HALF_POINTS = [0, 40, 32, 28, 24]
const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
] as const
const ALIGNMENTS = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const
const BULLET_CHARACTERS = ['•', '–', '·'] as const
const ORDERED_FORMATS = [
  LevelFormat.DECIMAL,
  LevelFormat.LOWER_LETTER,
  LevelFormat.LOWER_ROMAN,
] as const

interface DocxContext {
  accent: string
  tint: string
  images: Map<string, PreparedImage>
  orderedInstance: number
}

type DocxChild = Paragraph | Table

function buildRunChildren(
  run: Run,
  context: DocxContext,
  baseItalics = false,
): ParagraphChild[] {
  const lines = splitLines(run.text)
  const textRuns = lines.map((line, index) => {
    return new TextRun({
      text: line,
      break: index > 0 ? 1 : undefined,
      bold: run.bold,
      italics: run.italic || baseItalics || undefined,
      underline: run.underline || run.link ? {} : undefined,
      font: run.code ? CODE_FONT : undefined,
      color: run.link ? context.accent : undefined,
      shading: run.code
        ? { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' }
        : undefined,
    })
  })

  if (run.link) {
    return [new ExternalHyperlink({ link: run.link.href, children: textRuns })]
  }

  return textRuns
}

function buildRuns(
  runs: readonly Run[],
  context: DocxContext,
  baseItalics = false,
): ParagraphChild[] {
  return runs.flatMap(run => buildRunChildren(run, context, baseItalics))
}

function buildListItems(
  items: readonly ListItem[],
  ordered: boolean,
  level: number,
  context: DocxContext,
  instance: number,
): Paragraph[] {
  const paragraphs: Paragraph[] = []

  for (const item of items) {
    paragraphs.push(new Paragraph({
      children: buildRuns(item.runs, context),
      numbering: {
        reference: ordered ? 'besidka-ordered' : 'besidka-bullets',
        level,
        instance: ordered ? instance : undefined,
      },
    }))

    if (item.children) {
      paragraphs.push(
        ...buildListItems(
          item.children as ListItem[],
          ordered,
          level + 1,
          context,
          instance,
        ),
      )
    }
  }

  return paragraphs
}

function buildTable(
  block: Extract<Block, { type: 'table' }>,
  context: DocxContext,
): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'C7CCD4' }
  const borders = { top: border, bottom: border, left: border, right: border }
  const headerRow = block.header
    ? [new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: block.columns.map((column) => {
        return new TableCell({
          borders,
          shading: {
            type: ShadingType.CLEAR,
            fill: context.tint,
            color: 'auto',
          },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({
            alignment: column.align ? ALIGNMENTS[column.align] : undefined,
            children: [new TextRun({ text: column.text, bold: true })],
          })],
        })
      }),
    })]
    : []
  const bodyRows = block.rows.map((row) => {
    return new TableRow({
      cantSplit: true,
      children: row.map((cell, columnIndex) => {
        const align = block.columns[columnIndex]?.align

        return new TableCell({
          borders,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({
            alignment: align ? ALIGNMENTS[align] : undefined,
            children: cell.length > 0
              ? buildRuns(cell, context)
              : [new TextRun({ text: '' })],
          })],
        })
      }),
    })
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [...headerRow, ...bodyRows],
  })
}

function buildBlock(block: Block, context: DocxContext): DocxChild[] {
  switch (block.type) {
    case 'heading':
      return [new Paragraph({
        heading: HEADING_LEVELS[block.level],
        children: [new TextRun({ text: block.text })],
      })]
    case 'paragraph':
      return [new Paragraph({
        alignment: block.align ? ALIGNMENTS[block.align] : undefined,
        spacing: { after: 120 },
        children: buildRuns(block.runs, context),
      })]
    case 'list': {
      context.orderedInstance += block.ordered ? 1 : 0

      return buildListItems(
        block.items,
        block.ordered,
        0,
        context,
        context.orderedInstance,
      )
    }
    case 'table':
      return [
        buildTable(block, context),
        new Paragraph({ spacing: { after: 120 } }),
      ]
    case 'image': {
      const image = context.images.get(block.fileId)

      if (!image) {
        throw new RenderError('missing_asset', `Image ${block.fileId} was not provided`)
      }

      const width = Math.round(TEXT_WIDTH_PIXELS * block.widthPercent / 100)
      const height = Math.round(width * image.height / image.width)

      return [new Paragraph({
        spacing: { after: 120 },
        children: [new ImageRun({
          type: image.kind === 'png' ? 'png' : 'jpg',
          data: image.bytes,
          transformation: { width, height },
          altText: {
            name: block.alt.slice(0, 80),
            title: block.alt.slice(0, 80),
            description: block.alt,
          },
        })],
      })]
    }
    case 'quote':
      return [new Paragraph({
        indent: { left: 480 },
        spacing: { after: 120 },
        border: {
          left: {
            style: BorderStyle.SINGLE,
            size: 18,
            color: context.accent,
            space: 8,
          },
        },
        children: buildRuns(block.runs, context, true),
      })]
    case 'code': {
      const lines = splitLines(block.text)

      return [new Paragraph({
        spacing: { after: 120 },
        shading: { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' },
        children: lines.map((line, index) => {
          return new TextRun({
            text: line,
            font: CODE_FONT,
            size: 20,
            break: index > 0 ? 1 : undefined,
          })
        }),
      })]
    }
    case 'pageBreak':
      return [new Paragraph({ children: [new PageBreak()] })]
  }
}

function levelDefinitions(ordered: boolean) {
  return Array.from({ length: 3 }, (_unused, level) => {
    return {
      level,
      format: ordered
        ? ORDERED_FORMATS[level] as (typeof ORDERED_FORMATS)[number]
        : LevelFormat.BULLET,
      text: ordered ? `%${level + 1}.` : BULLET_CHARACTERS[level] as string,
      alignment: AlignmentType.LEFT,
      style: {
        paragraph: { indent: { left: 720 + level * 360, hanging: 360 } },
      },
    }
  })
}

function renumberRelationshipIds(parts: Map<string, Uint8Array>): void {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const relationshipsPart = 'word/_rels/document.xml.rels'
  const relationships = parts.get(relationshipsPart)
  const document = parts.get('word/document.xml')

  if (!relationships || !document) {
    return
  }

  const mapping = new Map<string, string>()
  const relationshipsText = decoder.decode(relationships)

  for (const match of relationshipsText.matchAll(
    /<Relationship\b[^>]*?\bId="([^"]+)"/g,
  )) {
    mapping.set(match[1] as string, `rId${mapping.size + 1}`)
  }

  const renamedRelationships = relationshipsText.replace(
    /(<Relationship\b[^>]*?\bId=")([^"]+)"/g,
    (_match, prefix: string, id: string) => `${prefix}${mapping.get(id)}"`,
  )
  const renamedDocument = decoder.decode(document).replace(
    /\b(r:(?:id|embed|link))="([^"]+)"/g,
    (match, attribute: string, id: string) => {
      const replacement = mapping.get(id)

      return replacement ? `${attribute}="${replacement}"` : match
    },
  )

  parts.set(relationshipsPart, encoder.encode(renamedRelationships))
  parts.set('word/document.xml', encoder.encode(renamedDocument))
}

function renumberDrawingIds(parts: Map<string, Uint8Array>): void {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let next = 1

  for (const [name, data] of parts) {
    if (!/^word\/(?:document|header\d*|footer\d*)\.xml$/.test(name)) {
      continue
    }

    const renumbered = decoder.decode(data).replace(
      /<wp:docPr id="\d+"/g,
      () => {
        const replacement = `<wp:docPr id="${next}"`

        next += 1

        return replacement
      },
    )

    parts.set(name, encoder.encode(renumbered))
  }
}

export async function renderDocx(
  spec: DocxSpec,
  images: Map<string, PreparedImage>,
  options: RenderOptions,
): Promise<RenderResult> {
  const theme = resolveTheme(spec)
  const accent = ACCENT_COLORS[theme.accent]
  const context: DocxContext = {
    accent,
    tint: ACCENT_TINTS[theme.accent],
    images,
    orderedInstance: 0,
  }
  const font = BODY_FONT[theme.font]
  const headingStyle = (level: 1 | 2 | 3 | 4) => ({
    run: {
      font,
      bold: true,
      color: accent,
      size: HEADING_SIZES_HALF_POINTS[level] as number,
    },
    paragraph: {
      keepNext: true,
      keepLines: true,
      spacing: { before: level === 1 ? 360 : 240, after: 120 },
    },
  })

  const document = new Document({
    title: spec.title,
    creator: 'Besidka',
    lastModifiedBy: 'Besidka',
    styles: {
      default: {
        document: {
          run: {
            font,
            size: BODY_SIZE_HALF_POINTS,
            language: spec.language ? { value: spec.language } : undefined,
          },
        },
        heading1: headingStyle(1),
        heading2: headingStyle(2),
        heading3: headingStyle(3),
        heading4: headingStyle(4),
        hyperlink: { run: { color: accent, underline: {} } },
      },
    },
    numbering: {
      config: [
        { reference: 'besidka-bullets', levels: levelDefinitions(false) },
        { reference: 'besidka-ordered', levels: levelDefinitions(true) },
      ],
    },
    sections: [{
      children: spec.blocks.flatMap(block => buildBlock(block, context)),
    }],
  })

  let packed: Uint8Array

  try {
    packed = new Uint8Array(await Packer.toArrayBuffer(document))
  } catch (exception) {
    throw new RenderError(
      'render_failed',
      `DOCX packing failed: ${exception instanceof Error ? exception.message : 'unknown'}`,
    )
  }

  const stamped = stampOoxml(packed, {
    ...(options.provenance ?? DEFAULT_PROVENANCE),
    title: spec.title,
    language: spec.language,
    createdAt: options.createdAt ?? PINNED_DOCUMENT_DATE,
    normalizeParts: (parts) => {
      renumberRelationshipIds(parts)
      renumberDrawingIds(parts)
    },
  })

  if (!stamped.ok) {
    throw new RenderError('render_failed', `DOCX stamp failed: ${stamped.code}`)
  }

  return {
    bytes: stamped.bytes,
    mediaType: MEDIA_TYPES.docx,
    extension: 'docx',
    stats: { blocks: spec.blocks.length },
    warnings: [],
  }
}
