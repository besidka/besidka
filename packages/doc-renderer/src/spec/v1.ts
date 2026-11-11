import { z } from 'zod'

export const SPEC_LIMITS = {
  titleMax: 200,
  runTextMax: 4000,
  paragraphRunsMax: 200,
  headingTextMax: 500,
  listItemsMax: 500,
  listDepthMax: 3,
  tableColumnsMax: 20,
  tableRowsMax: 500,
  tableCellRunsMax: 50,
  imageAltMax: 300,
  fileIdMax: 128,
  codeTextMax: 20000,
  codeLanguageMax: 40,
  blocksMax: 5000,
  slidesMax: 60,
  slideBulletsMax: 12,
  slideColumnBlocksMax: 50,
  slideNotesMax: 4000,
  sheetsMax: 20,
  sheetNameMax: 31,
  sheetColumnsMax: 200,
  sheetRowsMax: 20000,
  columnHeaderMax: 255,
  columnWidthMin: 4,
  columnWidthMax: 80,
  cellStringMax: 32767,
  formulaMax: 2000,
  totalCellsMax: 100000,
  estimatedPagesMax: 200,
  imagesMax: 20,
  serializedMax: 200000,
  serializedMaxWorkbook: 2000000,
} as const

export const HYPERLINK_PROTOCOLS = ['https:', 'mailto:'] as const

const FORBIDDEN_SHEET_NAME_CHARACTERS = /[[\]:*?/\\]/
const BCP47_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,4}$/
const ISO_8601_PATTERN
  = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number
    if (codePoint < 0x20 || codePoint === 0x7F) {
      return true
    }
  }

  return false
}

export function isAllowedHyperlink(href: string): boolean {
  if (href.length > 2048 || hasControlCharacter(href)) {
    return false
  }

  let parsed: URL

  try {
    parsed = new URL(href)
  } catch {
    return false
  }

  const protocol = parsed.protocol as (typeof HYPERLINK_PROTOCOLS)[number]

  if (!HYPERLINK_PROTOCOLS.includes(protocol)) {
    return false
  }

  return href.toLowerCase().startsWith(protocol)
}

function isRealIsoDate(value: string): boolean {
  if (!ISO_8601_PATTERN.test(value)) {
    return false
  }

  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const parsed = new Date(Date.UTC(year as number, (month as number) - 1, day))

  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === (month as number) - 1
    && parsed.getUTCDate() === day
}

const text = (max: number) => z.string().min(1).max(max)

const linkSchema = z.strictObject({
  href: z.string().min(1).max(2048).refine(isAllowedHyperlink, {
    message: 'Only https: and mailto: links are allowed',
  }),
})

export const runSchema = z.strictObject({
  text: text(SPEC_LIMITS.runTextMax),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  code: z.boolean().optional(),
  link: linkSchema.optional(),
})

const runsSchema = z.array(runSchema).min(1).max(SPEC_LIMITS.paragraphRunsMax)

const alignSchema = z.enum(['left', 'center', 'right', 'justify'])

const leafListItemSchema = z.strictObject({ runs: runsSchema })

const middleListItemSchema = z.strictObject({
  runs: runsSchema,
  children: z.array(leafListItemSchema).min(1).max(SPEC_LIMITS.listItemsMax)
    .optional(),
})

const listItemSchema = z.strictObject({
  runs: runsSchema,
  children: z.array(middleListItemSchema).min(1).max(SPEC_LIMITS.listItemsMax)
    .optional(),
})

const headingBlockSchema = z.strictObject({
  type: z.literal('heading'),
  level: z.number().int().min(1).max(4),
  text: text(SPEC_LIMITS.headingTextMax),
})

const paragraphBlockSchema = z.strictObject({
  type: z.literal('paragraph'),
  runs: runsSchema,
  align: alignSchema.optional(),
})

const listBlockSchema = z.strictObject({
  type: z.literal('list'),
  ordered: z.boolean(),
  items: z.array(listItemSchema).min(1).max(SPEC_LIMITS.listItemsMax),
})

const tableColumnSchema = z.strictObject({
  text: text(SPEC_LIMITS.runTextMax),
  align: alignSchema.optional(),
})

