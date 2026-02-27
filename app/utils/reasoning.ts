export interface ParsedReasoningSection {
  title: string
  body: string
}

const TITLE_LENGTH_LIMIT = 80

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
    const commaSplit = splitByComma(titleSource)

    if (commaSplit.tail.length > 0) {
      titleSource = commaSplit.head
      remainder = [commaSplit.tail, remainder]
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

function splitByComma(text: string): {
  head: string
  tail: string
} {
  const boundary = text.search(/[,，]/)

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

function trimTrailingPunctuation(text: string): string {
  return text
    .trim()
    .replace(/[.,!?，。！？]+$/g, '')
    .trim()
}
