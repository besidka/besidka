import fontkit from '@pdf-lib/fontkit'
import {
  PDFDocument,
  PDFName,
  PDFString,
  rgb,
} from 'pdf-lib'
import type { PDFFont, PDFImage, PDFPage } from 'pdf-lib'
import { PINNED_DOCUMENT_DATE } from '../constants.ts'
import { buildPdfXmp } from '../provenance.ts'
import type { Block, ListItem, PdfSpec, Run, TableBlock } from '../spec/v1.ts'
import { SPEC_LIMITS } from '../spec/v1.ts'
import { VALIDATION_LIMITS } from '../validate/rules.ts'
import {
  ACCENT_COLORS,
  ACCENT_TINTS,
  DEFAULT_PROVENANCE,
  MEDIA_TYPES,
  hexToRgb,
  resolveTheme,
  splitLines,
} from './common.ts'
import type { RenderOptions, RenderResult } from './common.ts'
import { RenderError } from './errors.ts'
import type { PreparedImage } from './images.ts'

type FontKey = 'regular' | 'bold' | 'italic'
type Align = 'left' | 'center' | 'right' | 'justify'
type Rgb = ReturnType<typeof rgb>

interface Style {
  font: FontKey
  size: number
  color: Rgb
  underline: boolean
  href: string | null
  background: Rgb | null
}

interface Atom {
  text: string
  width: number
  style: Style
  isSpace: boolean
  isBreak: boolean
}

interface Line {
  atoms: Atom[]
  width: number
  height: number
}

interface PageSizes {
  width: number
  height: number
}

const PAGE_SIZES: Record<PdfSpec['pageSize'], PageSizes> = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
}
const MARGIN = 56
const BODY_SIZE = 11
const LINE_FACTOR = 1.4
const HEADING_SIZES = [0, 22, 17, 14, 12]
const BLOCK_GAP = 7
const LIST_INDENT = 18
const CELL_PADDING = 4
const FOOTER_SIZE = 8
const CODE_SIZE = 9.5
const REPLACEMENT_CHARACTER = '?'
const BULLETS = ['•', '–', '·']
const TEXT_COLOR = rgb(0.1, 0.1, 0.12)
const MUTED_COLOR = rgb(0.45, 0.47, 0.5)
const CODE_BACKGROUND = rgb(0.953, 0.957, 0.965)
const BORDER_COLOR = rgb(0.78, 0.8, 0.83)

class Layout {
  readonly pdf: PDFDocument
  readonly fonts: Record<FontKey, PDFFont>
  readonly page: PageSizes
  readonly accent: Rgb
  readonly tint: Rgb
  readonly images: Map<string, PreparedImage>
  readonly warnings: string[] = []
  readonly pages: PDFPage[] = []
  readonly embeddedImages = new Map<string, PDFImage>()
  private readonly widthCache: Record<FontKey, Map<string, number>>
  private readonly charsets: Record<FontKey, Set<number>>
  private readonly replaced = new Set<string>()
  current!: PDFPage
  cursor = 0

  constructor(
    pdf: PDFDocument,
    fonts: Record<FontKey, PDFFont>,
    page: PageSizes,
    accent: Rgb,
    tint: Rgb,
    images: Map<string, PreparedImage>,
  ) {
    this.pdf = pdf
    this.fonts = fonts
    this.page = page
    this.accent = accent
    this.tint = tint
    this.images = images
    this.widthCache = {
      regular: new Map(),
      bold: new Map(),
      italic: new Map(),
    }
    this.charsets = {
      regular: new Set(fonts.regular.getCharacterSet()),
      bold: new Set(fonts.bold.getCharacterSet()),
      italic: new Set(fonts.italic.getCharacterSet()),
    }
  }

  get contentWidth(): number {
    return this.page.width - MARGIN * 2
  }

  get bottomLimit(): number {
    return MARGIN + 14
  }

  startPage(): void {
    if (this.pages.length >= SPEC_LIMITS.estimatedPagesMax) {
      throw new RenderError(
        'page_limit',
        `Document exceeds ${SPEC_LIMITS.estimatedPagesMax} pages`,
      )
    }

    this.current = this.pdf.addPage([this.page.width, this.page.height])
    this.pages.push(this.current)
    this.cursor = this.page.height - MARGIN
  }

