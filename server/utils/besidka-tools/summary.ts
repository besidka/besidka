const TEXT_ECHO_MAX_CHARS = 60
const TOKEN_ECHO_MAX_CHARS = 40
const LISTED_TOKENS_MAX = 3
const ELLIPSIS = '…'
const INVISIBLE_OR_WHITESPACE = /[\p{C}\p{Z}\s]+/gu

function clip(value: string, maxChars: number): string {
  const collapsed = value.replace(INVISIBLE_OR_WHITESPACE, ' ').trim()
  const characters = Array.from(collapsed)

  if (characters.length <= maxChars) {
    return collapsed
  }

  return `${characters.slice(0, maxChars - 1).join('')}${ELLIPSIS}`
}

/**
 * Echoes model-written text inside an approval sentence: control, format and
 * separator characters collapse to one space, the length is capped and the
 * result is quoted, so the text cannot start a new line or imitate the
 * sentence around it.
 */
export function quoteText(
  value: string,
  maxChars: number = TEXT_ECHO_MAX_CHARS,
): string {
  return `"${clip(value, maxChars).replaceAll('"', '\'')}"`
}

export function plainToken(
  value: string,
  maxChars: number = TOKEN_ECHO_MAX_CHARS,
): string {
  return clip(value, maxChars)
}

export function pluralize(
  count: number,
  singular: string,
  plural: string = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function listTokens(values: readonly string[]): string {
  const listed = values.slice(0, LISTED_TOKENS_MAX).map((value) => {
    return plainToken(value)
  })
  const hiddenCount = values.length - listed.length

  if (hiddenCount <= 0) {
    return listed.join(', ')
  }

  return `${listed.join(', ')} and ${hiddenCount} more`
}

export function joinPhrases(phrases: readonly string[]): string {
  if (phrases.length <= 1) {
    return phrases.join('')
  }

  const head = phrases.slice(0, -1).join(', ')

  return `${head} and ${phrases.at(-1)}`
}
