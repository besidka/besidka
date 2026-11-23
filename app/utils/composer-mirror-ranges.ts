export type ComposerMirrorKind = 'command' | 'google-link'

export interface ComposerMirrorRange {
  start: number
  end: number
  kind: ComposerMirrorKind
}

export interface ComposerMirrorSegment {
  start: number
  end: number
  text: string
  kind: ComposerMirrorKind | null
}

const TRAILING_FILLER = ' '

/**
 * The ranges as sorted, non-overlapping, non-empty slices of a text of
 * `textLength` characters: offsets are clamped into the text, a range that
 * starts inside the one before it is clipped to start where that one ends,
 * and anything left empty, reversed or not a number is dropped.
 */
export function normalizeMirrorRanges(
  textLength: number,
  ranges: readonly ComposerMirrorRange[],
): ComposerMirrorRange[] {
  const clamped = ranges
    .filter((range) => {
      return Number.isFinite(range.start) && Number.isFinite(range.end)
    })
    .map((range) => {
      return {
        ...range,
        start: Math.min(Math.max(Math.floor(range.start), 0), textLength),
        end: Math.min(Math.max(Math.floor(range.end), 0), textLength),
      }
    })
    .sort((first, second) => {
      return first.start - second.start || first.end - second.end
    })
  const normalized: ComposerMirrorRange[] = []
  let cursor = 0

  for (const range of clamped) {
    const start = Math.max(range.start, cursor)

    if (range.end <= start) {
      continue
    }

    normalized.push({ ...range, start })
    cursor = range.end
  }

  return normalized
}

/**
 * The text cut at the normalized ranges: marked slices and the plain text
 * between them. Every character appears exactly once and in order, so the
 * segments joined are the text, followed by one filler space at the very end
 * (it keeps a final newline on its own line, as in the textarea).
 */
export function buildMirrorSegments(
  text: string,
  ranges: readonly ComposerMirrorRange[],
): ComposerMirrorSegment[] {
  const segments: ComposerMirrorSegment[] = []
  let cursor = 0

  for (const range of normalizeMirrorRanges(text.length, ranges)) {
    if (range.start > cursor) {
      segments.push({
        start: cursor,
        end: range.start,
        text: text.slice(cursor, range.start),
        kind: null,
      })
    }

    segments.push({
      start: range.start,
      end: range.end,
      text: text.slice(range.start, range.end),
      kind: range.kind,
    })
    cursor = range.end
  }

  segments.push({
    start: cursor,
    end: text.length,
    text: `${text.slice(cursor)}${TRAILING_FILLER}`,
    kind: null,
  })

  return segments
}