  ensureSpace(height: number): void {
    if (this.cursor - height < this.bottomLimit) {
      this.startPage()
    }
  }

  sanitize(font: FontKey, text: string): string {
    const charset = this.charsets[font]
    let result = ''

    for (const character of text) {
      const codePoint = character.codePointAt(0) as number

      if (codePoint === 0x09) {
        result += '    '
      } else if (codePoint < 0x20 || codePoint === 0x7F) {
        continue
      } else if (charset.has(codePoint)) {
        result += character
      } else {
        this.replaced.add(character)
        result += REPLACEMENT_CHARACTER
      }
    }

    return result
  }

  measure(font: FontKey, size: number, text: string): number {
    const cache = this.widthCache[font]
    let unit = cache.get(text)

    if (unit === undefined) {
      unit = this.fonts[font].widthOfTextAtSize(text, 100) / 100
      cache.set(text, unit)
    }

    return unit * size
  }

  collectWarnings(): string[] {
    if (this.replaced.size > 0) {
      const sample = [...this.replaced].slice(0, 10).join(' ')

      this.warnings.push(
        `${this.replaced.size} unsupported character(s) replaced with ?: ${sample}`,
      )
    }

    return this.warnings
  }
}

function makeStyle(
  layout: Layout,
  run: Run | null,
  base: Partial<Style> = {},
): Style {
  const isLink = Boolean(run?.link)
  let font: FontKey = base.font ?? 'regular'

  if (run?.bold) {
    font = 'bold'
  } else if (run?.italic && font === 'regular') {
    font = 'italic'
  }

  return {
    font,
    size: base.size ?? BODY_SIZE,
    color: isLink ? layout.accent : (base.color ?? TEXT_COLOR),
    underline: Boolean(run?.underline) || isLink,
    href: run?.link?.href ?? null,
    background: run?.code ? CODE_BACKGROUND : (base.background ?? null),
  }
}

function tokenize(
  layout: Layout,
  runs: readonly Run[],
  base: Partial<Style>,
): Atom[] {
  const atoms: Atom[] = []

  for (const run of runs) {
    const style = makeStyle(layout, run, base)
    const text = run.text.replace(/\r\n?/g, '\n')
    const pattern = /(\n)|([ \t]+)|([^\s]+)/g

    for (const match of text.matchAll(pattern)) {
      if (match[1]) {
        atoms.push({ text: '', width: 0, style, isSpace: false, isBreak: true })
      } else if (match[2]) {
        const spaced = layout.sanitize(style.font, ' '.repeat(match[2].length))

        atoms.push({
          text: spaced,
          width: layout.measure(style.font, style.size, spaced),
          style,
          isSpace: true,
          isBreak: false,
        })
      } else if (match[3]) {
        const word = layout.sanitize(style.font, match[3])

        atoms.push({
          text: word,
          width: layout.measure(style.font, style.size, word),
          style,
          isSpace: false,
          isBreak: false,
        })
      }
    }
  }

  return atoms
}

function splitOversizedAtom(
  layout: Layout,
  atom: Atom,
  maxWidth: number,
): Atom[] {
  if (atom.width <= maxWidth || atom.isSpace) {
    return [atom]
  }

  const pieces: Atom[] = []
  let chunk = ''

  for (const character of atom.text) {
    const candidate = chunk + character
    const width = layout.measure(atom.style.font, atom.style.size, candidate)

    if (width > maxWidth && chunk) {
      pieces.push({
        ...atom,
        text: chunk,
        width: layout.measure(atom.style.font, atom.style.size, chunk),
      })
      chunk = character
    } else {
      chunk = candidate
    }
  }

  if (chunk) {
    pieces.push({
      ...atom,
      text: chunk,
      width: layout.measure(atom.style.font, atom.style.size, chunk),
    })
  }

  return pieces
}

