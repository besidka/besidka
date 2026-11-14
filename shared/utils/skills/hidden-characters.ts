const HIDDEN_CHARACTER_CLASS
  = '[\\p{Cf}\\u{E0000}-\\u{E007F}\\u2060-\\u2064\\u061C\\u00AD\\u180E\\u3164'
    + '\\uFE00-\\uFE0F\\u{E0100}-\\u{E01EF}]'

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

export function hasHiddenCharacter(text: string): boolean {
  return HIDDEN_CHARACTER_TEST_PATTERN.test(text)
}

export function formatHiddenCharacter(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0

  return `⟨U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}⟩`
}

/**
 * Makes every hidden character visible as `⟨U+202E⟩`.
 */
export function showHiddenCharacters(text: string): string {
  return text.replace(HIDDEN_CHARACTER_PATTERN, formatHiddenCharacter)
}
