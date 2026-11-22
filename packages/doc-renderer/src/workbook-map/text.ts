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
 * Makes untrusted workbook text safe for one line of the map: control,
 * zero-width and bidirectional characters become a space (runs of them one
 * space), a backtick becomes a look-alike so no run of backticks can close
 * the Markdown fence the text is sent in, and the result is cut to
 * `maxCharacters` with an ellipsis. One linear pass.
 */
export function cleanLine(text: string, maxCharacters: number): string {
  const pieces: string[] = []
  let kept = 0
  let index = 0
  let lastWasSpace = false

  while (index < text.length && kept < maxCharacters) {
    const code = text.charCodeAt(index)

    index += 1

    if (isInvisibleOrControl(code)) {
      if (!lastWasSpace) {
        pieces.push(' ')
        kept += 1
      }

      lastWasSpace = true
      continue
    }

    lastWasSpace = code === SPACE

    if (code === BACKTICK) {
      pieces.push(NEUTRAL_BACKTICK)
    } else if (code >= HIGH_SURROGATE_START && code <= HIGH_SURROGATE_END) {
      if (kept + 2 > maxCharacters) {
        index -= 1
        break
      }

      pieces.push(text.slice(index - 1, index + 1))
      index += 1
      kept += 1
    } else {
      pieces.push(text.charAt(index - 1))
    }

    kept += 1
  }

  const result = pieces.join('')

  return index < text.length ? `${result}${ELLIPSIS}` : result
}

/**
 * A value quoted for prose: the cleaned text in double quotes.
 */
export function quote(text: string, maxCharacters: number): string {
  return `"${cleanLine(text, maxCharacters)}"`
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
