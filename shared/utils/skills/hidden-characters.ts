const HIDDEN_CHARACTER_CLASS
  = '[\\p{Cf}\\u{E0000}-\\u{E007F}\\u2060-\\u2064\\u061C\\u00AD\\u180E\\u3164'
    + '\\uFE00-\\uFE0F\\u{E0100}-\\u{E01EF}]'
const TAG_BLOCK_START = 0xE0000
const TAG_BLOCK_END = 0xE007F
const TAG_SPACE = 0xE0020
const TAG_TILDE = 0xE007E
const BLACK_FLAG = '\u{1F3F4}'
const TAG_RUN_DISPLAY_MAX_CHARACTERS = 60

function createHiddenCharacterPattern(flags: string): RegExp {
  return new RegExp(HIDDEN_CHARACTER_CLASS, flags)
}

/**
 * Every character that can hide or reorder text: all of Unicode category
 * Cf (bidi controls, zero-width characters, the BOM, the soft hyphen, the
 * tag block), the invisible fillers, and the variation selectors. Global,
 * so it is for `replace` and `match`; use `hasHiddenCharacter` to test.
 */
export const HIDDEN_CHARACTER_PATTERN = createHiddenCharacterPattern('gu')

const HIDDEN_CHARACTER_TEST_PATTERN = createHiddenCharacterPattern('u')

/**
 * A run of tag-block characters (U+E0000 to U+E007F). Each of U+E0020 to
 * U+E007E is an invisible copy of the ASCII character 0x20 to 0x7E, which is
 * how text is smuggled past a reader.
 */
export const TAG_CHARACTER_RUN_PATTERN = /[\u{E0000}-\u{E007F}]+/gu

const FLAG_TAG_SEQUENCE_PATTERN
  = /^[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,10}\u{E007F}$/u

export function hasHiddenCharacter(text: string): boolean {
  return HIDDEN_CHARACTER_TEST_PATTERN.test(text)
}

export function isTagBlockCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0

  return codePoint >= TAG_BLOCK_START && codePoint <= TAG_BLOCK_END
}

/**
 * The ASCII text hidden in a run of tag characters. The cancel tag
 * (U+E007F) and the tag characters outside U+E0020 to U+E007E carry no text.
 */
export function decodeTagCharacters(text: string): string {
  let decoded = ''

  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0

    if (codePoint >= TAG_SPACE && codePoint <= TAG_TILDE) {
      decoded += String.fromCharCode(codePoint - TAG_BLOCK_START)
    }
  }

  return decoded
}

/**
 * Whether a run of tag characters is the tail of an emoji tag sequence such
 * as the England flag: a black flag directly before it, then tag letters or
 * digits, then the cancel tag. `precedingText` is the text before the run.
 */
export function isEmojiTagSequence(
  precedingText: string,
  run: string,
): boolean {
  return precedingText.endsWith(BLACK_FLAG)
    && FLAG_TAG_SEQUENCE_PATTERN.test(run)
}

export function formatHiddenCharacter(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0

  return `⟨U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}⟩`
}

function formatTagRun(run: string): string {
  const decoded = decodeTagCharacters(run)

  if (decoded === '') {
    return [...run].map(formatHiddenCharacter).join('')
  }

  const shown = decoded.length > TAG_RUN_DISPLAY_MAX_CHARACTERS
    ? `${decoded.slice(0, TAG_RUN_DISPLAY_MAX_CHARACTERS)}...`
    : decoded

  return `⟨hidden text: «${shown}»⟩`
}

/**
 * Makes every hidden character visible as `⟨U+202E⟩`. A run of tag
 * characters that carries text shows that text as `⟨hidden text: «…»⟩`
 * instead of a row of code points; an emoji tag sequence stays as it is.
 */
export function showHiddenCharacters(text: string): string {
  const withTags = text.replace(
    TAG_CHARACTER_RUN_PATTERN,
    (run, offset: number) => {
      return isEmojiTagSequence(text.slice(0, offset), run)
        ? run
        : formatTagRun(run)
    },
  )

  return withTags.replace(HIDDEN_CHARACTER_PATTERN, (character) => {
    return isTagBlockCharacter(character)
      ? character
      : formatHiddenCharacter(character)
  })
}
