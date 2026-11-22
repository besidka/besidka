export const MAIL_ADDRESS_MAX_LENGTH = 254
export const MAIL_ADDRESS_LOCAL_PART_MAX_LENGTH = 64
export const MAIL_DISPLAY_NAME_MAX_LENGTH = 100

const LOCAL_PART_PATTERN
  = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
const DOMAIN_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/
const LETTER_PATTERN = /[A-Za-z]/
const CONTROL_PATTERN = /^\p{Cc}$/u
const FORMAT_PATTERN = /^\p{Cf}$/u
const SURROGATE_PATTERN = /^\p{Cs}$/u
const SEPARATOR_PATTERN = /^[\p{Zl}\p{Zp}]$/u
const ENCODED_WORD_MARKERS = ['=?', '?='] as const
const ZERO_WIDTH_NON_JOINER = 0x200C
const ZERO_WIDTH_JOINER = 0x200D
const TAB = 0x09
const LINE_FEED = 0x0A
const CARRIAGE_RETURN = 0x0D
const BLANK_LETTERS: ReadonlySet<number> = new Set([
  0x115F,
  0x1160,
  0x2800,
  0x3164,
  0xFFA0,
])

/**
 * A plain ASCII address, `local@domain`, and nothing else: no display name,
 * no quoted local part, no comment, no address literal, no internationalized
 * form, no `=?` or `?=` (which would look like an encoded word in a mail
 * client), and no whitespace of any kind (a trailing newline is a refusal,
 * not something to trim). Returns the address as given, or null.
 */
export function parseMailAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAIL_ADDRESS_MAX_LENGTH) {
    return null
  }

  if (ENCODED_WORD_MARKERS.some(marker => value.includes(marker))) {
    return null
  }

  const parts = value.split('@')

  if (parts.length !== 2) {
    return null
  }

  const [localPart, domain] = parts as [string, string]

  if (
    localPart.length === 0
    || localPart.length > MAIL_ADDRESS_LOCAL_PART_MAX_LENGTH
    || !LOCAL_PART_PATTERN.test(localPart)
  ) {
    return null
  }

  const labels = domain.split('.')
  const topLevelLabel = labels.at(-1) ?? ''
  const isDomainValid = labels.length >= 2
    && labels.every(label => DOMAIN_LABEL_PATTERN.test(label))
    && LETTER_PATTERN.test(topLevelLabel)

  return isDomainValid ? value : null
}

function hasLoneCarriageReturn(value: string): boolean {
  return /\r(?!\n)/.test(value)
}

function hasUnsafeCharacter(value: string, allowLineBreaks: boolean): boolean {
  if (allowLineBreaks && hasLoneCarriageReturn(value)) {
    return true
  }

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0

    const isSeparatorOrSurrogate = SEPARATOR_PATTERN.test(character)
      || SURROGATE_PATTERN.test(character)

    if (isSeparatorOrSurrogate) {
      return true
    }

    if (!allowLineBreaks && BLANK_LETTERS.has(code)) {
      return true
    }

    if (CONTROL_PATTERN.test(character)) {
      const isAllowed = allowLineBreaks
        && (code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN)

      if (!isAllowed) {
        return true
      }

      continue
    }

    if (
      FORMAT_PATTERN.test(character)
      && code !== ZERO_WIDTH_NON_JOINER
      && code !== ZERO_WIDTH_JOINER
    ) {
      return true
    }
  }

  return false
}

/**
 * Whether a header value (a subject or a display name) holds a character
 * that must never reach a header or an approval card: a control character
 * (CR, LF, tab and NUL included), a line or paragraph separator, a lone
 * surrogate, a letter that renders blank (Hangul fillers, the blank Braille
 * pattern), or an invisible format character other than the two joiners
 * emoji need. The bidi controls are format characters, so they are refused
 * too.
 */
export function hasUnsafeHeaderCharacter(value: string): boolean {
  return hasUnsafeCharacter(value, false)
}

/**
 * Whether message text holds a character that is refused in a body: the
 * same set as a header, except that tab and line breaks are allowed and
 * blank letters are text. A CR that is not followed by LF is refused: the
 * card shows it as a space while the message turns it into a line break.
 * The invisible and bidi characters and lone surrogates are refused because
 * they could make the text shown for approval differ from the text that is
 * stored.
 */
export function hasUnsafeBodyCharacter(value: string): boolean {
  return hasUnsafeCharacter(value, true)
}
