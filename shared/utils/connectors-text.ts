const UNSAFE_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{E0000}-\u{E007F}]/gu
const WHITESPACE_RUNS = /\s+/g

/**
 * Cleans text that came from outside the user's own typing, such as a title
 * an app sent or a tool name a remote server announced: control, bidi,
 * format and tag characters are removed, whitespace collapses to one space,
 * and the result is cut to `maxCodePoints` code points, never in the middle
 * of a character.
 */
export function sanitizeConnectorText(
  text: string,
  maxCodePoints: number,
): string {
  const cleaned = text
    .replace(UNSAFE_CHARACTERS, ' ')
    .replace(WHITESPACE_RUNS, ' ')
    .trim()

  return Array.from(cleaned).slice(0, maxCodePoints).join('').trim()
}
