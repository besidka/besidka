const CITATION_MARKER_SOURCE = '【[^【】\\n]{0,40}†[^【】\\n]{0,40}】'
const CITATION_MARKER_RUN_REGEX = new RegExp(
  `([ \\t]*)(?:${CITATION_MARKER_SOURCE}[ \\t]*)+`,
  'g',
)
const GAP_CLOSING_CHARACTERS = new Set(
  '.,;:!?)]}%、。，；：！？）'.split(''),
)
const LINE_BREAK_CHARACTERS = new Set(['\n', '\r'])

function isLineBoundary(character: string | undefined): boolean {
  return character === undefined || LINE_BREAK_CHARACTERS.has(character)
}

/**
 * Removes the browser citation markers some models (for example
 * gpt-oss) write into answer text, such as `【5†L1-L8】`, together with
 * the whitespace left around them. Text without a dagger is returned as-is.
 */
export function stripModelCitationMarkers(text: string): string {
  if (!text.includes('†')) {
    return text
  }

  return text.replace(
    CITATION_MARKER_RUN_REGEX,
    (match: string, leadingWhitespace: string, offset: number) => {
      const previousCharacter = text[offset - 1]
      const nextCharacter = text[offset + match.length]
      const hadSurroundingWhitespace = leadingWhitespace.length > 0
        || /[ \t]$/.test(match)

      if (!hadSurroundingWhitespace) {
        return ''
      }

      if (
        isLineBoundary(previousCharacter)
        || isLineBoundary(nextCharacter)
        || GAP_CLOSING_CHARACTERS.has(nextCharacter as string)
      ) {
        return ''
      }

      return ' '
    },
  )
}
