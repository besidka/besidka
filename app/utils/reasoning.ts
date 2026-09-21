import type { UIMessage } from 'ai'

export interface ParsedReasoningSection {
  title: string
  body: string
}

const TITLE_LENGTH_LIMIT = 80
const QUOTE_OPENERS = new Set(['"', '“', '«'])
const QUOTE_CLOSERS = new Set(['"', '”', '»'])
const TITLE_DISPLAY_LIMIT = 30
const TITLE_DISPLAY_WORD_BOUNDARY_MINIMUM = 20
const TOOL_PART_TYPE_PREFIX = 'tool-'
const EXCLUDED_TOOL_STEP_NAMES = new Set<string>(['generate_image'])
const PENDING_TOOL_STATES = new Set<string>([
  'input-streaming',
  'input-available',
])
const FAILED_TOOL_STATES = new Set<string>([
  'output-error',
  'output-denied',
])
const TOOL_STEP_TITLES = new Map<string, {
  pending: string
  done: string
  failed: string
}>([
  ['web_search_preview', {
    pending: 'Searching the web',
    done: 'Searched the web',
    failed: 'Search failed',
  }],
])

interface ToolLikeUIPart {
  type: string
  state?: string
  toolName?: string
  preliminary?: boolean
}

export function truncateReasoningTitle(rawTitle: string): string {
  const title = rawTitle.trim()

  if (title.length <= TITLE_DISPLAY_LIMIT) {
    return title
  }

  const clipped = title.slice(0, TITLE_DISPLAY_LIMIT)
  const lastSpaceIndex = clipped.lastIndexOf(' ')
  const shouldCutAtWordBoundary
    = lastSpaceIndex >= TITLE_DISPLAY_WORD_BOUNDARY_MINIMUM
  const cut = shouldCutAtWordBoundary
    ? clipped.slice(0, lastSpaceIndex)
    : clipped
  const trimmedCut = trimTrailingPunctuation(cut).replace(/…+$/, '').trim()

  if (trimmedCut.length === 0) {
    return title
  }

  return `${trimmedCut}…`
}

export function normalizeReasoningTitle(rawTitle: string): string {
  const title = rawTitle
    .replace(/^\*\*(.+)\*\*$/, '$1')
    .trim()

  if (title.length > 0) {
    return title
  }

  return 'Reasoning'
}

export function parseReasoningSections(text: string): ParsedReasoningSection[] {
  const titlePattern = /\*\*(.+?)\*\*\n\n/g
  const titleMatches = Array.from(text.matchAll(titlePattern))

  if (titleMatches.length === 0) {
    const fallbackSection = parseFallbackSection(text)

    if (!fallbackSection) {
      return []
    }

    return [fallbackSection]
  }

  const sections: ParsedReasoningSection[] = []
  const firstMatchIndex = titleMatches[0]?.index ?? 0
  const leadingText = text.slice(0, firstMatchIndex).trim()

  if (leadingText.length > 0) {
    const leadingSection = parseFallbackSection(leadingText)

    if (leadingSection) {
      sections.push(leadingSection)
    }
  }

  for (const [matchIndex, match] of titleMatches.entries()) {
    const rawTitle = match[1] || ''
    const startIndex = (match.index ?? 0) + match[0].length
    const nextMatch = titleMatches[matchIndex + 1]
    const endIndex = nextMatch?.index ?? text.length
    const body = text.slice(startIndex, endIndex).trim()

    sections.push({
      title: normalizeReasoningTitle(rawTitle),
      body,
    })
  }

  return sections
}

export function hasStreamingReasoningPart(
  parts: UIMessage['parts'] | undefined,
): boolean {
  if (!parts) {
    return false
  }

  return parts.some((part) => {
    return (
      part.type === 'reasoning'
      && Boolean(part.text?.length)
      && part.state === 'streaming'
    )
  })
}

export function hasAnyTextPart(
  parts: UIMessage['parts'] | undefined,
): boolean {
  if (!parts) {
    return false
  }

  return parts.some((part) => {
    return part.type === 'text'
  })
}

export function getToolPartName(part: UIMessage['parts'][number]): string {
  if (part.type === 'dynamic-tool') {
    return (part as ToolLikeUIPart).toolName ?? ''
  }

  if (part.type.startsWith(TOOL_PART_TYPE_PREFIX)) {
    return part.type.slice(TOOL_PART_TYPE_PREFIX.length)
  }

  return ''
}

export function isThinkingToolPart(
  part: UIMessage['parts'][number],
): boolean {
  const name = getToolPartName(part)

  return name.length > 0 && !EXCLUDED_TOOL_STEP_NAMES.has(name)
}

export function isPendingToolPart(
  part: UIMessage['parts'][number],
): boolean {
  if (!isThinkingToolPart(part)) {
    return false
  }

  const toolPart = part as ToolLikeUIPart

  return PENDING_TOOL_STATES.has(toolPart.state ?? '')
    || (toolPart.state === 'output-available' && toolPart.preliminary === true)
}

export function isFailedToolPart(
  part: UIMessage['parts'][number],
): boolean {
  if (!isThinkingToolPart(part)) {
    return false
  }

  const toolPart = part as ToolLikeUIPart

  return FAILED_TOOL_STATES.has(toolPart.state ?? '')
}

export function hasPendingToolPart(
  parts: UIMessage['parts'] | undefined,
): boolean {
  if (!parts) {
    return false
  }

  return parts.some(isPendingToolPart)
}

// Deliberately status-agnostic — both call sites gate on status === 'streaming'
// themselves.
export function isThinkingActive(
  parts: UIMessage['parts'] | undefined,
): boolean {
  return hasStreamingReasoningPart(parts) || hasPendingToolPart(parts)
}

