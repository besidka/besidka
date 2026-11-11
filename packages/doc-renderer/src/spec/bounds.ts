import { SPEC_LIMITS } from './v1.ts'
import type {
  Block,
  DocumentSpec,
  ListItem,
  Run,
} from './v1.ts'

export interface SpecIssue {
  path: string
  message: string
}

const CHARACTERS_PER_LINE = 90
const LINES_PER_PAGE = 45
const IMAGE_LINES_AT_FULL_WIDTH = 24
const HEADING_LINES = [0, 3, 2.5, 2, 2]
const BLOCK_GAP_LINES = 0.5

function pathToString(path: readonly (string | number)[]): string {
  let result = '$'

  for (const segment of path) {
    result += typeof segment === 'number' ? `[${segment}]` : `.${segment}`
  }

  return result
}

export function formatIssuePath(path: readonly PropertyKey[]): string {
  return pathToString(path.map((segment) => {
    return typeof segment === 'symbol' ? String(segment) : segment
  }))
}

function runsLength(runs: readonly Run[]): number {
  return runs.reduce((total, run) => total + run.text.length, 0)
}

function wrappedLines(characters: number, charactersPerLine: number): number {
  return Math.max(1, Math.ceil(characters / charactersPerLine))
}

function listItemLines(items: readonly ListItem[], depth: number): number {
  let lines = 0
  const charactersPerLine = Math.max(30, CHARACTERS_PER_LINE - depth * 8)

  for (const item of items) {
    lines += wrappedLines(runsLength(item.runs), charactersPerLine)

    if (item.children) {
      lines += listItemLines(item.children as ListItem[], depth + 1)
    }
  }

  return lines
}

function blockLines(block: Block): number {
  switch (block.type) {
    case 'heading':
      return (HEADING_LINES[block.level] || 2)
        + wrappedLines(block.text.length, CHARACTERS_PER_LINE - 30) - 1
    case 'paragraph':
      return wrappedLines(runsLength(block.runs), CHARACTERS_PER_LINE)
    case 'quote':
      return wrappedLines(runsLength(block.runs), CHARACTERS_PER_LINE - 10)
    case 'list':
      return listItemLines(block.items, 0)
    case 'code':
      return block.text
        .split('\n')
        .reduce((total, line) => {
          return total + wrappedLines(line.length, CHARACTERS_PER_LINE)
        }, 0)
    case 'table': {
      const headerLines = block.header ? 1.5 : 0
      const columnCharacters = Math.max(
        10,
        Math.floor(CHARACTERS_PER_LINE / block.columns.length),
      )
      const rowLines = block.rows.reduce((total, row) => {
        const tallestCell = row.reduce((tallest, cell) => {
          return Math.max(
            tallest,
            wrappedLines(runsLength(cell), columnCharacters),
          )
        }, 1)

        return total + tallestCell + 0.4
      }, 0)

      return headerLines + rowLines
    }
    case 'image':
      return IMAGE_LINES_AT_FULL_WIDTH * (block.widthPercent / 100)
    case 'pageBreak':
      return 0
  }
}

export function estimatePages(blocks: readonly Block[]): number {
  let pages = 1
  let used = 0

  for (const block of blocks) {
    if (block.type === 'pageBreak') {
      pages += 1
      used = 0
      continue
    }

    const lines = blockLines(block) + BLOCK_GAP_LINES

    if (block.type === 'image' && used > 0 && used + lines > LINES_PER_PAGE) {
      pages += 1
      used = 0
    }

    used += lines

    while (used > LINES_PER_PAGE) {
      pages += 1
      used -= LINES_PER_PAGE
    }
  }

  return pages
}

interface Counters {
  cells: number
  images: number
}

function countBlockImages(blocks: readonly Block[]): number {
  return blocks.filter(block => block.type === 'image').length
}

function countSpec(spec: DocumentSpec): Counters {
  const counters: Counters = { cells: 0, images: 0 }

  if (spec.format === 'xlsx') {
    for (const sheet of spec.sheets) {
      counters.cells += sheet.columns.length
      counters.cells += sheet.rows.reduce((total, row) => {
        return total + row.length
      }, 0)
    }
  } else if (spec.format === 'pptx') {
    for (const slide of spec.slides) {
      counters.images += slide.image ? 1 : 0

      for (const column of slide.columns || []) {
        counters.images += countBlockImages(column)
      }
    }
  } else {
    counters.images += countBlockImages(spec.blocks)
  }

  return counters
}

export function countCells(spec: DocumentSpec): number {
  return countSpec(spec).cells
}

export function countImages(spec: DocumentSpec): number {
  return countSpec(spec).images
}

export function collectImageIds(spec: DocumentSpec): string[] {
  const ids: string[] = []

  if (spec.format === 'pptx') {
    for (const slide of spec.slides) {
      if (slide.image) {
        ids.push(slide.image.fileId)
      }

      for (const column of slide.columns || []) {
        for (const block of column) {
          if (block.type === 'image') {
            ids.push(block.fileId)
          }
        }
      }
    }
  } else if (spec.format !== 'xlsx') {
    for (const block of spec.blocks) {
      if (block.type === 'image') {
        ids.push(block.fileId)
      }
    }
  }

  return ids
}

/**
 * Global limits that Zod cannot express per field. The page estimate is a
 * heuristic (Word paginates on its own); the PDF page count is re-checked on
 * the produced bytes.
 */
export function checkSpecBounds(spec: DocumentSpec): SpecIssue[] {
  const issues: SpecIssue[] = []
  const counters = countSpec(spec)

  if (counters.cells > SPEC_LIMITS.totalCellsMax) {
    issues.push({
      path: '$.sheets',
      message: `Too many cells: ${counters.cells}, limit ${SPEC_LIMITS.totalCellsMax}`,
    })
  }

  if (counters.images > SPEC_LIMITS.imagesMax) {
    issues.push({
      path: '$',
      message: `Too many images: ${counters.images}, limit ${SPEC_LIMITS.imagesMax}`,
    })
  }

  if (spec.format === 'docx' || spec.format === 'pdf') {
    const pages = estimatePages(spec.blocks)

    if (pages > SPEC_LIMITS.estimatedPagesMax) {
      issues.push({
        path: '$.blocks',
        message: `Estimated ${pages} pages, limit ${SPEC_LIMITS.estimatedPagesMax}`,
      })
    }
  }

  return issues
}

export function measureSerializedLength(input: unknown): number | null {
  try {
    const serialized = JSON.stringify(input)

    return serialized === undefined ? null : serialized.length
  } catch {
    return null
  }
}
