import type { XmlEvent } from '../validate/xml.ts'
import {
  ExtractError,
  TextSink,
  addTruncation,
  appendSpannedCell,
  appendText,
  collapseLineBreaks,
  findEntry,
  readRelationships,
  renderMarkdownTable,
  scanPart,
  trimLineEnds,
} from './common.ts'
import type { ExtractionOutput, OfficePackage } from './common.ts'

interface WordStyle {
  name: string
  numId: string | null
  ilvl: number | null
  basedOn: string | null
  outlineLevel: number | null
}

interface NumberingLevel {
  format: string
  start: number
}

interface Numbering {
  abstractByNumber: Map<string, string>
  levels: Map<string, Map<number, NumberingLevel>>
  startOverrides: Map<string, Map<number, number>>
}

interface ParagraphState {
  styleId: string | null
  numId: string | null
  ilvl: number | null
  outlineLevel: number | null
  parts: string[]
  length: number
}

interface CellState {
  parts: string[]
  length: number
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
  officePackage: OfficePackage
  styles: Map<string, WordStyle>
  numbering: Numbering
  sink: TextSink
  counts: DocumentCounts
}

const STYLES_PART = 'word/styles.xml'
const NUMBERING_PART = 'word/numbering.xml'
const STYLES_TYPE_SUFFIX = '/styles'
const NUMBERING_TYPE_SUFFIX = '/numbering'
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
const BODY_TEXT_OUTLINE_LEVEL = 9
const MAX_LIST_LEVEL = 8
const MAX_STYLE_CHAIN = 8
const MAX_PARAGRAPH_DEPTH = 64
const MAX_DEFINITIONS = 10_000
const LIST_INDENT = '  '

function relatedPart(
  officePackage: OfficePackage,
  typeSuffix: string,
  fallbackPart: string,
): string {
  const related = readRelationships(officePackage, officePackage.mainPart)
    .find((relationship) => {
      return !relationship.isExternal
        && relationship.type.endsWith(typeSuffix)
    })

  return related?.target ?? fallbackPart
}

function clampLevel(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0
  }

  return Math.min(Math.max(Math.trunc(value), 0), MAX_LIST_LEVEL)
}

function readStyles(officePackage: OfficePackage): Map<string, WordStyle> {
  const styles = new Map<string, WordStyle>()
  const entry = findEntry(
    officePackage,
    relatedPart(officePackage, STYLES_TYPE_SUFFIX, STYLES_PART),
  )

  if (!entry) {
    return styles
  }

  scanPart(officePackage, entry, (events) => {
    styles.clear()

    let currentId: string | null = null
    let current: WordStyle | null = null

    for (const event of events) {
      if (event.type === 'start' && event.name === 'style') {
        currentId = event.attributes.styleId ?? ''
        current = {
          name: '',
          numId: null,
          ilvl: null,
          basedOn: null,
          outlineLevel: null,
        }
      } else if (event.type === 'start' && current) {
        const value = event.attributes.val ?? ''

        if (event.name === 'name') {
          current.name = value.toLowerCase()
        } else if (event.name === 'numId') {
          current.numId = value
        } else if (event.name === 'ilvl') {
          current.ilvl = Number(value)
        } else if (event.name === 'basedOn') {
          current.basedOn = value
        } else if (event.name === 'outlineLvl') {
          current.outlineLevel = Number(value)
        }
      } else if (event.type === 'end' && event.name === 'style' && current) {
        if (styles.size < MAX_DEFINITIONS) {
          styles.set(currentId as string, current)
        }

        current = null
      }
    }

    return false
  })

  return styles
}

