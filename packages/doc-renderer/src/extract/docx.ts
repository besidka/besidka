import type { XmlEvent } from '../validate/xml.ts'
import {
  ExtractError,
  TextSink,
  addTruncation,
  findEntry,
  renderMarkdownTable,
  scanPart,
} from './common.ts'
import type { ExtractionOutput, OfficePackage } from './common.ts'

interface WordStyle {
  name: string
  numId: string | null
  ilvl: number | null
}

interface NumberingLevel {
  format: string
  start: number
}

interface Numbering {
  abstractByNumber: Map<string, string>
  levels: Map<string, Map<number, NumberingLevel>>
}

interface ParagraphState {
  styleId: string | null
  numId: string | null
  ilvl: number | null
  parts: string[]
}

interface CellState {
  parts: string[]
  span: number
  continuesAbove: boolean
}

interface ListPlacement {
  format: string
  level: number
  start: number
  counterKey: string
}

interface DocumentCounts {
  paragraphs: number
  tables: number
  hasContent: boolean
}

interface WalkContext {
  styles: Map<string, WordStyle>
  numbering: Numbering
  sink: TextSink
  counts: DocumentCounts
}

const MAIN_PART = 'word/document.xml'
const STYLES_PART = 'word/styles.xml'
const NUMBERING_PART = 'word/numbering.xml'
const SKIPPED_ELEMENTS = new Set([
  'drawing',
  'pict',
  'object',
  'Fallback',
  'del',
  'moveFrom',
  'pPrChange',
  'rPrChange',
])
const HEADING_NAME_PATTERN = /^heading(\d)$/
const MAX_HEADING_LEVEL = 6
const LIST_INDENT = '  '

function readStyles(pkg: OfficePackage): Map<string, WordStyle> {
  const styles = new Map<string, WordStyle>()
  const entry = findEntry(pkg, STYLES_PART)

  if (!entry) {
    return styles
  }

  scanPart(pkg, entry, (events) => {
    styles.clear()

    let currentId: string | null = null
    let current: WordStyle | null = null

    for (const event of events) {
      if (event.type === 'start' && event.name === 'style') {
        currentId = event.attributes.styleId ?? ''
        current = { name: '', numId: null, ilvl: null }
      } else if (event.type === 'start' && current) {
        const value = event.attributes.val ?? ''

        if (event.name === 'name') {
          current.name = value.toLowerCase()
        } else if (event.name === 'numId') {
          current.numId = value
        } else if (event.name === 'ilvl') {
          current.ilvl = Number(value)
        }
      } else if (event.type === 'end' && event.name === 'style' && current) {
        styles.set(currentId as string, current)
        current = null
      }
    }

    return false
  })

  return styles
}

function readNumbering(pkg: OfficePackage): Numbering {
  const numbering: Numbering = {
    abstractByNumber: new Map(),
    levels: new Map(),
  }
  const entry = findEntry(pkg, NUMBERING_PART)

  if (!entry) {
    return numbering
  }

  scanPart(pkg, entry, (events) => {
    numbering.abstractByNumber.clear()
    numbering.levels.clear()

    let abstractId: string | null = null
    let numberId: string | null = null
    let levelIndex: number | null = null
    let level: NumberingLevel | null = null

    for (const event of events) {
      if (event.type === 'start') {
        const value = event.attributes.val ?? ''

        if (event.name === 'abstractNum') {
          abstractId = event.attributes.abstractNumId ?? ''
          numbering.levels.set(abstractId, new Map())
        } else if (event.name === 'lvl' && abstractId !== null) {
          levelIndex = Number(event.attributes.ilvl ?? 0)
          level = { format: 'decimal', start: 1 }
        } else if (event.name === 'numFmt' && level) {
          level.format = value
        } else if (event.name === 'start' && level) {
          level.start = Number(value) || 1
        } else if (event.name === 'num') {
          numberId = event.attributes.numId ?? ''
        } else if (event.name === 'abstractNumId' && numberId !== null) {
          numbering.abstractByNumber.set(numberId, value)
        }
      } else if (event.type === 'end') {
        if (event.name === 'lvl' && level && abstractId !== null) {
          numbering.levels.get(abstractId)?.set(levelIndex as number, level)
          level = null
        } else if (event.name === 'abstractNum') {
          abstractId = null
        } else if (event.name === 'num') {
          numberId = null
        }
      }
    }

    return false
  })

  return numbering
}