function wrap(
  layout: Layout,
  atoms: Atom[],
  maxWidth: number,
  lineSize: number,
  keepLeadingSpace: boolean,
): Line[] {
  const lines: Line[] = []
  let current: Atom[] = []
  let width = 0

  const finish = () => {
    while (
      current.length > 0
      && (current[current.length - 1] as Atom).isSpace
    ) {
      const removed = current.pop() as Atom

      width -= removed.width
    }

    const height = current.reduce((tallest, atom) => {
      return Math.max(tallest, atom.style.size)
    }, lineSize) * LINE_FACTOR

    lines.push({ atoms: current, width, height })
    current = []
    width = 0
  }

  for (const original of atoms) {
    if (original.isBreak) {
      finish()
      continue
    }

    for (const atom of splitOversizedAtom(layout, original, maxWidth)) {
      if (atom.isSpace && current.length === 0 && !keepLeadingSpace) {
        continue
      }

      const overflows = width + atom.width > maxWidth

      if (!atom.isSpace && overflows && current.length > 0) {
        finish()
      }

      current.push(atom)
      width += atom.width
    }
  }

  finish()

  return lines
}

function layoutRuns(
  layout: Layout,
  runs: readonly Run[],
  maxWidth: number,
  base: Partial<Style> = {},
  keepLeadingSpace = false,
): Line[] {
  return wrap(
    layout,
    tokenize(layout, runs, base),
    maxWidth,
    base.size ?? BODY_SIZE,
    keepLeadingSpace,
  )
}

function addLinkAnnotation(
  layout: Layout,
  page: PDFPage,
  href: string,
  rect: [number, number, number, number],
): void {
  const { context } = layout.pdf
  const annotation = context.register(context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(href) },
  }))

  page.node.addAnnot(annotation)
}

function drawLine(
  layout: Layout,
  page: PDFPage,
  line: Line,
  x: number,
  top: number,
  maxWidth: number,
  align: Align,
  isLast: boolean,
): void {
  const baseline = top - line.height * 0.78
  let offset = 0

  if (align === 'center') {
    offset = (maxWidth - line.width) / 2
  } else if (align === 'right') {
    offset = maxWidth - line.width
  }

  const gaps = line.atoms.filter(atom => atom.isSpace).length
  const extraPerGap = align === 'justify' && !isLast && gaps > 0
    ? (maxWidth - line.width) / gaps
    : 0
  let cursorX = x + offset
  let index = 0

  while (index < line.atoms.length) {
    const first = line.atoms[index] as Atom
    let text = ''
    let width = 0
    let end = index

    while (end < line.atoms.length) {
      const atom = line.atoms[end] as Atom
      const sameStyle = atom.style.font === first.style.font
        && atom.style.size === first.style.size
        && atom.style.color === first.style.color
        && atom.style.underline === first.style.underline
        && atom.style.href === first.style.href
        && atom.style.background === first.style.background

      if (!sameStyle || (extraPerGap > 0 && atom.isSpace && end > index)) {
        break
      }

      text += atom.text
      width += atom.width + (atom.isSpace ? extraPerGap : 0)
      end += 1
    }

    if (end === index) {
      text = first.text
      width = first.width + (first.isSpace ? extraPerGap : 0)
      end = index + 1
    }

    const { style } = first

    if (style.background) {
      page.drawRectangle({
        x: cursorX,
        y: baseline - style.size * 0.25,
        width,
        height: style.size * 1.2,
        color: style.background,
      })
    }

    if (text.trim()) {
      page.drawText(text, {
        x: cursorX,
        y: baseline,
        size: style.size,
        font: layout.fonts[style.font],
        color: style.color,
      })
    }

    if (style.underline && text.trim()) {
      page.drawLine({
        start: { x: cursorX, y: baseline - style.size * 0.12 },
        end: { x: cursorX + width, y: baseline - style.size * 0.12 },
        thickness: 0.6,
        color: style.color,
      })
    }

    if (style.href && text.trim()) {
      addLinkAnnotation(
        layout,
        page,
        style.href,
        [
          cursorX,
          baseline - style.size * 0.25,
          cursorX + width,
          baseline + style.size * 0.85,
        ],
      )
    }

    cursorX += width
    index = end
  }
}

function drawLines(
  layout: Layout,
  lines: Line[],
  x: number,
  maxWidth: number,
  align: Align,
): void {
  lines.forEach((line, index) => {
    layout.ensureSpace(line.height)
    drawLine(
      layout,
      layout.current,
      line,
      x,
      layout.cursor,
      maxWidth,
      align,
      index === lines.length - 1,
    )
    layout.cursor -= line.height
  })
}

