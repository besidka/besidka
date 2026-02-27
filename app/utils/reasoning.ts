export interface ParsedReasoningSection {
  title: string
  body: string
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

export function extractLastCompleteReasoningTitle(text: string): string {
  if (!text) {
    return ''
  }

  const titlePattern = /\*\*(.+?)\*\*\n\n/g
  const matches = Array.from(text.matchAll(titlePattern))
  const rawTitle = matches.at(-1)?.[1] || ''

  if (!rawTitle) {
    return ''
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

  const title = normalizeReasoningTitle(lines[firstLineIndex] || '')
  const body = lines.slice(firstLineIndex + 1).join('\n').trim()

  return {
    title,
    body,
  }
}
