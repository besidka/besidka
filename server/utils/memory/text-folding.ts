const POLISH_DIACRITIC_FOLDS: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
  Ą: 'A',
  Ć: 'C',
  Ę: 'E',
  Ł: 'L',
  Ń: 'N',
  Ó: 'O',
  Ś: 'S',
  Ź: 'Z',
  Ż: 'Z',
}

const LATIN_TO_CYRILLIC_LOOKALIKES: Record<string, string> = {
  a: 'а',
  b: 'в',
  c: 'с',
  e: 'е',
  h: 'н',
  i: 'і',
  k: 'к',
  m: 'м',
  o: 'о',
  p: 'р',
  t: 'т',
  x: 'х',
  y: 'у',
  ï: 'ї',
}

const POLISH_DIACRITIC_PATTERN = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/gu
const LETTER_RUN_PATTERN = /\p{L}+/gu
const CYRILLIC_LETTER_PATTERN = /\p{Script=Cyrillic}/u
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u
const LATIN_LOOKALIKE_PATTERN = /[abcehikmoptxyï]/gu
const DECIMAL_DIGIT_PATTERN = /^\p{Nd}$/u
const ASCII_DIGIT_ZERO = 48
const DIGITS_PER_BLOCK = 10
const MAX_DIGIT_RUN_LOOKBACK = 100

/**
 * Maps the nine Polish diacritic letters (both cases) to their base Latin
 * letter, so `hasło`, `nadciśnienie` and `ciąża` match rules and detectors
 * whether or not the user typed the diacritics. One code point in, one out,
 * so offsets are preserved. Cyrillic is never touched.
 */
export function foldPolishDiacritics(text: string): string {
  return text.replace(POLISH_DIACRITIC_PATTERN, (letter) => {
    return POLISH_DIACRITIC_FOLDS[letter] ?? letter
  })
}

/**
 * Inside a lowercase word that mixes Cyrillic and Latin letters, maps the
 * Latin look-alikes (`i`, `a`, `o`, …) to their Cyrillic twins, so
 * `дiабет` typed with a Latin `i` reads as `діабет`. Words in a single script
 * are left alone.
 */
export function foldCyrillicLookalikes(text: string): string {
  return text.replace(LETTER_RUN_PATTERN, (word) => {
    if (
      !CYRILLIC_LETTER_PATTERN.test(word)
      || !LATIN_LETTER_PATTERN.test(word)
    ) {
      return word
    }

    return word.replace(LATIN_LOOKALIKE_PATTERN, (letter) => {
      return LATIN_TO_CYRILLIC_LOOKALIKES[letter] ?? letter
    })
  })
}

function isDecimalDigitCodePoint(codePoint: number): boolean {
  return codePoint >= 0
    && DECIMAL_DIGIT_PATTERN.test(String.fromCodePoint(codePoint))
}

/**
 * The ASCII form of one decimal digit from any script (Arabic-Indic,
 * Devanagari, …), which NFKC leaves alone. Unicode encodes every `Nd` digit
 * set as a contiguous run starting at its zero, so the value is the number of
 * `Nd` code points right before it, modulo ten. Returns `null` for anything
 * that is not a non-ASCII decimal digit.
 */
export function toAsciiDigit(character: string): string | null {
  const codePoint = character.codePointAt(0)

  if (
    codePoint === undefined
    || [...character].length !== 1
    || codePoint < 128
    || !isDecimalDigitCodePoint(codePoint)
  ) {
    return null
  }

  let precedingDigits = 0

  while (
    precedingDigits < MAX_DIGIT_RUN_LOOKBACK
    && isDecimalDigitCodePoint(codePoint - precedingDigits - 1)
  ) {
    precedingDigits++
  }

  return String.fromCharCode(
    ASCII_DIGIT_ZERO + (precedingDigits % DIGITS_PER_BLOCK),
  )
}
