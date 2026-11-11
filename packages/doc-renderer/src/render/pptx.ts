import PptxGenJS from 'pptxgenjs'
import { PINNED_DOCUMENT_DATE } from '../constants.ts'
import { stampOoxml } from '../stamp/ooxml.ts'
import type { Block, ListItem, PptxSpec, Run, Slide } from '../spec/v1.ts'
import {
  ACCENT_COLORS,
  DEFAULT_PROVENANCE,
  MEDIA_TYPES,
  plainText,
  resolveTheme,
} from './common.ts'
import type { RenderOptions, RenderResult } from './common.ts'
import { RenderError } from './errors.ts'
import { bytesToBase64 } from './images.ts'
import type { PreparedImage } from './images.ts'

type TextRun = PptxGenJS.TextProps

interface Geometry {
  width: number
  height: number
  marginX: number
  bodyTop: number
  bodyBottom: number
}

interface Palette {
  accent: string
  text: string
  muted: string
  fontFace: string
  language: string | undefined
}

const MASTER_CONTENT = 'BESIDKA_CONTENT'
const MASTER_TITLE = 'BESIDKA_TITLE'
const MASTER_SECTION = 'BESIDKA_SECTION'
const COLUMN_GAP = 0.4
const CODE_FONT = 'Courier New'
const POINTS_PER_INCH = 72
const LINE_HEIGHT_FACTOR = 1.35

function geometryFor(aspect: PptxSpec['aspect']): Geometry {
  const height = aspect === '16:9' ? 5.625 : 7.5

  return {
    width: 10,
    height,
    marginX: 0.6,
    bodyTop: 1.55,
    bodyBottom: height - 0.55,
  }
}

function runOptions(run: Run, palette: Palette, extra: object = {}) {
  return {
    bold: run.bold,
    italic: run.italic,
    underline: run.underline || run.link ? { style: 'sng' as const } : undefined,
    fontFace: run.code ? CODE_FONT : undefined,
    color: run.link ? palette.accent : undefined,
    hyperlink: run.link ? { url: run.link.href } : undefined,
    lang: palette.language,
    ...extra,
  }
}

function paragraphRuns(
  runs: readonly Run[],
  palette: Palette,
  paragraphOptions: object,
  extra: object = {},
): TextRun[] {
  return runs.map((run, index) => {
    const isLast = index === runs.length - 1

    return {
      text: run.text,
      options: runOptions(run, palette, {
        ...extra,
        ...(index === 0 ? paragraphOptions : {}),
        breakLine: isLast ? true : undefined,
      }),
    }
  })
}

function listRuns(
  items: readonly ListItem[],
  ordered: boolean,
  level: number,
  palette: Palette,
  fontSize: number,
): TextRun[] {
  const result: TextRun[] = []

  for (const item of items) {
    result.push(...paragraphRuns(
      item.runs,
      palette,
      {
        bullet: ordered ? { type: 'number' as const } : true,
        indentLevel: level,
      },
      { fontSize },
    ))

    if (item.children) {
      result.push(...listRuns(
        item.children as ListItem[],
        ordered,
        level + 1,
        palette,
        fontSize,
      ))
    }
  }

  return result
}

function fontSizeFor(characters: number, base: number): number {
  if (characters > 1200) {
    return Math.max(10, base - 6)
  }

  if (characters > 700) {
    return Math.max(11, base - 4)
  }

  if (characters > 400) {
    return Math.max(12, base - 2)
  }

  return base
}

function blockCharacters(block: Block): number {
  switch (block.type) {
    case 'heading':
      return block.text.length
    case 'paragraph':
    case 'quote':
      return plainText(block.runs).length
    case 'code':
      return block.text.length
    case 'list': {
      const count = (items: readonly ListItem[]): number => {
        return items.reduce((total, item) => {
          return total + plainText(item.runs).length
            + (item.children ? count(item.children as ListItem[]) : 0)
        }, 0)
      }

      return count(block.items)
    }
    default:
      return 0
  }
}

