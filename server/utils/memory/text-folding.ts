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

const CYRILLIC_TO_LATIN_LOOKALIKES: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(LATIN_TO_CYRILLIC_LOOKALIKES).map(([latin, cyrillic]) => {
      return [cyrillic, latin]
    }),
  ),
  ј: 'j',
  ѕ: 's',
}

const POLISH_DIACRITIC_PATTERN = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/gu
const POLISH_DIACRITIC_LETTER_PATTERN = /^[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]$/u
const LETTER_RUN_PATTERN = /\p{L}+/gu
const LATIN_LETTERS_PATTERN = /\p{Script=Latin}/gu
const CYRILLIC_LETTERS_PATTERN = /\p{Script=Cyrillic}/gu
const COMBINING_MARKS_PATTERN = /\p{M}/gu
const LATIN_LOOKALIKE_PATTERN = /[abcehikmoptxyï]/gu
const CYRILLIC_LOOKALIKE_PATTERN = /[авсенікмортхуїјѕ]/gu
const SPACED_LETTER_RUN_PATTERN
  = /(?<![\p{L}\p{N}])\p{L}(?:[^\S\r\n]+\p{L}){2,}(?![\p{L}\p{N}])/gu
const HORIZONTAL_SPACE_PATTERN = /[^\S\r\n]+/gu
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

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

/**
 * Inside a lowercase word that mixes Cyrillic and Latin letters, maps the
 * look-alikes of the minority script to the majority script: `дiабет` with a
 * Latin `i` reads as `діабет`, and `hіv` with a Cyrillic `і` reads as `hiv`
 * (a tie goes to Cyrillic). Words in a single script are left alone.
 */
export function foldMixedScriptLookalikes(text: string): string {
  return text.replace(LETTER_RUN_PATTERN, (word) => {
    const latinCount = countMatches(word, LATIN_LETTERS_PATTERN)
    const cyrillicCount = countMatches(word, CYRILLIC_LETTERS_PATTERN)

    if (latinCount === 0 || cyrillicCount === 0) {
      return word
    }

    if (cyrillicCount >= latinCount) {
      return word.replace(LATIN_LOOKALIKE_PATTERN, (letter) => {
        return LATIN_TO_CYRILLIC_LOOKALIKES[letter] ?? letter
      })
    }

    return word.replace(CYRILLIC_LOOKALIKE_PATTERN, (letter) => {
      return CYRILLIC_TO_LATIN_LOOKALIKES[letter] ?? letter
    })
  })
}

/**
 * Removes accents from Latin letters (`diabétes` reads as `diabetes`) by
 * decomposing each one and dropping its combining marks. The Polish
 * diacritic letters are kept, because the classifier matches them in both
 * forms, and Cyrillic letters such as `й` and `ї` are never touched.
 */
export function stripLatinDiacritics(text: string): string {
  return text.replace(LATIN_LETTERS_PATTERN, (letter) => {
    if (POLISH_DIACRITIC_LETTER_PATTERN.test(letter)) {
      return letter
    }

    return letter.normalize('NFD').replace(COMBINING_MARKS_PATTERN, '')
  })
}

/**
 * Joins a run of three or more single letters separated by spaces or tabs
 * into one word, so `d i a b e t e s` reads as `diabetes`. A run needs three
 * letters, so a pair such as `a b` stays apart, and line breaks never join,
 * because entry fields are combined with newlines.
 */
export function collapseSpacedLetters(text: string): string {
  return text.replace(SPACED_LETTER_RUN_PATTERN, (run) => {
    return run.replace(HORIZONTAL_SPACE_PATTERN, '')
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
