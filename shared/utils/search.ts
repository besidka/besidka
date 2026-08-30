export const MIN_SEARCH_LENGTH = 2

export const SNIPPET_START = '\uE000'
export const SNIPPET_END = '\uE001'

export interface SnippetSegment {
  text: string
  highlight: boolean
}

/**
 * Splits a server-produced snippet into plain/highlighted segments for
 * safe rendering. The server marks highlighted spans with private-use-area
 * sentinels instead of HTML tags because message bodies can legitimately
 * contain markup, so this NEVER renders snippets with v-html.
 */
export function splitSnippetSegments(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = []
  let remaining = snippet

  while (remaining.length > 0) {
    const startIndex = remaining.indexOf(SNIPPET_START)

    if (startIndex === -1) {
      segments.push({ text: remaining, highlight: false })

      break
    }

    if (startIndex > 0) {
      segments.push({
        text: remaining.slice(0, startIndex),
        highlight: false,
      })
    }

    const afterStart = remaining.slice(startIndex + SNIPPET_START.length)
    const endIndex = afterStart.indexOf(SNIPPET_END)

    if (endIndex === -1) {
      segments.push({ text: afterStart, highlight: true })

      break
    }

    segments.push({
      text: afterStart.slice(0, endIndex),
      highlight: true,
    })

    remaining = afterStart.slice(endIndex + SNIPPET_END.length)
  }

  return segments
}