function estimateTextHeight(
  characters: number,
  widthInches: number,
  fontSize: number,
): number {
  const charactersPerLine = Math.max(
    8,
    (widthInches * POINTS_PER_INCH) / (fontSize * 0.52),
  )
  const lines = Math.max(1, Math.ceil(characters / charactersPerLine))

  return (lines * fontSize * LINE_HEIGHT_FACTOR) / POINTS_PER_INCH
}

function embedImage(
  slide: PptxGenJS.Slide,
  image: PreparedImage,
  alt: string,
  box: { x: number, y: number, w: number, h: number },
): number {
  const scale = Math.min(box.w / image.width, box.h / image.height)
  const width = image.width * scale
  const height = image.height * scale

  slide.addImage({
    data: `${image.mediaType};base64,${bytesToBase64(image.bytes)}`,
    x: box.x + (box.w - width) / 2,
    y: box.y,
    w: width,
    h: height,
    altText: alt,
  })

  return height
}

function renderBlocks(
  slide: PptxGenJS.Slide,
  blocks: readonly Block[],
  box: { x: number, y: number, w: number, h: number },
  palette: Palette,
  images: Map<string, PreparedImage>,
): void {
  const totalCharacters = blocks.reduce(
    (total, block) => total + blockCharacters(block),
    0,
  )
  const fontSize = fontSizeFor(totalCharacters, 18)
  let pending: TextRun[] = []
  let pendingCharacters = 0
  let cursorY = box.y

  const flushText = () => {
    if (pending.length === 0) {
      return
    }

    const height = Math.min(
      box.y + box.h - cursorY,
      estimateTextHeight(pendingCharacters, box.w, fontSize) + 0.15,
    )

    slide.addText(pending, {
      x: box.x,
      y: cursorY,
      w: box.w,
      h: Math.max(0.3, height),
      fontSize,
      fontFace: palette.fontFace,
      color: palette.text,
      valign: 'top',
      margin: 0,
      lang: palette.language,
    })
    cursorY += height + 0.1
    pending = []
    pendingCharacters = 0
  }

  for (const block of blocks) {
    if (block.type === 'heading') {
      pending.push({
        text: block.text,
        options: {
          bold: true,
          fontSize: fontSize + 2,
          color: palette.accent,
          breakLine: true,
        },
      })
    } else if (block.type === 'paragraph') {
      pending.push(...paragraphRuns(block.runs, palette, {}))
    } else if (block.type === 'quote') {
      pending.push(...paragraphRuns(
        block.runs,
        palette,
        { indentLevel: 1 },
        { italic: true },
      ))
    } else if (block.type === 'code') {
      pending.push({
        text: block.text,
        options: {
          fontFace: CODE_FONT,
          fontSize: Math.max(10, fontSize - 4),
          breakLine: true,
        },
      })
    } else if (block.type === 'list') {
      pending.push(
        ...listRuns(block.items, block.ordered, 0, palette, fontSize),
      )
    } else if (block.type === 'image') {
      flushText()

      const image = images.get(block.fileId)

      if (!image) {
        throw new RenderError('missing_asset', `Image ${block.fileId} was not provided`)
      }

      const remaining = box.y + box.h - cursorY
      const width = box.w * block.widthPercent / 100

      cursorY += embedImage(
        slide,
        image,
        block.alt,
        { x: box.x, y: cursorY, w: width, h: Math.max(0.5, remaining) },
      ) + 0.1
    } else if (block.type === 'table') {
      flushText()

      const rows: PptxGenJS.TableRow[] = []

      if (block.header) {
        rows.push(block.columns.map((column) => {
          return {
            text: column.text,
            options: { bold: true, fill: { color: 'E5E7EB' }, align: column.align === 'justify' ? 'left' : column.align },
          }
        }))
      }

      for (const row of block.rows) {
        rows.push(row.map((cell, columnIndex) => {
          const align = block.columns[columnIndex]?.align

          return {
            text: plainText(cell),
            options: { align: align === 'justify' ? 'left' : align },
          }
        }))
      }

      slide.addTable(rows, {
        x: box.x,
        y: cursorY,
        w: box.w,
        fontSize: Math.max(9, fontSize - 6),
        fontFace: palette.fontFace,
        color: palette.text,
        border: { type: 'solid', pt: 0.5, color: 'C7CCD4' },
      })
      cursorY += Math.min(box.y + box.h - cursorY, 0.3 * rows.length)
    }

    pendingCharacters += blockCharacters(block)
  }

  flushText()
}

