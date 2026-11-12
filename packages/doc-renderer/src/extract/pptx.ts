import type { XmlEvent } from '../validate/xml.ts'
import {
  ExtractError,
  TextSink,
  addTruncation,
  findEntry,
  readRelationships,
  relationshipIdOf,
  renderMarkdownTable,
  scanPart,
} from './common.ts'
import type {
  BlockKind,
  ExtractionOutput,
  OfficePackage,
} from './common.ts'

interface SlideBlock {
  text: string
  kind: BlockKind
}

interface SlideContent {
  title: string
  blocks: SlideBlock[]
}

interface ParagraphState {
  level: number
  hasBullet: boolean | undefined
  parts: string[]
}

interface CellState {
  parts: string[]
  span: number
  isMerged: boolean
}

type ShapeFilter = (placeholderType: string | null) => boolean

const PRESENTATION_PART = 'ppt/presentation.xml'
const SLIDE_TYPE_SUFFIX = '/slide'
const NOTES_TYPE_SUFFIX = '/notesSlide'
const TITLE_TYPES: ReadonlySet<string> = new Set(['title', 'ctrTitle'])
const BODY_TYPES: ReadonlySet<string> = new Set(['body', 'obj'])
const FURNITURE_TYPES: ReadonlySet<string> = new Set([
  'sldNum',
  'ftr',
  'dt',
  'hdr',
  'sldImg',
])
const BULLET_ELEMENTS: ReadonlySet<string> = new Set([
  'buChar',
  'buAutoNum',
  'buBlip',
])
const LIST_INDENT = '  '

function slideShapeFilter(placeholderType: string | null): boolean {
  return placeholderType === null || !FURNITURE_TYPES.has(placeholderType)
}

function notesShapeFilter(placeholderType: string | null): boolean {
  return placeholderType === 'body'
}

function emptyContent(): SlideContent {
  return { title: '', blocks: [] }
}

function readSlideContent(
  pkg: OfficePackage,
  partName: string,
  isCaptured: ShapeFilter,
): SlideContent {
  const entry = findEntry(pkg, partName)
  let content = emptyContent()

  if (!entry) {
    return content
  }

  scanPart(pkg, entry, (events) => {
    content = walkShapes(events, isCaptured)

    return false
  })

  return content
}

function walkShapes(
  events: Iterable<XmlEvent>,
  isCaptured: ShapeFilter,
): SlideContent {
  const content = emptyContent()
  const titleParts: string[] = []
  let paragraph: ParagraphState | null = null
  let tableRows: string[][] = []
  let rowCells: string[] = []
  let cell: CellState | null = null
  let isInTable = false
  let placeholderType: string | null = null
  let skipDepth = 0
  let isInText = false

  function finishParagraph(finished: ParagraphState): void {
    const text = finished.parts.join('').replace(/[ \t]+$/gm, '').trim()

    if (text.length === 0) {
      return
    }

    if (cell) {
      cell.parts.push(text)

      return
    }

    if (!isCaptured(placeholderType)) {
      return
    }

    if (placeholderType !== null && TITLE_TYPES.has(placeholderType)) {
      titleParts.push(text.replace(/\s*\n\s*/g, ' '))

      return
    }

    const isBulleted = finished.hasBullet
      ?? (placeholderType !== null && BODY_TYPES.has(placeholderType))

    if (isBulleted) {
      const indent = LIST_INDENT.repeat(finished.level)
      const body = text.replace(/\n/g, `\n${indent}${LIST_INDENT}`)

      content.blocks.push({ text: `${indent}- ${body}`, kind: 'list' })

      return
    }

    content.blocks.push({ text, kind: 'block' })
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
      if (isInText) {
        paragraph?.parts.push(event.text)
      }

      continue
    }

    if (event.type === 'start') {
      if (event.name === 'Fallback') {
        skipDepth = 1
      } else if (event.name === 'sp' || event.name === 'graphicFrame') {
        placeholderType = null
      } else if (event.name === 'ph') {
        placeholderType = event.attributes.type ?? 'body'
      } else if (event.name === 'p') {
        paragraph = { level: 0, hasBullet: undefined, parts: [] }
      } else if (event.name === 'pPr' && paragraph) {
        paragraph.level = Math.min(Number(event.attributes.lvl ?? 0) || 0, 8)
      } else if (event.name === 'buNone' && paragraph) {
        paragraph.hasBullet = false
      } else if (BULLET_ELEMENTS.has(event.name) && paragraph) {
        paragraph.hasBullet = true
      } else if (event.name === 't') {
        isInText = paragraph !== null
      } else if (event.name === 'br' && paragraph) {
        paragraph.parts.push('\n')
      } else if (event.name === 'tbl') {
        isInTable = true
        tableRows = []
      } else if (event.name === 'tr' && isInTable) {
        rowCells = []
      } else if (event.name === 'tc' && isInTable) {
        const isMerged = event.attributes.hMerge === '1'
          || event.attributes.vMerge === '1'

        cell = {
          parts: [],
          span: Math.max(Number(event.attributes.gridSpan ?? 1) || 1, 1),
          isMerged,
        }
      }

      continue
    }

    if (event.name === 't') {
      isInText = false
    } else if (event.name === 'p' && paragraph) {
      finishParagraph(paragraph)
      paragraph = null
    } else if (event.name === 'tc' && cell) {
      rowCells.push(cell.isMerged ? '' : cell.parts.join(' ').trim())

      for (let extra = 1; extra < cell.span; extra += 1) {
        rowCells.push('')
      }

      cell = null
    } else if (event.name === 'tr' && isInTable) {
      tableRows.push(rowCells)
      rowCells = []
    } else if (event.name === 'tbl') {
      isInTable = false

      const hasText = tableRows.some((row) => {
        return row.some(cellText => cellText.length > 0)
      })

      if (hasText && isCaptured(placeholderType)) {
        content.blocks.push({
          text: renderMarkdownTable(tableRows),
          kind: 'block',
        })
      }

      tableRows = []
    } else if (event.name === 'spTree') {
      break
    }
  }

  content.title = titleParts.join(' ')

  return content
}