function headingLevel(
  styleId: string | null,
  styles: Map<string, WordStyle>,
): number | null {
  if (styleId === null) {
    return null
  }

  const name = (styles.get(styleId)?.name || styleId)
    .toLowerCase()
    .replace(/\s+/g, '')

  if (name === 'title') {
    return 1
  }

  const match = HEADING_NAME_PATTERN.exec(name)

  if (!match) {
    return null
  }

  return Math.min(Math.max(Number(match[1]), 1), MAX_HEADING_LEVEL)
}

function resolveList(
  paragraph: ParagraphState,
  context: WalkContext,
): ListPlacement | null {
  const style = paragraph.styleId === null
    ? undefined
    : context.styles.get(paragraph.styleId)
  const numId = paragraph.numId ?? style?.numId ?? null

  if (numId === null || numId === '0') {
    return null
  }

  const level = paragraph.ilvl ?? style?.ilvl ?? 0
  const abstractId = context.numbering.abstractByNumber.get(numId) ?? numId
  const definition = context.numbering.levels.get(abstractId)?.get(level)

  return {
    format: definition?.format ?? 'bullet',
    level,
    start: definition?.start ?? 1,
    counterKey: abstractId,
  }
}

function nextNumber(
  counters: Map<string, number[]>,
  placement: ListPlacement,
): number {
  const counts = counters.get(placement.counterKey) ?? []

  counts.length = Math.min(counts.length, placement.level + 1)

  const previous = counts[placement.level]
  const next = previous === undefined ? placement.start : previous + 1

  counts[placement.level] = next
  counters.set(placement.counterKey, counts)

  return next
}

