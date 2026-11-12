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
  relationshipIdOf,
  renderMarkdownTable,
  scanPart,
  shortId,
  trimLineEnds,
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

interface ShapeLimits {
  maxBytes: number
}

interface ParagraphState {
  level: number
  hasBullet: boolean | undefined
  parts: string[]
  length: number
}

interface CellState {
  parts: string[]
  length: number
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
const XML_SUFFIX_LENGTH = 4
const MAX_DIGITS = 15

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
  officePackage: OfficePackage,
  partName: string,
  isCaptured: ShapeFilter,
  maxBytes: number,
): SlideContent {
  const entry = findEntry(officePackage, partName)
  let content = emptyContent()

  if (!entry) {
    return content
  }

  scanPart(officePackage, entry, (events) => {
    content = walkShapes(officePackage, events, isCaptured, { maxBytes })

    return false
  })

  return content
}

function walkShapes(
  officePackage: OfficePackage,
  events: Iterable<XmlEvent>,
  isCaptured: ShapeFilter,
  shapeLimits: ShapeLimits,
): SlideContent {
  const { rowsMax, columnsMax, cellCharsMax, textBytesMax }
    = officePackage.limits
  const content = emptyContent()
  const titleParts: string[] = []
  let collectedLength = 0
  let hasDroppedRows = false
  let paragraph: ParagraphState | null = null
  let tableRows: string[][] = []
  let rowCells: string[] = []
  let cell: CellState | null = null
  let isInTable = false
  let placeholderType: string | null = null
  let skipDepth = 0
  let isInText = false

  function finishParagraph(finished: ParagraphState): void {
    const text = trimLineEnds(finished.parts.join('')).trim()

    if (text.length === 0) {
      return
    }

    if (cell) {
      if (cell.length < cellCharsMax) {
        cell.parts.push(text)
        cell.length += text.length
      }

      return
    }

    if (!isCaptured(placeholderType)) {
      return
    }

    if (placeholderType !== null && TITLE_TYPES.has(placeholderType)) {
      titleParts.push(collapseLineBreaks(text))
      collectedLength += text.length

      return
    }

    const isBulleted = finished.hasBullet
      ?? (placeholderType !== null && BODY_TYPES.has(placeholderType))

    if (isBulleted) {
      const indent = LIST_INDENT.repeat(finished.level)
      const body = text.replace(/\n/g, `\n${indent}${LIST_INDENT}`)

      content.blocks.push({ text: `${indent}- ${body}`, kind: 'list' })
      collectedLength += text.length

      return
    }

    content.blocks.push({ text, kind: 'block' })
    collectedLength += text.length
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

    if (collectedLength > shapeLimits.maxBytes) {
      break
    }

    if (event.type === 'text') {
      if (isInText) {
        if (paragraph) {
          appendText(paragraph, event.text, textBytesMax)
        }
      }

      continue
    }

    if (event.type === 'start') {
      if (event.name === 'Fallback') {
        skipDepth = 1
      } else if (event.name === 'sp' || event.name === 'graphicFrame') {
        placeholderType = null
      } else if (event.name === 'ph') {
        placeholderType = shortId(event.attributes.type ?? 'body')
      } else if (event.name === 'p') {
        paragraph = { level: 0, hasBullet: undefined, parts: [], length: 0 }
      } else if (event.name === 'pPr' && paragraph) {
        paragraph.level = Math.min(Number(event.attributes.lvl ?? 0) || 0, 8)
      } else if (event.name === 'buNone' && paragraph) {
        paragraph.hasBullet = false
      } else if (BULLET_ELEMENTS.has(event.name) && paragraph) {
        paragraph.hasBullet = true
      } else if (event.name === 't') {
        isInText = paragraph !== null
      } else if (event.name === 'br' && paragraph) {
        appendText(paragraph, '\n', textBytesMax)
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
          length: 0,
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
      const isClamped = appendSpannedCell(
        rowCells,
        cell.isMerged ? '' : cell.parts.join(' ').trim(),
        cell.span,
        columnsMax,
      )

      if (isClamped) {
        addTruncation(officePackage.stats, 'columns_limit')
      }

      cell = null
    } else if (event.name === 'tr' && isInTable) {
      if (tableRows.length < rowsMax) {
        tableRows.push(rowCells)
      } else {
        hasDroppedRows = true
      }

      rowCells = []
    } else if (event.name === 'tbl') {
      isInTable = false

      const hasText = tableRows.some((row) => {
        return row.some(cellText => cellText.length > 0)
      })

      if (hasText && isCaptured(placeholderType)) {
        const table = renderMarkdownTable(tableRows, {
          rowsMax,
          columnsMax,
          cellCharsMax,
          maxBytes: shapeLimits.maxBytes - collectedLength,
        })

        content.blocks.push({ text: table.text, kind: 'block' })
        collectedLength += table.text.length

        for (const reason of table.reasons) {
          addTruncation(officePackage.stats, reason)
        }
      }

      if (hasDroppedRows) {
        addTruncation(officePackage.stats, 'rows_limit')
      }

      hasDroppedRows = false
      tableRows = []
    } else if (event.name === 'spTree') {
      break
    }
  }

  content.title = titleParts.join(' ')

  return content
}

function trailingNumber(partName: string): number {
  const lower = partName.toLowerCase()

  if (!lower.endsWith('.xml')) {
    return Number.MAX_SAFE_INTEGER
  }

  const digitsEnd = lower.length - XML_SUFFIX_LENGTH
  let digitsStart = digitsEnd

  while (digitsStart > 0 && isDigit(lower.charCodeAt(digitsStart - 1))) {
    digitsStart -= 1
  }

  if (digitsStart === digitsEnd || digitsEnd - digitsStart > MAX_DIGITS) {
    return Number.MAX_SAFE_INTEGER
  }

  return Number(lower.slice(digitsStart, digitsEnd))
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39
}

function uniqueParts(partNames: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const partName of partNames) {
    const key = partName.toLowerCase()

    if (!seen.has(key)) {
      seen.add(key)
      unique.push(partName)
    }
  }

  return unique
}