function addSlide(
  pptx: PptxGenJS,
  slide: Slide,
  geometry: Geometry,
  palette: Palette,
  images: Map<string, PreparedImage>,
): void {
  const contentWidth = geometry.width - geometry.marginX * 2

  if (slide.layout === 'title') {
    const page = pptx.addSlide({ masterName: MASTER_TITLE })

    page.addText(slide.title, { placeholder: 'title' })

    if (slide.subtitle) {
      page.addText(slide.subtitle, {
        x: geometry.marginX,
        y: geometry.height * 0.3 + 1.45,
        w: contentWidth,
        h: 0.8,
        fontSize: 20,
        fontFace: palette.fontFace,
        color: palette.muted,
        lang: palette.language,
        align: 'center',
        valign: 'top',
      })
    }

    if (slide.notes) {
      page.addNotes(slide.notes)
    }

    return
  }

  if (slide.layout === 'section') {
    const page = pptx.addSlide({ masterName: MASTER_SECTION })

    page.addText(slide.title, { placeholder: 'title' })

    if (slide.notes) {
      page.addNotes(slide.notes)
    }

    return
  }

  const page = pptx.addSlide({ masterName: MASTER_CONTENT })
  const bodyHeight = geometry.bodyBottom - geometry.bodyTop

  page.addText(slide.title, { placeholder: 'title' })

  if (slide.layout === 'title-content') {
    const bullets = (slide.bullets ?? []).flatMap((bullet) => {
      return paragraphRuns(bullet, palette, { bullet: true }, {})
    })
    const characters = (slide.bullets ?? []).reduce((total, bullet) => {
      return total + plainText(bullet).length
    }, 0)

    if (bullets.length > 0) {
      page.addText(bullets, {
        x: geometry.marginX,
        y: geometry.bodyTop,
        w: contentWidth,
        h: bodyHeight,
        fontSize: fontSizeFor(characters, 22),
        fontFace: palette.fontFace,
        color: palette.text,
        lang: palette.language,
        valign: 'top',
        margin: 0,
        paraSpaceAfter: 8,
      })
    }
  } else if (slide.layout === 'two-column' && slide.columns) {
    const columnWidth = (contentWidth - COLUMN_GAP) / 2

    slide.columns.forEach((blocks, columnIndex) => {
      renderBlocks(
        page,
        blocks,
        {
          x: geometry.marginX + columnIndex * (columnWidth + COLUMN_GAP),
          y: geometry.bodyTop,
          w: columnWidth,
          h: bodyHeight,
        },
        palette,
        images,
      )
    })
  } else if (slide.layout === 'image' && slide.image) {
    const image = images.get(slide.image.fileId)

    if (!image) {
      throw new RenderError('missing_asset', `Image ${slide.image.fileId} was not provided`)
    }

    const captionHeight = slide.subtitle ? 0.6 : 0

    embedImage(
      page,
      image,
      slide.image.alt,
      {
        x: geometry.marginX,
        y: geometry.bodyTop,
        w: contentWidth,
        h: bodyHeight - captionHeight,
      },
    )

    if (slide.subtitle) {
      page.addText(slide.subtitle, {
        x: geometry.marginX,
        y: geometry.bodyBottom - 0.5,
        w: contentWidth,
        h: 0.5,
        fontSize: 14,
        fontFace: palette.fontFace,
        color: palette.muted,
        lang: palette.language,
        align: 'center',
        valign: 'middle',
      })
    }
  }

  if (slide.notes) {
    page.addNotes(slide.notes)
  }
}

