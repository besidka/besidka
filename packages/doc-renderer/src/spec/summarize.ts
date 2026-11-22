import { countCells, countImages, estimatePages } from './bounds.ts'
import type { DocumentFormat, DocumentSpec } from './v1.ts'

export interface SpecSummary {
  format: DocumentFormat
  title: string
  language: string | null
  pages: number | null
  slides: number | null
  sheets: number | null
  cells: number | null
  images: number
  outline: string[]
}

const OUTLINE_LIMIT = 20

/**
 * Cheap, render-free description of a spec for previews and cards.
 */
export function summarizeSpec(spec: DocumentSpec): SpecSummary {
  const summary: SpecSummary = {
    format: spec.format,
    title: spec.title,
    language: spec.language ?? null,
    pages: null,
    slides: null,
    sheets: null,
    cells: null,
    images: countImages(spec),
    outline: [],
  }

  if (spec.format === 'xlsx') {
    summary.sheets = spec.sheets.length
    summary.cells = countCells(spec)
    summary.outline = spec.sheets.map(sheet => sheet.name)
      .slice(0, OUTLINE_LIMIT)

    return summary
  }

  if (spec.format === 'pptx') {
    summary.slides = spec.slides.length
    summary.outline = spec.slides.map(slide => slide.title)
      .slice(0, OUTLINE_LIMIT)

    return summary
  }

  summary.pages = estimatePages(spec.blocks)
  summary.outline = spec.blocks
    .flatMap((block) => {
      return block.type === 'heading' ? [block.text] : []
    })
    .slice(0, OUTLINE_LIMIT)

  return summary
}
