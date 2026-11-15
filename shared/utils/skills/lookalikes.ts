const WORD_PATTERN = /[\p{L}\p{M}]{2,60}/gu
const LATIN_PATTERN = /\p{Script=Latin}/u
const CYRILLIC_PATTERN = /\p{Script=Cyrillic}/u
const GREEK_PATTERN = /\p{Script=Greek}/u
const NON_ASCII_PATTERN = /[^\p{ASCII}]/u
const SHORT_GREEK_WORD_LENGTH = 3

/**
 * A subset of the Unicode confusables table (UTS #39): letters from other
 * scripts that look like a Latin letter, mapped to that letter.
 */
const CONFUSABLES: Readonly<Record<string, string>> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ԛ: 'q',
  ԝ: 'w',
  һ: 'h',
  ӏ: 'l',
  ɡ: 'g',
  ı: 'i',
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
  У: 'Y',
  І: 'I',
  Ј: 'J',
  Ѕ: 'S',
  ο: 'o',
  ν: 'v',
  α: 'a',
  ι: 'i',
  κ: 'k',
  ρ: 'p',
  υ: 'u',
  χ: 'x',
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
}

const CONFUSABLE_PATTERN = new RegExp(
  `[${Object.keys(CONFUSABLES).join('')}]`,
  'u',
)

export function hasNonAscii(text: string): boolean {
  return NON_ASCII_PATTERN.test(text)
}

/**
 * The text as a reader who only knows Latin letters would see it: fullwidth
 * and other compatibility forms folded by NFKC, then every confusable letter
 * of another script replaced by the Latin letter it looks like.
 */
export function toConfusableSkeleton(text: string): string {
  let skeleton = ''

  for (const character of text.normalize('NFKC')) {
    skeleton += CONFUSABLES[character] ?? character
  }

  return skeleton
}

/**
 * The first word that mixes Latin letters with Cyrillic or Greek ones, or
 * Cyrillic with Greek. Ukrainian, Polish and Russian text is one script per
 * word, so it never matches. A word of up to three letters that mixes Latin
 * and Greek is read as a unit or a formula, such as "μm", and is left alone.
 */
export function findMixedScriptWord(text: string): string | null {
  if (!NON_ASCII_PATTERN.test(text)) {
    return null
  }

  for (const [word] of text.matchAll(WORD_PATTERN)) {
    const hasLatin = LATIN_PATTERN.test(word)
    const hasCyrillic = CYRILLIC_PATTERN.test(word)
    const hasGreek = GREEK_PATTERN.test(word)

    if (hasCyrillic && (hasLatin || hasGreek)) {
      return word
    }

    if (
      hasLatin
      && hasGreek
      && [...word].length > SHORT_GREEK_WORD_LENGTH
    ) {
      return word
    }
  }

  return null
}

export function findConfusableIndex(text: string): number {
  return text.search(CONFUSABLE_PATTERN)
}