function renderHeading(
  layout: Layout,
  block: Extract<Block, { type: 'heading' }>,
  followingHeight: number,
): void {
  const size = HEADING_SIZES[block.level] as number
  const lines = layoutRuns(
    layout,
    [{ text: block.text }],
    layout.contentWidth,
    { font: 'bold', size, color: block.level <= 2 ? layout.accent : TEXT_COLOR },
  )
  const firstHeight = lines[0]?.height ?? size * LINE_FACTOR

  layout.ensureSpace(
    size * 0.9
    + firstHeight
    + Math.max(BODY_SIZE * LINE_FACTOR * 2, followingHeight),
  )
  layout.cursor -= size * 0.6
  drawLines(layout, lines, MARGIN, layout.contentWidth, 'left')
  layout.cursor -= size * 0.25
}

function renderParagraph(
  layout: Layout,
  runs: readonly Run[],
  align: Align,
  indent = 0,
): void {
  const width = layout.contentWidth - indent
  const lines = layoutRuns(layout, runs, width)

  drawLines(layout, lines, MARGIN + indent, width, align)
  layout.cursor -= BLOCK_GAP
}

function renderListItems(
  layout: Layout,
  items: readonly ListItem[],
  ordered: boolean,
  depth: number,
): void {
  items.forEach((item, index) => {
    const indent = LIST_INDENT * (depth + 1)
    const width = layout.contentWidth - indent
    const lines = layoutRuns(layout, item.runs, width)
    const marker = ordered ? `${index + 1}.` : (BULLETS[depth] as string)
    const markerText = layout.sanitize('regular', marker)

    layout.ensureSpace(lines[0]?.height ?? BODY_SIZE * LINE_FACTOR)

    const markerWidth = layout.measure('regular', BODY_SIZE, markerText)

    layout.current.drawText(markerText, {
      x: MARGIN + indent - 4 - markerWidth,
      y: layout.cursor - BODY_SIZE * LINE_FACTOR * 0.78,
      size: BODY_SIZE,
      font: layout.fonts.regular,
      color: TEXT_COLOR,
    })
    drawLines(layout, lines, MARGIN + indent, width, 'left')
    layout.cursor -= 2

    if (item.children) {
      renderListItems(layout, item.children as ListItem[], ordered, depth + 1)
    }
  })

  if (depth === 0) {
    layout.cursor -= BLOCK_GAP - 2
  }
}

function renderQuote(layout: Layout, runs: readonly Run[]): void {
  const indent = 16
  const width = layout.contentWidth - indent
  const lines = layoutRuns(layout, runs, width, { font: 'italic' })

  lines.forEach((line) => {
    layout.ensureSpace(line.height)
    layout.current.drawRectangle({
      x: MARGIN + 3,
      y: layout.cursor - line.height,
      width: 2.5,
      height: line.height,
      color: layout.accent,
    })
    drawLine(layout, layout.current, line, MARGIN + indent, layout.cursor, width, 'left', true)
    layout.cursor -= line.height
  })
  layout.cursor -= BLOCK_GAP
}

function renderCode(layout: Layout, text: string): void {
  const padding = 6
  const width = layout.contentWidth - padding * 2
  const lines = splitLines(text).flatMap((raw) => {
    return layoutRuns(
      layout,
      [{ text: raw.length > 0 ? raw : ' ' }],
      width,
      { size: CODE_SIZE },
      true,
    )
  })

  lines.forEach((line) => {
    layout.ensureSpace(line.height)
    layout.current.drawRectangle({
      x: MARGIN,
      y: layout.cursor - line.height,
      width: layout.contentWidth,
      height: line.height,
      color: CODE_BACKGROUND,
    })
    drawLine(layout, layout.current, line, MARGIN + padding, layout.cursor, width, 'left', true)
    layout.cursor -= line.height
  })
  layout.cursor -= BLOCK_GAP
}

