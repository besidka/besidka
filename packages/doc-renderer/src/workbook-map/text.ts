const HIGH_SURROGATE_START = 0xD800
const HIGH_SURROGATE_END = 0xDBFF
const LOW_SURROGATE_START = 0xDC00
const LOW_SURROGATE_END = 0xDFFF
const BACKTICK = 0x60
const SPACE = 0x20
const DELETE = 0x7F
const C1_END = 0x9F
const LINE_SEPARATOR = 0x2028
const PARAGRAPH_SEPARATOR = 0x2029
const ZERO_WIDTH_START = 0x200B
const ZERO_WIDTH_END = 0x200F
const BIDI_START = 0x202A
const BIDI_END = 0x202E
const BIDI_ISOLATE_START = 0x2066
const BIDI_ISOLATE_END = 0x2069
const BYTE_ORDER_MARK = 0xFEFF
export const NEUTRAL_BACKTICK = 'ˋ'
export const ELLIPSIS = '…'

export function utf8Length(text: string): number {
  let bytes = 0

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)

    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (
      code >= HIGH_SURROGATE_START
      && code <= HIGH_SURROGATE_END
      && index + 1 < text.length
      && text.charCodeAt(index + 1) >= LOW_SURROGATE_START
      && text.charCodeAt(index + 1) <= LOW_SURROGATE_END
    ) {
      bytes += 4
      index += 1
    } else {
      bytes += 3
    }
  }

  return bytes
}

const DELETED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00AD, 0x00AD],
  [0x034F, 0x034F],
  [0x061C, 0x061C],
  [0x115F, 0x1160],
  [0x180E, 0x180E],
  [0x2060, 0x2064],
  [0x2800, 0x2800],
  [0x3164, 0x3164],
  [0xFE00, 0xFE0F],
  [0xFFA0, 0xFFA0],
  [0xFFF9, 0xFFFB],
]
const TAG_HIGH_SURROGATE = 0xDB40
const TAG_LOW_START = 0xDC00
const TAG_LOW_END = 0xDC7F
const VARIATION_LOW_START = 0xDD00
const VARIATION_LOW_END = 0xDDEF
const MUSICAL_HIGH_SURROGATE = 0xD834
const MUSICAL_LOW_START = 0xDD73
const MUSICAL_LOW_END = 0xDD7A
const REPLACEMENT_CHARACTER = '�'

function isHighSurrogate(code: number): boolean {
  return code >= HIGH_SURROGATE_START && code <= HIGH_SURROGATE_END
}

function isLowSurrogate(code: number): boolean {
  return code >= LOW_SURROGATE_START && code <= LOW_SURROGATE_END
}

function isInvisibleOrControl(code: number): boolean {
  return code < SPACE
    || (code >= DELETE && code <= C1_END)
    || code === LINE_SEPARATOR
    || code === PARAGRAPH_SEPARATOR
    || (code >= ZERO_WIDTH_START && code <= ZERO_WIDTH_END)
    || (code >= BIDI_START && code <= BIDI_END)
    || (code >= BIDI_ISOLATE_START && code <= BIDI_ISOLATE_END)
    || code === BYTE_ORDER_MARK
}

/**
 * How many UTF-16 units at this position are an invisible format character
 * that is removed outright (soft hyphen, joiners, variation selectors, tag
 * characters U+E0000 to U+E007F and the supplement selectors U+E0100 to
 * U+E01EF); 0 when the character stays.
 */
function deletedWidth(code: number, next: number): number {
  if (code === TAG_HIGH_SURROGATE) {
    const isTag = next >= TAG_LOW_START && next <= TAG_LOW_END
    const isSelector = next >= VARIATION_LOW_START && next <= VARIATION_LOW_END

    return isTag || isSelector ? 2 : 0
  }

  if (code === MUSICAL_HIGH_SURROGATE) {
    const isMusicalFormat = next >= MUSICAL_LOW_START
      && next <= MUSICAL_LOW_END

    return isMusicalFormat ? 2 : 0
  }

  for (const [start, end] of DELETED_RANGES) {
    if (code >= start && code <= end) {
      return 1
    }
  }

  return 0
}

/**
 * Makes untrusted workbook text safe for one line of the map: control,
 * zero-width and bidirectional characters become a space (runs of them one
 * space), invisible format characters that sit inside words (soft hyphens,
 * joiners, variation and tag characters) are removed, a backtick becomes a
 * look-alike so no run of backticks can close the Markdown fence the text
 * is sent in, and the result is cut to `maxCharacters` with an ellipsis.
 * One linear pass that copies untouched runs as slices.
 */
export function cleanLine(text: string, maxCharacters: number): string {
  let result = ''
  let runStart = 0
  let kept = 0
  let index = 0
  let lastWasSpace = false

  while (index < text.length && kept < maxCharacters) {
    const code = text.charCodeAt(index)
    const deleted = deletedWidth(code, text.charCodeAt(index + 1))

    if (deleted > 0) {
      result += text.slice(runStart, index)
      index += deleted
      runStart = index
      continue
    }

    if (isInvisibleOrControl(code)) {
      result += text.slice(runStart, index)

      if (!lastWasSpace) {
        result += ' '
        kept += 1
      }

      lastWasSpace = true
      index += 1
      runStart = index
      continue
    }

    lastWasSpace = code === SPACE

    if (code === BACKTICK) {
      result += `${text.slice(runStart, index)}${NEUTRAL_BACKTICK}`
      index += 1
      runStart = index
      kept += 1
      continue
    }

    const isPair = isHighSurrogate(code)
      && isLowSurrogate(text.charCodeAt(index + 1))

    if ((isHighSurrogate(code) && !isPair) || isLowSurrogate(code)) {
      result += `${text.slice(runStart, index)}${REPLACEMENT_CHARACTER}`
      index += 1
      runStart = index
      kept += 1
      continue
    }

    const width = isPair ? 2 : 1

    if (kept + width > maxCharacters) {
      break
    }

    index += width
    kept += width
  }

  result += text.slice(runStart, Math.min(index, text.length))

  return index < text.length ? `${result}${ELLIPSIS}` : result
}

/**
 * A value quoted for prose: the cleaned text in double quotes, with inner
 * double quotes and backslashes escaped so the quote cannot end early.
 */
export function quote(text: string, maxCharacters: number): string {
  const cleaned = cleanLine(text, maxCharacters)

  return `"${cleaned.replace(/[\\"]/g, '\\$&')}"`
}

export function escapeCsvField(text: string): string {
  let needsQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)

    if (code === 0x22 || code === 0x2C) {
      needsQuotes = true
      break
    }
  }

  return needsQuotes ? `"${text.split('"').join('""')}"` : text
}

export function plural(count: number, singular: string, many: string): string {
  return `${count} ${count === 1 ? singular : many}`
}
