export const MEMORY_CHARS_PER_TOKEN = {
  latin: 4,
  cyrillic: 2.5,
  other: 1.5,
} as const

const LATIN_MAX_CODE_POINT = 0x24F
const LATIN_EXTENDED_ADDITIONAL_MIN = 0x1E00
const LATIN_EXTENDED_ADDITIONAL_MAX = 0x1EFF
const CYRILLIC_MIN = 0x400
const CYRILLIC_MAX = 0x52F
const CYRILLIC_EXTENDED_C_MIN = 0x1C80
const CYRILLIC_EXTENDED_C_MAX = 0x1C8F
const CYRILLIC_EXTENDED_B_MIN = 0xA640
const CYRILLIC_EXTENDED_B_MAX = 0xA69F
const ROUNDING_EPSILON = 1e-9

function isLatinCodePoint(codePoint: number): boolean {
  return codePoint <= LATIN_MAX_CODE_POINT
    || (
      codePoint >= LATIN_EXTENDED_ADDITIONAL_MIN
      && codePoint <= LATIN_EXTENDED_ADDITIONAL_MAX
    )
}

function isCyrillicCodePoint(codePoint: number): boolean {
  return (codePoint >= CYRILLIC_MIN && codePoint <= CYRILLIC_MAX)
    || (
      codePoint >= CYRILLIC_EXTENDED_C_MIN
      && codePoint <= CYRILLIC_EXTENDED_C_MAX
    )
    || (
      codePoint >= CYRILLIC_EXTENDED_B_MIN
      && codePoint <= CYRILLIC_EXTENDED_B_MAX
    )
}

/**
 * Offline token estimate for text injected into a prompt: the characters of
 * each class are divided by that class's characters-per-token figure, the
 * three quotients are summed and rounded up. Latin counts 1/4 token per
 * character, Cyrillic 1/2.5 (the same figure `READ_CHAT_MAX_CHARS` is sized
 * with), everything else (CJK, emoji, typographic punctuation) 1/1.5. Counts
 * Unicode code points, so a surrogate pair is one character.
 */
export function estimateMemoryTokens(text: string): number {
  let latinCount = 0
  let cyrillicCount = 0
  let otherCount = 0

  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0

    if (isLatinCodePoint(codePoint)) {
      latinCount += 1
    } else if (isCyrillicCodePoint(codePoint)) {
      cyrillicCount += 1
    } else {
      otherCount += 1
    }
  }

  const tokens = latinCount / MEMORY_CHARS_PER_TOKEN.latin
    + cyrillicCount / MEMORY_CHARS_PER_TOKEN.cyrillic
    + otherCount / MEMORY_CHARS_PER_TOKEN.other

  return Math.max(0, Math.ceil(tokens - ROUNDING_EPSILON))
}