const tableBlockSchema = z.strictObject({
  type: z.literal('table'),
  header: z.boolean(),
  columns: z.array(tableColumnSchema).min(1).max(SPEC_LIMITS.tableColumnsMax),
  rows: z.array(
    z.array(z.array(runSchema).max(SPEC_LIMITS.tableCellRunsMax)),
  ).min(1).max(SPEC_LIMITS.tableRowsMax),
}).superRefine((table, context) => {
  table.rows.forEach((row, rowIndex) => {
    if (row.length !== table.columns.length) {
      context.addIssue({
        code: 'custom',
        path: ['rows', rowIndex],
        message: `Row has ${row.length} cells, expected ${table.columns.length}`,
      })
    }
  })
})

const imageBlockSchema = z.strictObject({
  type: z.literal('image'),
  fileId: text(SPEC_LIMITS.fileIdMax),
  alt: text(SPEC_LIMITS.imageAltMax),
  widthPercent: z.number().int().min(10).max(100),
})

const quoteBlockSchema = z.strictObject({
  type: z.literal('quote'),
  runs: runsSchema,
})

const codeBlockSchema = z.strictObject({
  type: z.literal('code'),
  text: text(SPEC_LIMITS.codeTextMax),
  language: z.string().regex(/^[A-Za-z0-9+#._-]+$/)
    .max(SPEC_LIMITS.codeLanguageMax).optional(),
})

const pageBreakBlockSchema = z.strictObject({
  type: z.literal('pageBreak'),
})

export const blockSchema = z.discriminatedUnion('type', [
  headingBlockSchema,
  paragraphBlockSchema,
  listBlockSchema,
  tableBlockSchema,
  imageBlockSchema,
  quoteBlockSchema,
  codeBlockSchema,
  pageBreakBlockSchema,
])

export const themeSchema = z.strictObject({
  font: z.enum(['sans', 'serif']),
  accent: z.enum(['neutral', 'blue', 'green', 'orange', 'violet']),
})

const commonShape = {
  specVersion: z.literal(1),
  title: text(SPEC_LIMITS.titleMax),
  language: z.string().regex(BCP47_PATTERN).optional(),
  theme: themeSchema.optional(),
}

const blocksSchema = z.array(blockSchema).min(1).max(SPEC_LIMITS.blocksMax)

export const docxSpecSchema = z.strictObject({
  ...commonShape,
  format: z.literal('docx'),
  blocks: blocksSchema,
})

export const pdfSpecSchema = z.strictObject({
  ...commonShape,
  format: z.literal('pdf'),
  pageSize: z.enum(['A4', 'Letter']),
  blocks: blocksSchema,
})

const imageRefSchema = z.strictObject({
  fileId: text(SPEC_LIMITS.fileIdMax),
  alt: text(SPEC_LIMITS.imageAltMax),
})

const slideSchema = z.strictObject({
  layout: z.enum(['title', 'title-content', 'two-column', 'section', 'image']),
  title: text(SPEC_LIMITS.titleMax),
  subtitle: text(SPEC_LIMITS.titleMax).optional(),
  bullets: z.array(z.array(runSchema).min(1).max(SPEC_LIMITS.paragraphRunsMax))
    .max(SPEC_LIMITS.slideBulletsMax).optional(),
  columns: z.tuple([
    z.array(blockSchema).max(SPEC_LIMITS.slideColumnBlocksMax),
    z.array(blockSchema).max(SPEC_LIMITS.slideColumnBlocksMax),
  ]).optional(),
  image: imageRefSchema.optional(),
  notes: z.string().max(SPEC_LIMITS.slideNotesMax).optional(),
}).superRefine((slide, context) => {
  if (slide.layout === 'two-column' && !slide.columns) {
    context.addIssue({
      code: 'custom',
      path: ['columns'],
      message: 'The two-column layout requires columns',
    })
  }

  if (slide.layout === 'image' && !slide.image) {
    context.addIssue({
      code: 'custom',
      path: ['image'],
      message: 'The image layout requires an image',
    })
  }
})

export const pptxSpecSchema = z.strictObject({
  ...commonShape,
  format: z.literal('pptx'),
  aspect: z.enum(['16:9', '4:3']),
  slides: z.array(slideSchema).min(1).max(SPEC_LIMITS.slidesMax),
})

export const COLUMN_TYPES = [
  'string',
  'number',
  'integer',
  'currency',
  'percent',
  'date',
  'boolean',
] as const

const cellSchema = z.union([
  z.string().max(SPEC_LIMITS.cellStringMax),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.strictObject({
    date: z.string().refine(isRealIsoDate, {
      message: 'Expected an ISO-8601 date such as 2026-11-08',
    }),
  }),
  z.strictObject({
    formula: z.string().min(1).max(SPEC_LIMITS.formulaMax),
    cached: z.union([
      z.number().finite(),
      z.string().max(SPEC_LIMITS.cellStringMax),
    ]).optional(),
  }),
])

const sheetNameSchema = z.string()
  .min(1)
  .max(SPEC_LIMITS.sheetNameMax)
  .refine(name => !FORBIDDEN_SHEET_NAME_CHARACTERS.test(name), {
    message: 'Sheet names cannot contain [ ] : * ? / \\',
  })
  .refine(name => name.toLowerCase() !== 'history', {
    message: 'Sheet name "History" is reserved by Excel',
  })
  .refine(name => !name.startsWith('\'') && !name.endsWith('\''), {
    message: 'Sheet names cannot start or end with an apostrophe',
  })
  .refine(name => name.trim().length > 0, {
    message: 'Sheet names cannot be blank',
  })

const sheetColumnSchema = z.strictObject({
  header: z.string().min(1).max(SPEC_LIMITS.columnHeaderMax),
  type: z.enum(COLUMN_TYPES),
  width: z.number().min(SPEC_LIMITS.columnWidthMin)
    .max(SPEC_LIMITS.columnWidthMax).optional(),
})

const sheetSchema = z.strictObject({
  name: sheetNameSchema,
  columns: z.array(sheetColumnSchema).min(1).max(SPEC_LIMITS.sheetColumnsMax),
  rows: z.array(z.array(cellSchema)).max(SPEC_LIMITS.sheetRowsMax),
  freezeHeader: z.boolean().optional(),
}).superRefine((sheet, context) => {
  sheet.rows.forEach((row, rowIndex) => {
    if (row.length > sheet.columns.length) {
      context.addIssue({
        code: 'custom',
        path: ['rows', rowIndex],
        message: `Row has ${row.length} cells, expected at most ${sheet.columns.length}`,
      })
    }
  })
})

export const xlsxSpecSchema = z.strictObject({
  ...commonShape,
  format: z.literal('xlsx'),
  sheets: z.array(sheetSchema).min(1).max(SPEC_LIMITS.sheetsMax),
}).superRefine((workbook, context) => {
  const seen = new Set<string>()

  workbook.sheets.forEach((sheet, sheetIndex) => {
    const key = sheet.name.toLowerCase()

    if (seen.has(key)) {
      context.addIssue({
        code: 'custom',
        path: ['sheets', sheetIndex, 'name'],
        message: 'Sheet names must be unique, ignoring case',
      })
    }

    seen.add(key)
  })
})

export const documentSpecSchema = z.discriminatedUnion('format', [
  docxSpecSchema,
  pdfSpecSchema,
  pptxSpecSchema,
  xlsxSpecSchema,
])

export type Run = z.infer<typeof runSchema>
export type ListItem = z.infer<typeof listItemSchema>
export type Block = z.infer<typeof blockSchema>
export type HeadingBlock = z.infer<typeof headingBlockSchema>
export type ParagraphBlock = z.infer<typeof paragraphBlockSchema>
export type ListBlock = z.infer<typeof listBlockSchema>
export type TableBlock = z.infer<typeof tableBlockSchema>
export type ImageBlock = z.infer<typeof imageBlockSchema>
export type QuoteBlock = z.infer<typeof quoteBlockSchema>
export type CodeBlock = z.infer<typeof codeBlockSchema>
export type Slide = z.infer<typeof slideSchema>
export type Cell = z.infer<typeof cellSchema>
export type Sheet = z.infer<typeof sheetSchema>
export type Theme = z.infer<typeof themeSchema>
export type DocxSpec = z.infer<typeof docxSpecSchema>
export type PdfSpec = z.infer<typeof pdfSpecSchema>
export type PptxSpec = z.infer<typeof pptxSpecSchema>
export type XlsxSpec = z.infer<typeof xlsxSpecSchema>
export type DocumentSpec = z.infer<typeof documentSpecSchema>
export type DocumentFormat = DocumentSpec['format']