function readSlideOrder(officePackage: OfficePackage): string[] {
  const presentationPart = officePackage.mainPart || PRESENTATION_PART
  const entry = findEntry(officePackage, presentationPart)

  if (!entry) {
    throw new ExtractError(
      'ooxml_main_part_missing',
      'The presentation has no ppt/presentation.xml part',
    )
  }

  const listed: string[] = []

  scanPart(officePackage, entry, (events) => {
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

  const slideRelationships = readRelationships(officePackage, presentationPart)
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
    return uniqueParts(ordered)
  }

  return uniqueParts(
    slideRelationships
      .map(relationship => relationship.target)
      .sort((left, right) => trailingNumber(left) - trailingNumber(right)),
  )
}

function readNotes(
  officePackage: OfficePackage,
  slidePart: string,
  notesCache: Map<string, string>,
  maxBytes: number,
): string {
  const relationship = readRelationships(officePackage, slidePart)
    .find((candidate) => {
      return candidate.type.endsWith(NOTES_TYPE_SUFFIX)
    })

  if (!relationship) {
    return ''
  }

  const cacheKey = relationship.target.toLowerCase()
  const cached = notesCache.get(cacheKey)

  if (cached !== undefined) {
    return cached
  }

  const notes = readSlideContent(
    officePackage,
    relationship.target,
    notesShapeFilter,
    maxBytes,
  )
  const text = notes.blocks
    .map(block => block.text.replace(/^\s*- /, ''))
    .join('\n')

  notesCache.set(cacheKey, text)

  return text
}

export function extractPptx(officePackage: OfficePackage): ExtractionOutput {
  const { stats, limits } = officePackage
  const sink = new TextSink(limits.textBytesMax)
  const allSlideParts = readSlideOrder(officePackage)
  const slideParts = allSlideParts.slice(0, limits.slidesMax)
  const notesCache = new Map<string, string>()
  let slidesWritten = 0
  let hasContent = false

  stats.slidesTotal = allSlideParts.length

  if (allSlideParts.length > limits.slidesMax) {
    addTruncation(stats, 'slides_limit')
  }

  for (const [index, slidePart] of slideParts.entries()) {
    const content = readSlideContent(
      officePackage,
      slidePart,
      slideShapeFilter,
      sink.remainingBytes,
    )
    const notes = readNotes(
      officePackage,
      slidePart,
      notesCache,
      sink.remainingBytes,
    )
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