function walkDocument(
  events: Iterable<XmlEvent>,
  context: WalkContext,
): boolean {
  const { sink, counts } = context
  const paragraphs: ParagraphState[] = []
  const counters = new Map<string, number[]>()
  let tableRows: string[][] = []
  let rowCells: string[] = []
  let cell: CellState | null = null
  let tableDepth = 0
  let skipDepth = 0
  let isReadingText = false

  function finishParagraph(paragraph: ParagraphState): void {
    const text = paragraph.parts.join('').replace(/[ \t]+$/gm, '').trim()

    if (text.length === 0) {
      return
    }

    if (tableDepth > 0) {
      cell?.parts.push(text)

      return
    }

    counts.paragraphs += 1
    counts.hasContent = true

    const level = headingLevel(paragraph.styleId, context.styles)

    if (level !== null) {
      sink.add(`${'#'.repeat(level)} ${text.replace(/\s*\n\s*/g, ' ')}`)

      return
    }

    const placement = resolveList(paragraph, context)

    if (placement === null || placement.format === 'none') {
      sink.add(text)

      return
    }

    const indent = LIST_INDENT.repeat(placement.level)
    const marker = placement.format === 'bullet'
      ? '-'
      : `${nextNumber(counters, placement)}.`
    const body = text.replace(/\n/g, `\n${indent}${LIST_INDENT}`)

    sink.add(`${indent}${marker} ${body}`, 'list')
  }

  function finishTable(): void {
    const hasText = tableRows.some((row) => {
      return row.some(cellText => cellText.length > 0)
    })

    if (hasText) {
      counts.tables += 1
      counts.hasContent = true
      sink.add(renderMarkdownTable(tableRows))
    }

    tableRows = []
  }

  for (const event of events) {
    if (skipDepth > 0) {
      if (event.type === 'start') {
        skipDepth += 1
      } else if (event.type === 'end') {
        skipDepth -= 1
      }

      continue
    }

    if (event.type === 'text') {
      if (isReadingText) {
        paragraphs[paragraphs.length - 1]?.parts.push(event.text)
      }

      continue
    }

    if (event.type === 'start') {
      const current = paragraphs[paragraphs.length - 1]
      const value = event.attributes.val ?? ''

      if (SKIPPED_ELEMENTS.has(event.name)) {
        skipDepth = 1
      } else if (event.name === 'p') {
        paragraphs.push({ styleId: null, numId: null, ilvl: null, parts: [] })
      } else if (event.name === 'pStyle' && current) {
        current.styleId = value
      } else if (event.name === 'numId' && current) {
        current.numId = value
      } else if (event.name === 'ilvl' && current) {
        current.ilvl = Number(value)
      } else if (event.name === 't') {
        isReadingText = current !== undefined
      } else if (event.name === 'tab' && current) {
        current.parts.push(' ')
      } else if (event.name === 'br' && current) {
        const isLineBreak = event.attributes.type === undefined
          || event.attributes.type === 'textWrapping'

        current.parts.push(isLineBreak ? '\n' : ' ')
      } else if (event.name === 'cr' && current) {
        current.parts.push('\n')
      } else if (event.name === 'noBreakHyphen' && current) {
        current.parts.push('-')
      } else if (event.name === 'tbl') {
        tableDepth += 1
      } else if (event.name === 'tr' && tableDepth === 1) {
        rowCells = []
      } else if (event.name === 'tc' && tableDepth === 1) {
        cell = { parts: [], span: 1, continuesAbove: false }
      } else if (event.name === 'gridSpan' && cell && tableDepth === 1) {
        cell.span = Math.max(Number(value) || 1, 1)
      } else if (event.name === 'vMerge' && cell && tableDepth === 1) {
        cell.continuesAbove = value !== 'restart'
      }

      continue
    }

    if (event.name === 't') {
      isReadingText = false
    } else if (event.name === 'p') {
      const finished = paragraphs.pop()

      if (finished) {
        finishParagraph(finished)
      }

      if (sink.isFull) {
        return true
      }
    } else if (event.name === 'tc' && tableDepth === 1 && cell) {
      const text = cell.continuesAbove ? '' : cell.parts.join(' ').trim()

      rowCells.push(text)

      for (let extra = 1; extra < cell.span; extra += 1) {
        rowCells.push('')
      }

      cell = null
    } else if (event.name === 'tr' && tableDepth === 1) {
      if (rowCells.length > 0) {
        tableRows.push(rowCells)
      }

      rowCells = []
    } else if (event.name === 'tbl') {
      tableDepth = Math.max(tableDepth - 1, 0)

      if (tableDepth === 0) {
        finishTable()
      }

      if (sink.isFull) {
        return true
      }
    } else if (event.name === 'body') {
      return true
    }
  }

  return false
}

export function extractDocx(pkg: OfficePackage): ExtractionOutput {
  const entry = findEntry(pkg, MAIN_PART)

  if (!entry) {
    throw new ExtractError(
      'ooxml_main_part_missing',
      'The document has no word/document.xml part',
    )
  }

  const styles = readStyles(pkg)
  const numbering = readNumbering(pkg)
  let sink = new TextSink(pkg.limits.textBytesMax)
  let counts: DocumentCounts = { paragraphs: 0, tables: 0, hasContent: false }

  const outcome = scanPart(pkg, entry, (events) => {
    sink = new TextSink(pkg.limits.textBytesMax)
    counts = { paragraphs: 0, tables: 0, hasContent: false }

    return walkDocument(events, { styles, numbering, sink, counts })
  })

  if (outcome.cut) {
    addTruncation(pkg.stats, 'part_limit')
  }

  if (sink.isFull) {
    addTruncation(pkg.stats, 'text_limit')
  }

  pkg.stats.paragraphs = counts.paragraphs
  pkg.stats.tables = counts.tables

  return { sink, hasContent: counts.hasContent }
}