async function embedImage(
  layout: Layout,
  fileId: string,
  image: PreparedImage,
): Promise<PDFImage> {
  const cached = layout.embeddedImages.get(fileId)

  if (cached) {
    return cached
  }

  const embedded = image.kind === 'png'
    ? await layout.pdf.embedPng(image.bytes)
    : await layout.pdf.embedJpg(image.bytes)

  layout.embeddedImages.set(fileId, embedded)

  return embedded
}

async function renderImage(
  layout: Layout,
  block: Extract<Block, { type: 'image' }>,
): Promise<void> {
  const image = layout.images.get(block.fileId)

  if (!image) {
    throw new RenderError('missing_asset', `Image ${block.fileId} was not provided`)
  }

  const embedded = await embedImage(layout, block.fileId, image)
  const maxWidth = layout.contentWidth * block.widthPercent / 100
  const maxHeight = layout.page.height - MARGIN * 2 - 30
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height)
  const width = image.width * scale
  const height = image.height * scale

  layout.ensureSpace(height)
  layout.current.drawImage(embedded, {
    x: MARGIN,
    y: layout.cursor - height,
    width,
    height,
  })
  layout.cursor -= height + BLOCK_GAP
}

function columnWidths(layout: Layout, table: TableBlock): number[] {
  const weights = table.columns.map((column, columnIndex) => {
    const lengths = [column.text.length]

    for (const row of table.rows.slice(0, 60)) {
      lengths.push((row[columnIndex] ?? []).reduce((total, run) => {
        return total + run.text.length
      }, 0))
    }

    const average = lengths.reduce((total, value) => total + value, 0)
      / lengths.length

    return Math.min(40, Math.max(6, average))
  })
  const total = weights.reduce((sum, weight) => sum + weight, 0)

  return weights.map(weight => layout.contentWidth * weight / total)
}

function renderTable(layout: Layout, table: TableBlock): void {
  const widths = columnWidths(layout, table)
  const lineHeight = BODY_SIZE * LINE_FACTOR

  const cellLines = (
    cell: readonly Run[],
    columnIndex: number,
    isHeader: boolean,
  ) => {
    const width = (widths[columnIndex] as number) - CELL_PADDING * 2
    const runs = cell.length > 0 ? cell : [{ text: ' ' }]

    return layoutRuns(layout, runs, width, isHeader ? { font: 'bold' } : {})
  }

  const drawRow = (
    columns: Line[][],
    isHeader: boolean,
    aligns: (Align | undefined)[],
  ) => {
    const maxLines = Math.max(...columns.map(lines => lines.length))
    let start = 0

    while (start < maxLines) {
      const available = layout.cursor - layout.bottomLimit
      const fit = Math.floor((available - CELL_PADDING * 2) / lineHeight)

      if (fit < 1) {
        layout.startPage()

        if (!isHeader && table.header) {
          drawRow(
            table.columns.map((column, columnIndex) => {
              return cellLines([{ text: column.text }], columnIndex, true)
            }),
            true,
            table.columns.map(column => column.align),
          )
        }

        continue
      }

      const count = Math.min(fit, maxLines - start)
      const height = count * lineHeight + CELL_PADDING * 2
      let x = MARGIN

      columns.forEach((lines, columnIndex) => {
        const width = widths[columnIndex] as number

        layout.current.drawRectangle({
          x,
          y: layout.cursor - height,
          width,
          height,
          color: isHeader ? layout.tint : undefined,
          borderColor: BORDER_COLOR,
          borderWidth: 0.5,
        })

        const slice = lines.slice(start, start + count)

        slice.forEach((line, lineIndex) => {
          drawLine(
            layout,
            layout.current,
            line,
            x + CELL_PADDING,
            layout.cursor - CELL_PADDING - lineIndex * lineHeight,
            width - CELL_PADDING * 2,
            aligns[columnIndex] ?? 'left',
            true,
          )
        })
        x += width
      })

      layout.cursor -= height
      start += count
    }
  }

  if (table.header) {
    drawRow(
      table.columns.map((column, columnIndex) => {
        return cellLines([{ text: column.text }], columnIndex, true)
      }),
      true,
      table.columns.map(column => column.align),
    )
  }

  for (const row of table.rows) {
    drawRow(
      row.map((cell, columnIndex) => cellLines(cell, columnIndex, false)),
      false,
      table.columns.map(column => column.align),
    )
  }

  layout.cursor -= BLOCK_GAP
}