function readNumbering(officePackage: OfficePackage): Numbering {
  const numbering: Numbering = {
    abstractByNumber: new Map(),
    levels: new Map(),
    startOverrides: new Map(),
  }
  const entry = findEntry(
    officePackage,
    relatedPart(officePackage, NUMBERING_TYPE_SUFFIX, NUMBERING_PART),
  )

  if (!entry) {
    return numbering
  }

  scanPart(officePackage, entry, (events) => {
    numbering.abstractByNumber.clear()
    numbering.levels.clear()
    numbering.startOverrides.clear()

    let abstractId: string | null = null
    let numberId: string | null = null
    let levelIndex: number | null = null
    let level: NumberingLevel | null = null
    let overrideLevel: number | null = null

    for (const event of events) {
      if (event.type === 'start') {
        const value = event.attributes.val ?? ''

        if (event.name === 'abstractNum') {
          abstractId = event.attributes.abstractNumId ?? ''

          if (numbering.levels.size < MAX_DEFINITIONS) {
            numbering.levels.set(abstractId, new Map())
          }
        } else if (event.name === 'lvl' && abstractId !== null) {
          levelIndex = clampLevel(Number(event.attributes.ilvl ?? 0))
          level = { format: 'decimal', start: 1 }
        } else if (event.name === 'numFmt' && level) {
          level.format = value
        } else if (event.name === 'start' && level) {
          level.start = Number(value) || 1
        } else if (event.name === 'num') {
          numberId = event.attributes.numId ?? ''
        } else if (
          event.name === 'abstractNumId'
          && numberId !== null
          && numbering.abstractByNumber.size < MAX_DEFINITIONS
        ) {
          numbering.abstractByNumber.set(numberId, value)
        } else if (event.name === 'lvlOverride' && numberId !== null) {
          overrideLevel = clampLevel(Number(event.attributes.ilvl ?? 0))
        } else if (
          event.name === 'startOverride'
          && numberId !== null
          && overrideLevel !== null
          && numbering.startOverrides.size < MAX_DEFINITIONS
        ) {
          const overrides = numbering.startOverrides.get(numberId) ?? new Map()

          overrides.set(overrideLevel, Number(value) || 0)
          numbering.startOverrides.set(numberId, overrides)
        }
      } else if (event.type === 'end') {
        if (event.name === 'lvl' && level && abstractId !== null) {
          numbering.levels.get(abstractId)?.set(levelIndex as number, level)
          level = null
        } else if (event.name === 'abstractNum') {
          abstractId = null
        } else if (event.name === 'num') {
          numberId = null
        } else if (event.name === 'lvlOverride') {
          overrideLevel = null
        }
      }
    }

    return false
  })

  return numbering
}

function levelFromStyleName(name: string): number | null {
  const compact = name.toLowerCase().replace(/\s+/g, '')

  if (compact === 'title') {
    return 1
  }

  const match = HEADING_NAME_PATTERN.exec(compact)

  if (!match) {
    return null
  }

  return Math.min(Math.max(Number(match[1]), 1), MAX_HEADING_LEVEL)
}

function levelFromOutline(outlineLevel: number): number | null {
  if (!Number.isInteger(outlineLevel) || outlineLevel < 0) {
    return null
  }

  if (outlineLevel >= BODY_TEXT_OUTLINE_LEVEL) {
    return null
  }

  return Math.min(outlineLevel + 1, MAX_HEADING_LEVEL)
}

