import type { KnowledgePackLine } from '#shared/types/project-knowledge.d'
import { countKnowledgeChars } from '#shared/utils/project-knowledge-budget'
import {
  KNOWLEDGE_CHARS_PER_TOKEN,
  KNOWLEDGE_LIMITS,
} from '#shared/utils/project-knowledge-policy'

interface Atom {
  text: string
  cost: number
}

interface Block {
  text: string
  cost: number
  isFence: boolean
  startsSection: boolean
  path: string[]
}

interface OpenBlock {
  lines: string[]
  isFence: boolean
  startsSection: boolean
  hasBody: boolean
  sawBlankAfterBody: boolean
  path: string[] | null
}

interface HeadingEntry {
  level: number
  text: string
}

interface FenceState {
  character: string
  length: number
}

type Splitter = (text: string) => string[]

const TARGET_TOKENS = KNOWLEDGE_LIMITS.chunkTargetTokens
const RATES = KNOWLEDGE_CHARS_PER_TOKEN.default
const BREADCRUMB_SEPARATOR = ' › '
const MAX_HEADING_LINE_LENGTH = 300
const MAX_BREADCRUMB_HEADING_CHARS = 80
const HARD_SPLIT_STEP_CODE_POINTS = 64
const HEADING_PATTERN = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$/
const HEADING_CLOSING_HASHES_PATTERN = /[ \t]+#+$/
const FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const LEADING_BLANK_LINES_PATTERN = /^(?:[ \t\r]*\n)+/
const WHITESPACE_PATTERN = /\s/
const SENTENCE_TERMINATORS = new Set(['.', '!', '?', '…', '。', '！', '？'])
const SENTENCE_CLOSERS = new Set(['"', '\'', ')', ']', '»', '”', '’'])

function costOf(text: string): number {
  const counts = countKnowledgeChars(text)

  return counts.latinChars / RATES.latin
    + counts.cyrillicChars / RATES.cyrillic
    + counts.otherChars / RATES.other
}

function isWhitespace(character: string): boolean {
  return WHITESPACE_PATTERN.test(character)
}

function splitLinesKeepingEnds(text: string): string[] {
  const lines: string[] = []
  let start = 0

  while (start < text.length) {
    const newlineIndex = text.indexOf('\n', start)

    if (newlineIndex === -1) {
      lines.push(text.slice(start))

      break
    }

    lines.push(text.slice(start, newlineIndex + 1))
    start = newlineIndex + 1
  }

  return lines
}

function splitSentences(text: string): string[] {
  const pieces: string[] = []
  let pieceStart = 0
  let index = 0

  while (index < text.length) {
    const character = text[index]!

    if (character === '\n') {
      index++
      pieces.push(text.slice(pieceStart, index))
      pieceStart = index

      continue
    }

    if (!SENTENCE_TERMINATORS.has(character)) {
      index++

      continue
    }

    let cursor = index + 1

    while (cursor < text.length && SENTENCE_CLOSERS.has(text[cursor]!)) {
      cursor++
    }

    if (cursor >= text.length || !isWhitespace(text[cursor]!)) {
      index = cursor

      continue
    }

    while (cursor < text.length && isWhitespace(text[cursor]!)) {
      cursor++
    }

    pieces.push(text.slice(pieceStart, cursor))
    pieceStart = cursor
    index = cursor
  }

  if (pieceStart < text.length) {
    pieces.push(text.slice(pieceStart))
  }

  return pieces
}

function splitWords(text: string): string[] {
  const pieces: string[] = []
  let pieceStart = 0

  for (let index = 1; index < text.length; index++) {
    if (isWhitespace(text[index - 1]!) && !isWhitespace(text[index]!)) {
      pieces.push(text.slice(pieceStart, index))
      pieceStart = index
    }
  }

  if (pieceStart < text.length) {
    pieces.push(text.slice(pieceStart))
  }

  return pieces
}

function advanceCodePoints(text: string, from: number, count: number): number {
  let index = from

  for (let step = 0; step < count && index < text.length; step++) {
    const codePoint = text.codePointAt(index)!

    index += codePoint > 0xFFFF ? 2 : 1
  }

  return index
}