function imageHeight(
  layout: Layout,
  block: Extract<Block, { type: 'image' }>,
): number {
  const image = layout.images.get(block.fileId)

  if (!image) {
    return 0
  }

  const maxWidth = layout.contentWidth * block.widthPercent / 100
  const maxHeight = layout.page.height - MARGIN * 2 - 30

  return image.height
    * Math.min(maxWidth / image.width, maxHeight / image.height)
}

async function renderBlock(
  layout: Layout,
  block: Block,
  next: Block | undefined,
): Promise<void> {
  switch (block.type) {
    case 'heading':
      renderHeading(
        layout,
        block,
        next?.type === 'image' ? imageHeight(layout, next) : 0,
      )
      return
    case 'paragraph':
      renderParagraph(layout, block.runs, block.align ?? 'left')
      return
    case 'list':
      renderListItems(layout, block.items, block.ordered, 0)
      return
    case 'table':
      renderTable(layout, block)
      return
    case 'image':
      await renderImage(layout, block)
      return
    case 'quote':
      renderQuote(layout, block.runs)
      return
    case 'code':
      renderCode(layout, block.text)
      return
    case 'pageBreak':
      layout.startPage()
  }
}

function drawFooters(layout: Layout): void {
  const total = layout.pages.length

  layout.pages.forEach((page, index) => {
    const label = `${index + 1} / ${total}`
    const width = layout.measure('regular', FOOTER_SIZE, label)

    page.drawText(label, {
      x: (layout.page.width - width) / 2,
      y: MARGIN - 18,
      size: FOOTER_SIZE,
      font: layout.fonts.regular,
      color: MUTED_COLOR,
    })
  })
}

export async function renderPdf(
  spec: PdfSpec,
  images: Map<string, PreparedImage>,
  options: RenderOptions,
): Promise<RenderResult> {
  if (!options.fonts) {
    throw new RenderError('font_missing', 'PDF rendering needs the Noto Sans fonts')
  }

  const theme = resolveTheme(spec)
  const createdAt = new Date(options.createdAt ?? PINNED_DOCUMENT_DATE)
  const pdf = await PDFDocument.create({ updateMetadata: false })

  pdf.registerFontkit(fontkit)

  const fonts: Record<FontKey, PDFFont> = {
    regular: await pdf.embedFont(options.fonts.regular, { subset: true }),
    bold: await pdf.embedFont(options.fonts.bold, { subset: true }),
    italic: await pdf.embedFont(options.fonts.italic, { subset: true }),
  }
  const layout = new Layout(
    pdf,
    fonts,
    PAGE_SIZES[spec.pageSize],
    rgb(...hexToRgb(ACCENT_COLORS[theme.accent])),
    rgb(...hexToRgb(ACCENT_TINTS[theme.accent])),
    images,
  )

  layout.startPage()

  for (const [index, block] of spec.blocks.entries()) {
    await renderBlock(layout, block, spec.blocks[index + 1])
  }

  drawFooters(layout)

  pdf.setTitle(spec.title, { showInWindowTitleBar: true })
  pdf.setProducer('Besidka')
  pdf.setCreator('Besidka')
  pdf.setCreationDate(createdAt)
  pdf.setModificationDate(createdAt)

  if (spec.language) {
    pdf.setLanguage(spec.language)
  }

  const packet = buildPdfXmp({
    ...(options.provenance ?? DEFAULT_PROVENANCE),
    title: spec.title,
    language: spec.language,
  })
  const metadata = pdf.context.stream(packet, {
    Type: 'Metadata',
    Subtype: 'XML',
  })

  pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(metadata))

  const bytes = await pdf.save()
  const pageCount = layout.pages.length

  if (pageCount > VALIDATION_LIMITS.pdfPagesMax) {
    throw new RenderError('page_limit', `Document has ${pageCount} pages`)
  }

  return {
    bytes,
    mediaType: MEDIA_TYPES.pdf,
    extension: 'pdf',
    stats: { pages: pageCount },
    warnings: layout.collectWarnings(),
  }
}
