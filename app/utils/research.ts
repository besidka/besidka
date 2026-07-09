import type { UIMessage } from 'ai'

export function formatResearchElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function hasResearchMetaPart(
  message: Pick<UIMessage, 'parts'>,
): boolean {
  return message.parts.some((part) => {
    return part.type === 'data-research'
  })
}

export interface ParsedResearchStep {
  title: string
  description: string
}

const LEADING_EMPHASIS_PATTERNS = [
  /^\*\*([\s\S]+?)\*\*/,
  /^__([\s\S]+?)__/,
  /^\*([\s\S]+?)\*/,
  /^_([\s\S]+?)_/,
]

const SENTENCE_BOUNDARY_PATTERN = /[.!?](?=\s|$)|[。！？]/g

/**
 * Splits a raw research step's text into a title and a description.
 *
 * A leading markdown-emphasized phrase (`**t**`, `*t*`, `__t__`, `_t_`)
 * becomes the title, with the remainder as the description. Without a
 * leading emphasis, the first sentence becomes the title and the rest the
 * description. The title is always plain text (stray emphasis markers
 * stripped); the description is returned verbatim (paragraph breaks kept).
 */
export function parseResearchStepText(text: string): ParsedResearchStep {
  const trimmed = (text ?? '').trim()

  if (!trimmed) {
    return { title: '', description: '' }
  }

  for (const pattern of LEADING_EMPHASIS_PATTERNS) {
    const match = trimmed.match(pattern)

    if (match) {
      return {
        title: stripEmphasisMarkers(match[1] ?? ''),
        description: trimmed.slice(match[0].length).trim(),
      }
    }
  }

  const boundary = findSentenceBoundary(trimmed)

  if (boundary === -1) {
    return {
      title: stripEmphasisMarkers(trimmed),
      description: '',
    }
  }

  return {
    title: stripEmphasisMarkers(trimmed.slice(0, boundary + 1)),
    description: trimmed.slice(boundary + 1).trim(),
  }
}

export function formatResearchLinkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function findSentenceBoundary(text: string): number {
  const pattern = new RegExp(SENTENCE_BOUNDARY_PATTERN)
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const index = match.index

    if (text[index] === '.' && isDecimalOrOrdinalPeriod(text, index)) {
      continue
    }

    return index
  }

  return -1
}

function isDecimalOrOrdinalPeriod(text: string, index: number): boolean {
  const before = text[index - 1]
  const afterNonSpace = text.slice(index + 1).trimStart()[0]

  return before !== undefined
    && /\d/.test(before)
    && afterNonSpace !== undefined
    && /\d/.test(afterNonSpace)
}

function stripEmphasisMarkers(text: string): string {
  let result = text
  let previous: string

  do {
    previous = result
    result = result
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(\*|_)(.+?)\1/g, '$2')
  } while (result !== previous)

  return result.replace(/^[*_]+/, '').replace(/[*_]+$/, '').trim()
}