function headingLevel(
  paragraph: ParagraphState,
  styles: Map<string, WordStyle>,
): number | null {
  if (paragraph.outlineLevel !== null) {
    return levelFromOutline(paragraph.outlineLevel)
  }

  let styleId = paragraph.styleId

  for (let depth = 0; styleId !== null && depth < MAX_STYLE_CHAIN; depth += 1) {
    const style = styles.get(styleId)
    const nameLevel = levelFromStyleName(style?.name || styleId)

    if (nameLevel !== null) {
      return nameLevel
    }

    if (style?.outlineLevel !== null && style?.outlineLevel !== undefined) {
      return levelFromOutline(style.outlineLevel)
    }

    styleId = style?.basedOn ?? null
  }

  return null
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

  const level = clampLevel(paragraph.ilvl ?? style?.ilvl)
  const abstractId = context.numbering.abstractByNumber.get(numId) ?? numId
  const definition = context.numbering.levels.get(abstractId)?.get(level)
  const overrides = context.numbering.startOverrides.get(numId)

  return {
    format: definition?.format ?? 'bullet',
    level,
    start: overrides?.get(level) ?? definition?.start ?? 1,
    counterKey: overrides === undefined ? abstractId : `num:${numId}`,
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
  const { officePackage, sink, counts } = context
  const { rowsMax, columnsMax, cellCharsMax, textBytesMax }
    = officePackage.limits
  const paragraphs: ParagraphState[] = []
  const counters = new Map<string, number[]>()
  let tableRows: string[][] = []
  let rowCells: string[] = []
  let hasDroppedRows = false
  let cell: CellState | null = null
  let tableDepth = 0
  let skipDepth = 0
  let isReadingText = false

  function finishParagraph(paragraph: ParagraphState): void {
    const text = trimLineEnds(paragraph.parts.join('')).trim()

    if (text.length === 0) {
      return
    }

    if (tableDepth > 0) {
      if (cell && cell.length < cellCharsMax) {
        cell.parts.push(text)
        cell.length += text.length
      }

      return
    }

    counts.paragraphs += 1
    counts.hasContent = true

    const level = headingLevel(paragraph, context.styles)

    if (level !== null) {
      sink.add(`${'#'.repeat(level)} ${collapseLineBreaks(text)}`)

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
      const table = renderMarkdownTable(tableRows, {
        rowsMax,
        columnsMax,
        cellCharsMax,
        maxBytes: sink.remainingBytes,
      })

      counts.tables += 1
      counts.hasContent = true
      sink.add(table.text)

      for (const reason of table.reasons) {
        addTruncation(officePackage.stats, reason)
      }
    }

    if (hasDroppedRows) {
      addTruncation(officePackage.stats, 'rows_limit')
    }

    hasDroppedRows = false
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
        const target = paragraphs[paragraphs.length - 1]

        if (target) {
          appendText(target, event.text, textBytesMax)
        }
      }

      continue
    }

    if (event.type === 'start') {
      const current = paragraphs[paragraphs.length - 1]
      const value = event.attributes.val ?? ''

      if (SKIPPED_ELEMENTS.has(event.name)) {
        skipDepth = 1
      } else if (event.name === 'p') {
        if (paragraphs.length >= MAX_PARAGRAPH_DEPTH) {
          throw new ExtractError(
            'ooxml_malformed',
            'Paragraphs are nested deeper than any real document',
          )
        }

        paragraphs.push({
          styleId: null,
          numId: null,
          ilvl: null,
          outlineLevel: null,
          parts: [],
          length: 0,
        })
      } else if (event.name === 'pStyle' && current) {
        current.styleId = value
      } else if (event.name === 'numId' && current) {
        current.numId = value
      } else if (event.name === 'ilvl' && current) {
        current.ilvl = Number(value)
      } else if (event.name === 'outlineLvl' && current) {
        current.outlineLevel = Number(value)
      } else if (event.name === 't') {
        isReadingText = current !== undefined
      } else if (event.name === 'tab' && current) {
        appendText(current, ' ', textBytesMax)
      } else if (event.name === 'br' && current) {
        const isLineBreak = event.attributes.type === undefined
          || event.attributes.type === 'textWrapping'

        appendText(current, isLineBreak ? '\n' : ' ', textBytesMax)
      } else if (event.name === 'cr' && current) {
        appendText(current, '\n', textBytesMax)
      } else if (event.name === 'noBreakHyphen' && current) {
        appendText(current, '-', textBytesMax)
      } else if (event.name === 'tbl') {
        tableDepth += 1
      } else if (event.name === 'tr' && tableDepth === 1) {
        rowCells = []
      } else if (event.name === 'tc' && tableDepth === 1) {
        cell = { parts: [], length: 0, span: 1, continuesAbove: false }
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

      const isClamped = appendSpannedCell(
        rowCells,
        text,
        cell.span,
        columnsMax,
      )

      if (isClamped) {
        addTruncation(officePackage.stats, 'columns_limit')
      }

      cell = null
    } else if (event.name === 'tr' && tableDepth === 1) {
      if (rowCells.length > 0 && tableRows.length < rowsMax) {
        tableRows.push(rowCells)
      } else if (rowCells.length > 0) {
        hasDroppedRows = true
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

export function extractDocx(officePackage: OfficePackage): ExtractionOutput {
  const entry = findEntry(officePackage, officePackage.mainPart)

  if (!entry) {
    throw new ExtractError(
      'ooxml_main_part_missing',
      'The document has no word/document.xml part',
    )
  }

  const styles = readStyles(officePackage)
  const numbering = readNumbering(officePackage)
  let sink = new TextSink(officePackage.limits.textBytesMax)
  let counts: DocumentCounts = { paragraphs: 0, tables: 0, hasContent: false }

  const outcome = scanPart(officePackage, entry, (events) => {
    sink = new TextSink(officePackage.limits.textBytesMax)
    counts = { paragraphs: 0, tables: 0, hasContent: false }

    return walkDocument(events, {
      officePackage,
      styles,
      numbering,
      sink,
      counts,
    })
  })

  if (outcome.cut) {
    addTruncation(officePackage.stats, 'part_limit')
  }

  if (sink.isFull) {
    addTruncation(officePackage.stats, 'text_limit')
  }

  officePackage.stats.paragraphs = counts.paragraphs
  officePackage.stats.tables = counts.tables

  return { sink, hasContent: counts.hasContent }
}
