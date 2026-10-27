import { MEMORY_LIMITS } from '#shared/utils/memory-policy'

const FALLBACK_DESCRIPTION = 'Things I wrote about myself'
const ELLIPSIS = '…'
const LINE_BREAK = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/
const WHITESPACE_RUN = /\s+/g
const HIGH_SURROGATE = /[\uD800-\uDBFF]$/

/**
 * The description is the first non-empty line of the text with whitespace
 * collapsed. A longer line is cut at the last word boundary that leaves room
 * for the ellipsis inside `maxDescriptionChars`.
 */
export function buildAboutMeDescription(aboutMe: string): string {
  const firstLine = aboutMe
    .split(LINE_BREAK)
    .map((line) => {
      return line.replace(WHITESPACE_RUN, ' ').trim()
    })
    .find((line) => {
      return line !== ''
    })

  if (!firstLine) {
    return FALLBACK_DESCRIPTION
  }

  const limit = MEMORY_LIMITS.maxDescriptionChars

  if (firstLine.length <= limit) {
    return firstLine
  }

  const room = limit - ELLIPSIS.length
  const clipped = firstLine.slice(0, room)
  const endsOnWordBoundary = /\s/.test(firstLine.charAt(room))
  const lastSpaceIndex = clipped.lastIndexOf(' ')
  const wordSafe = endsOnWordBoundary || lastSpaceIndex <= 0
    ? clipped
    : clipped.slice(0, lastSpaceIndex)
  const cut = wordSafe.replace(HIGH_SURROGATE, '').trimEnd()

  return `${cut}${ELLIPSIS}`
}
