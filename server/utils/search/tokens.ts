import { stemUkrainianWord } from '~~/server/utils/search/ukrainian-stemmer'

export const MIN_STEMMABLE_TOKEN_LENGTH = 4
export const MAX_SEARCH_TOKENS = 8

const TOKEN_SPLIT = /[^\p{L}\p{N}ʼ]+/u
const CYRILLIC_LETTER = /\p{Script=Cyrillic}/u
const LETTER_GLOBAL = /\p{L}/gu

/** Splits normalized text into alphanumeric tokens (Unicode-aware). */
export function tokenizeSearchText(value: string): string[] {
  return value.toLowerCase().split(TOKEN_SPLIT).filter(Boolean)
}

/** True when at least half the token's letters are Cyrillic. */
export function isCyrillicToken(token: string): boolean {
  const letters = token.match(LETTER_GLOBAL) || []

  if (!letters.length) {
    return false
  }

  const cyrillicLetters = letters.filter((letter) => {
    return CYRILLIC_LETTER.test(letter)
  })

  return cyrillicLetters.length / letters.length >= 0.5
}

/**
 * Per-token guard chain: skip stemming for non-Cyrillic tokens (English,
 * code identifiers) and for tokens shorter than MIN_STEMMABLE_TOKEN_LENGTH.
 * Otherwise return stemUkrainianWord(token).
 */
export function stemSearchToken(token: string): string {
  if (!isCyrillicToken(token) || token.length < MIN_STEMMABLE_TOKEN_LENGTH) {
    return token
  }

  return stemUkrainianWord(token)
}

/**
 * Space-joined stems for every token in `value`. Used to build body_stem.
 * Guarantees index/query symmetry because both sides call stemSearchToken.
 */
export function buildStemmedSearchText(value: string): string {
  return tokenizeSearchText(value).map(stemSearchToken).join(' ')
}