function trailingNumber(partName: string): number {
  const match = /(\d+)\.xml$/i.exec(partName)

  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function readSlideOrder(pkg: OfficePackage): string[] {
  const entry = findEntry(pkg, PRESENTATION_PART)

  if (!entry) {
    throw new ExtractError(
      'ooxml_main_part_missing',
      'The presentation has no ppt/presentation.xml part',
    )
  }

  const listed: string[] = []

  scanPart(pkg, entry, (events) => {
    listed.length = 0

    for (const event of events) {
      if (event.type === 'start' && event.name === 'sldId') {
        const relationshipId = relationshipIdOf(event.attributes)

        if (relationshipId !== null) {
          listed.push(relationshipId)
        }
      }
    }

    return false
  }, { keepAttributePrefixes: true })

  const slideRelationships = readRelationships(pkg, PRESENTATION_PART)
    .filter(relationship => relationship.type.endsWith(SLIDE_TYPE_SUFFIX))
  const targetById = new Map(
    slideRelationships.map(relationship => [
      relationship.id,
      relationship.target,
    ] as const),
  )
  const ordered: string[] = []

  for (const relationshipId of listed) {
    const target = targetById.get(relationshipId)

    if (target !== undefined) {
      ordered.push(target)
    }
  }

  if (ordered.length > 0 || slideRelationships.length === 0) {
    return ordered
  }

  return slideRelationships
    .map(relationship => relationship.target)
    .sort((left, right) => trailingNumber(left) - trailingNumber(right))
}

function readNotes(pkg: OfficePackage, slidePart: string): string {
  const relationship = readRelationships(pkg, slidePart).find((candidate) => {
    return candidate.type.endsWith(NOTES_TYPE_SUFFIX)
  })

  if (!relationship) {
    return ''
  }

  const notes = readSlideContent(pkg, relationship.target, notesShapeFilter)

  return notes.blocks
    .map(block => block.text.replace(/^\s*- /, ''))
    .join('\n')
}

export function extractPptx(pkg: OfficePackage): ExtractionOutput {
  const { stats } = pkg
  const sink = new TextSink(pkg.limits.textBytesMax)
  const slideParts = readSlideOrder(pkg)
  let slidesWritten = 0
  let hasContent = false

  stats.slidesTotal = slideParts.length

  for (const [index, slidePart] of slideParts.entries()) {
    const content = readSlideContent(pkg, slidePart, slideShapeFilter)
    const notes = readNotes(pkg, slidePart)
    const hasText = content.title.length > 0
      || content.blocks.length > 0
      || notes.length > 0

    hasContent = hasContent || hasText
    slidesWritten += 1

    let isWritten = sink.add(`## Slide ${index + 1}`)

    if (isWritten && content.title.length > 0) {
      isWritten = sink.add(`### ${content.title}`)
    }

    for (const block of content.blocks) {
      if (!isWritten) {
        break
      }

      isWritten = sink.add(block.text, block.kind)
    }

    if (isWritten && notes.length > 0) {
      sink.add(`Speaker notes: ${notes}`)
    }

    if (sink.isFull) {
      addTruncation(stats, 'text_limit')
      break
    }
  }

  stats.slides = slidesWritten

  return { sink, hasContent }
}