function hardSplit(text: string): Atom[] {
  const atoms: Atom[] = []
  let start = 0

  while (start < text.length) {
    let end = start
    let cost = 0

    while (end < text.length) {
      const stepEnd = advanceCodePoints(text, end, HARD_SPLIT_STEP_CODE_POINTS)
      const stepCost = costOf(text.slice(end, stepEnd))

      if (end > start && cost + stepCost > TARGET_TOKENS) {
        break
      }

      cost += stepCost
      end = stepEnd
    }

    atoms.push({ text: text.slice(start, end), cost })
    start = end
  }

  return atoms
}

function atomize(text: string, splitters: Splitter[]): Atom[] {
  const cost = costOf(text)

  if (cost <= TARGET_TOKENS) {
    return [{ text, cost }]
  }

  const [splitter, ...remainingSplitters] = splitters

  if (!splitter) {
    return hardSplit(text)
  }

  const pieces = splitter(text)

  if (pieces.length <= 1) {
    return atomize(text, remainingSplitters)
  }

  return pieces.flatMap((piece) => {
    return atomize(piece, remainingSplitters)
  })
}

function parseHeading(content: string): HeadingEntry | null {
  if (content.length > MAX_HEADING_LINE_LENGTH) {
    return null
  }

  const match = HEADING_PATTERN.exec(content)

  if (!match) {
    return null
  }

  const headingText = match[2]!
    .replace(HEADING_CLOSING_HASHES_PATTERN, '')
    .trim()

  if (headingText === '') {
    return null
  }

  return {
    level: match[1]!.length,
    text: [...headingText].slice(0, MAX_BREADCRUMB_HEADING_CHARS).join(''),
  }
}

function parseFenceOpen(content: string): FenceState | null {
  const match = FENCE_OPEN_PATTERN.exec(content)

  if (!match) {
    return null
  }

  return { character: match[1]![0]!, length: match[1]!.length }
}

function isFenceClose(content: string, fence: FenceState): boolean {
  const match = FENCE_CLOSE_PATTERN.exec(content)

  if (!match) {
    return false
  }

  return match[1]![0] === fence.character && match[1]!.length >= fence.length
}

function stripLineEnding(line: string): string {
  if (line.endsWith('\r\n')) {
    return line.slice(0, -2)
  }

  if (line.endsWith('\n')) {
    return line.slice(0, -1)
  }

  return line
}

function createOpenBlock(startsSection: boolean): OpenBlock {
  return {
    lines: [],
    isFence: false,
    startsSection,
    hasBody: false,
    sawBlankAfterBody: false,
    path: null,
  }
}

/**
 * Splits text into blocks that are never cut apart unless they are too big:
 * a paragraph (ended by blank lines), a fenced code block, or a run of
 * headings glued to the first block under them. Each block remembers the
 * heading path that applies to its body and whether it opens a heading
 * section.
 */