export async function renderPptx(
  spec: PptxSpec,
  images: Map<string, PreparedImage>,
  options: RenderOptions,
): Promise<RenderResult> {
  const theme = resolveTheme(spec)
  const geometry = geometryFor(spec.aspect)
  const palette: Palette = {
    accent: ACCENT_COLORS[theme.accent],
    text: '1F2937',
    muted: '6B7280',
    fontFace: theme.font === 'serif' ? 'Times New Roman' : 'Arial',
    language: spec.language,
  }
  const pptx = new PptxGenJS()
  const contentWidth = geometry.width - geometry.marginX * 2

  pptx.layout = spec.aspect === '16:9' ? 'LAYOUT_16x9' : 'LAYOUT_4x3'
  pptx.title = spec.title
  pptx.author = 'Besidka'
  pptx.company = 'Besidka'
  pptx.theme = {
    headFontFace: palette.fontFace,
    bodyFontFace: palette.fontFace,
  }

  pptx.defineSlideMaster({
    title: MASTER_CONTENT,
    background: { color: 'FFFFFF' },
    objects: [{
      placeholder: {
        options: {
          name: 'title',
          type: 'title',
          x: geometry.marginX,
          y: 0.4,
          w: contentWidth,
          h: 0.9,
          fontSize: 28,
          bold: true,
          color: palette.accent,
          fontFace: palette.fontFace,
          lang: palette.language,
          align: 'left',
          valign: 'middle',
        },
        text: '',
      },
    }],
    slideNumber: {
      x: geometry.width - 1,
      y: geometry.height - 0.45,
      fontSize: 10,
      color: palette.muted,
    },
  })
  pptx.defineSlideMaster({
    title: MASTER_TITLE,
    background: { color: 'FFFFFF' },
    objects: [{
      placeholder: {
        options: {
          name: 'title',
          type: 'title',
          x: geometry.marginX,
          y: geometry.height * 0.3,
          w: contentWidth,
          h: 1.4,
          fontSize: 40,
          bold: true,
          color: palette.accent,
          fontFace: palette.fontFace,
          lang: palette.language,
          align: 'center',
          valign: 'middle',
        },
        text: '',
      },
    }],
  })
  pptx.defineSlideMaster({
    title: MASTER_SECTION,
    background: { color: palette.accent },
    objects: [{
      placeholder: {
        options: {
          name: 'title',
          type: 'title',
          x: geometry.marginX,
          y: geometry.height * 0.35,
          w: contentWidth,
          h: 1.4,
          fontSize: 36,
          bold: true,
          color: 'FFFFFF',
          fontFace: palette.fontFace,
          lang: palette.language,
          valign: 'middle',
        },
        text: '',
      },
    }],
  })

  for (const slide of spec.slides) {
    addSlide(pptx, slide, geometry, palette, images)
  }

  let packed: Uint8Array

  try {
    packed = await pptx.write({ outputType: 'uint8array' }) as Uint8Array
  } catch (exception) {
    throw new RenderError(
      'render_failed',
      `PPTX writing failed: ${exception instanceof Error ? exception.message : 'unknown'}`,
    )
  }

  const stamped = stampOoxml(packed, {
    ...(options.provenance ?? DEFAULT_PROVENANCE),
    title: spec.title,
    language: spec.language,
    createdAt: options.createdAt ?? PINNED_DOCUMENT_DATE,
  })

  if (!stamped.ok) {
    throw new RenderError('render_failed', `PPTX stamp failed: ${stamped.code}`)
  }

  return {
    bytes: stamped.bytes,
    mediaType: MEDIA_TYPES.pptx,
    extension: 'pptx',
    stats: { slides: spec.slides.length },
    warnings: [],
  }
}