function humanizeToolName(name: string): string {
  const humanized = name
    .replace(/^[^a-zA-Z0-9]+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (humanized.length === 0) {
    return 'a tool'
  }

  return humanized
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function getToolStepTitle(
  toolName: string,
  isPending: boolean,
  isFailed: boolean,
): string {
  const knownTitles = TOOL_STEP_TITLES.get(toolName)

  if (knownTitles) {
    if (isFailed) {
      return knownTitles.failed
    }

    return isPending ? knownTitles.pending : knownTitles.done
  }

  if (toolName.toLowerCase().includes('search')) {
    if (isFailed) {
      return 'Search failed'
    }

    return isPending ? 'Searching the web' : 'Searched the web'
  }

  const humanized = humanizeToolName(toolName)

  if (isFailed) {
    return `${capitalize(humanized)} failed`
  }

  return isPending ? `Using ${humanized}` : `Used ${humanized}`
}

export function extractLastCompleteReasoningTitle(text: string): string {
  if (!text) {
    return ''
  }

  const titlePattern = /\*\*(.+?)\*\*\n\n/g
  const matches = Array.from(text.matchAll(titlePattern))
  const rawTitle = matches.at(-1)?.[1] || ''

  if (!rawTitle) {
    const fallbackTitle = extractFallbackTitleAndRemainder(text).title

    return fallbackTitle
  }

  return normalizeReasoningTitle(rawTitle)
}

function parseFallbackSection(
  text: string,
): ParsedReasoningSection | null {
  const lines = text.split('\n')
  const firstLineIndex = lines.findIndex((line) => {
    return line.trim().length > 0
  })

  if (firstLineIndex === -1) {
    return null
  }

  const firstLine = lines[firstLineIndex] || ''
  const trailingBody = lines.slice(firstLineIndex + 1).join('\n').trim()
  const fallback = extractFallbackTitleAndRemainder(firstLine)
  const body = [fallback.remainder, trailingBody]
    .filter((part) => {
      return part.length > 0
    })
    .join('\n')
    .trim()

  return {
    title: fallback.title,
    body,
  }
}

function extractFallbackTitleAndRemainder(text: string): {
  title: string
  remainder: string
} {
  const normalizedText = text.replace(/\s+/g, ' ').trim()

  if (!normalizedText) {
    return {
      title: 'Reasoning',
      remainder: '',
    }
  }

  const sentenceSplit = splitBySentence(normalizedText)
  let titleSource = sentenceSplit.head
  let remainder = sentenceSplit.tail

  if (titleSource.length > TITLE_LENGTH_LIMIT) {
    const split = splitAtEarliestLegalBoundary(titleSource)

    if (split && split.tail.length > 0) {
      titleSource = split.head
      remainder = [split.tail, remainder]
        .filter((part) => {
          return part.length > 0
        })
        .join(' ')
        .trim()
    }
  }

  const normalizedTitle = normalizeReasoningTitle(
    trimTrailingPunctuation(titleSource),
  )

  return {
    title: normalizedTitle,
    remainder,
  }
}

function splitBySentence(text: string): {
  head: string
  tail: string
} {
  const match = text.match(/[.!?。！？]/)
  const boundary = match?.index

  if (boundary === undefined) {
    return {
      head: text.trim(),
      tail: '',
    }
  }

  const head = text.slice(0, boundary + 1).trim()
  const tail = text.slice(boundary + 1).trim()

  return {
    head,
    tail,
  }
}

function splitAtEarliestLegalBoundary(text: string): {
  head: string
  tail: string
} | null {
  const commaBoundary = findUnquotedIndex(text, /[,，]/)
  const quotedClauseMatch = text.match(/[:：]\s*["“«]/)
  const quotedClauseBoundary = quotedClauseMatch?.index ?? -1
  const hasCommaBoundary = commaBoundary !== -1
  const hasQuotedClauseBoundary = quotedClauseBoundary !== -1

  if (!hasCommaBoundary && !hasQuotedClauseBoundary) {
    return null
  }

  if (hasCommaBoundary && hasQuotedClauseBoundary) {
    return commaBoundary < quotedClauseBoundary
      ? splitByComma(text)
      : splitByQuotedClause(text)
  }

  return hasCommaBoundary
    ? splitByComma(text)
    : splitByQuotedClause(text)
}

function splitByQuotedClause(text: string): {
  head: string
  tail: string
} {
  const match = text.match(/[:：]\s*["“«]/)

  if (!match || match.index === undefined) {
    return {
      head: text.trim(),
      tail: '',
    }
  }

  const boundary = match.index
  const quoteIndex = boundary + match[0].length - 1
  const head = text.slice(0, boundary).trim()
  const tail = text.slice(quoteIndex).trim()

  return {
    head,
    tail,
  }
}

function splitByComma(text: string): {
  head: string
  tail: string
} {
  const boundary = findUnquotedIndex(text, /[,，]/)

  if (boundary === -1) {
    return {
      head: text.trim(),
      tail: '',
    }
  }

  const head = text.slice(0, boundary).trim()
  const tail = text.slice(boundary + 1).trim()

  return {
    head,
    tail,
  }
}

function findUnquotedIndex(text: string, pattern: RegExp): number {
  let isInsideQuote = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index)

    if (isInsideQuote) {
      if (QUOTE_CLOSERS.has(character)) {
        isInsideQuote = false
      }

      continue
    }

    if (QUOTE_OPENERS.has(character)) {
      isInsideQuote = true

      continue
    }

    if (pattern.test(character)) {
      return index
    }
  }

  return -1
}

function trimTrailingPunctuation(text: string): string {
  return text
    .trim()
    .replace(/[.,!?，。！？]+$/g, '')
    .trim()
}