function buildBlocks(text: string): Block[] {
  const blocks: Block[] = []
  const headingStack: HeadingEntry[] = []
  let openBlock = createOpenBlock(true)
  let fence: FenceState | null = null

  function currentPath(): string[] {
    return headingStack.map((entry) => {
      return entry.text
    })
  }

  function finishBlock(): void {
    if (openBlock.lines.length > 0) {
      const blockText = openBlock.lines.join('')

      blocks.push({
        text: blockText,
        cost: costOf(blockText),
        isFence: openBlock.isFence,
        startsSection: openBlock.startsSection,
        path: openBlock.path ?? currentPath(),
      })
    }

    openBlock = createOpenBlock(false)
  }

  for (const line of splitLinesKeepingEnds(text)) {
    const content = stripLineEnding(line)

    if (fence) {
      openBlock.lines.push(line)

      if (isFenceClose(content, fence)) {
        fence = null
        finishBlock()
      }

      continue
    }

    const heading = parseHeading(content)

    if (heading) {
      if (openBlock.hasBody) {
        finishBlock()
      }

      while (
        headingStack.length > 0
        && headingStack[headingStack.length - 1]!.level >= heading.level
      ) {
        headingStack.pop()
      }

      headingStack.push(heading)
      openBlock.startsSection = true
      openBlock.lines.push(line)

      continue
    }

    const fenceOpen = parseFenceOpen(content)

    if (fenceOpen) {
      if (openBlock.hasBody) {
        finishBlock()
      }

      fence = fenceOpen
      openBlock.isFence = true
      openBlock.hasBody = true
      openBlock.path ??= currentPath()
      openBlock.lines.push(line)

      continue
    }

    if (content.trim() === '') {
      openBlock.lines.push(line)
      openBlock.sawBlankAfterBody ||= openBlock.hasBody

      continue
    }

    if (openBlock.hasBody && openBlock.sawBlankAfterBody) {
      finishBlock()
    }

    openBlock.hasBody = true
    openBlock.path ??= currentPath()
    openBlock.lines.push(line)
  }

  finishBlock()

  return blocks
}

function computeSectionTotals(blocks: Block[]): number[] {
  const totals: number[] = Array.from({ length: blocks.length }, () => {
    return 0
  })
  let sectionStartIndex = 0

  blocks.forEach((block, index) => {
    if (block.startsSection) {
      sectionStartIndex = index
    }

    totals[sectionStartIndex]! += block.cost
  })

  return totals
}

function blockAtoms(block: Block): Atom[] {
  if (block.cost <= TARGET_TOKENS) {
    return [{ text: block.text, cost: block.cost }]
  }

  const splitters = block.isFence
    ? [splitLinesKeepingEnds, splitWords]
    : [splitSentences, splitWords]

  return atomize(block.text, splitters)
}

/**
 * Splits one item's text into non-overlapping chunks of at most
 * `KNOWLEDGE_LIMITS.chunkTargetTokens` estimated tokens (default family).
 * Packing is greedy over atoms: a block (paragraph, fenced code block,
 * heading plus its first block) stays whole when it fits; a heading section
 * that fits in one chunk is not split across two; oversized blocks are cut
 * at sentences (lines inside fenced blocks), then words, then code points,
 * so a single enormous line and pure Cyrillic text are handled without
 * losing or duplicating a character. Only whitespace at chunk edges is
 * trimmed. The breadcrumb is `relativePath ?? title` followed by the
 * heading path of the chunk's first block.
 */
export function chunkKnowledgeText(input: {
  itemId: string
  title: string
  relativePath: string | null
  text: string
}): KnowledgePackLine[] {
  if (input.text.trim() === '') {
    return []
  }

  const baseLabel = input.relativePath ?? input.title
  const blocks = buildBlocks(input.text)
  const sectionTotals = computeSectionTotals(blocks)
  const chunks: KnowledgePackLine[] = []
  let parts: string[] = []
  let partsCost = 0
  let chunkPath: string[] = []

  function flush(): void {
    const chunkText = parts
      .join('')
      .replace(LEADING_BLANK_LINES_PATTERN, '')
      .trimEnd()

    parts = []
    partsCost = 0

    if (chunkText.trim() === '') {
      return
    }

    chunks.push({
      type: 'chunk',
      itemId: input.itemId,
      ordinal: chunks.length,
      breadcrumb: [baseLabel, ...chunkPath].join(BREADCRUMB_SEPARATOR),
      text: chunkText,
    })
  }

  blocks.forEach((block, blockIndex) => {
    const sectionOverflows = block.startsSection
      && parts.length > 0
      && partsCost + sectionTotals[blockIndex]! > TARGET_TOKENS

    if (sectionOverflows) {
      flush()
    }

    for (const atom of blockAtoms(block)) {
      if (parts.length > 0 && partsCost + atom.cost > TARGET_TOKENS) {
        flush()
      }

      if (parts.length === 0) {
        chunkPath = block.path
      }

      parts.push(atom.text)
      partsCost += atom.cost
    }
  })

  flush()

  return chunks
}
