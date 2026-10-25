import type {
  ComplianceBlockedCounts,
  MemorySensitiveCategory,
  MemorySensitivity,
  NeverStoreKind,
} from '#shared/types/memory.d'
import {
  REDACTION_PLACEHOLDER,
  neverStoreKindIds,
} from '#shared/utils/memory-policy'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { classifySensitiveCategories } from '~~/server/utils/memory/sensitivity'

type DbClient = ReturnType<typeof useDb>

export interface NeverStoreMatch {
  kind: NeverStoreKind
  start: number
  end: number
}

export interface ComplianceLogger {
  set: (fields: Record<string, unknown>) => void
}

export type MemoryWriteVerdict
  = | {
    allowed: true
    sensitivity: MemorySensitivity
    sensitiveCategory: MemorySensitiveCategory | null
  }
  | { allowed: false, reason: 'never-store', kinds: NeverStoreKind[] }
  | {
    allowed: false
    reason: 'sensitive-disabled'
    detectedCategories: MemorySensitiveCategory[]
  }

export interface MemoryEntryEvaluationInput {
  title: string
  description: string
  body: string
  sensitivity: MemorySensitivity
  sensitiveCategory?: MemorySensitiveCategory | null
  extractorNeverStoreKind?: NeverStoreKind | null
  includeSensitive: boolean
}

const MAX_CARD_DIGITS = 19
const MIN_CARD_DIGITS = 13
const MAX_CARD_GROUPS = 6
const MIN_IBAN_LENGTH = 15
const MAX_IBAN_LENGTH = 34
const IBAN_HEAD_LENGTH = 4
const TAX_KEYWORD_WINDOW = 40
const KEY_CONTEXT_WINDOW = 40
const MIN_CREDENTIAL_VALUE_LENGTH = 6
const POLAND_NRB_DIGITS = 26
const ASCII_LIMIT = 128
const QUOTED_VALUE_GROUPS = [2, 3, 4]
const UNQUOTED_VALUE_GROUP = 5
const SPACE_CODE = 32
const HYPHEN_CODE = 45

const IBAN_COUNTRY_LENGTHS: Record<string, number> = {
  AT: 20,
  BE: 16,
  BG: 22,
  CH: 21,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  EE: 20,
  ES: 24,
  FI: 18,
  FR: 27,
  GB: 22,
  GR: 27,
  HR: 21,
  HU: 28,
  IE: 22,
  IT: 27,
  LT: 20,
  LU: 20,
  LV: 21,
  MT: 31,
  NL: 18,
  NO: 15,
  PL: 28,
  PT: 25,
  RO: 24,
  SE: 24,
  SI: 19,
  SK: 24,
  TR: 26,
  UA: 29,
}

const PESEL_WEIGHTS = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7]
const RNOKPP_WEIGHTS = [-1, 5, 7, 9, 4, 6, 10, 5, 7]
const PESEL_CENTURY_BY_MONTH_BAND = [1900, 2000, 2100, 2200, 1800]

const NON_ASCII_PATTERN = /\P{ASCII}/u
const FORMAT_CHARACTER_PATTERN = /^\p{Cf}$/u
const LINE_SEPARATOR_PATTERN = /^[\u2028\u2029]$/u
const FORMAT_CHARACTERS_PATTERN = /\p{Cf}/gu
const UNICODE_SPACES_PATTERN = /\p{Zs}/gu
const DIGIT_RUN_PATTERN = /(?<![\d+])\d+(?:[\s.\-*]{1,2}\d+)*/gu
const DIGIT_GROUP_PATTERN = /\d+/gu
const IBAN_START_PATTERN = /(?<![A-Za-z0-9])[A-Za-z]{2}\d{2}/gu
const POLAND_NRB_PATTERN
  = /(?<![\d+])\d{2}(?:[ -]{0,2}\d{4}){6}(?!\d)/gu
const PESEL_PATTERN = /(?<![\d+])\d{11}(?!\d)/gu
const SSN_PATTERN = /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/gu
const TAX_NUMBER_PATTERN
  = /(?<![\d+])(?:\d{3}-\d{3}-\d{2}-\d{2}|\d{10})(?!\d)/gu
const TAX_KEYWORD_PATTERN = new RegExp(
  [
    '(?<![\\p{L}])(?:',
    'NIP|TIN|VAT|ІПН|РНОКПП|ІНН|ИНН|ИПН',
    '|tax\\s+id(?:entification)?(?:\\s+number)?',
    '|податков(?:ий|ого)\\s+номер(?:а|у)?',
    '|ідентифікаційн(?:ий|ого)\\s+(?:код|номер)(?:у|а)?',
    '|numer\\s+identyfikacji\\s+podatkowej',
    ')(?![\\p{L}])',
  ].join(''),
  'iu',
)
const PASSPORT_GAP = '[ \\t:.,;#\\-–—]{0,4}'
const PASSPORT_FILLER_WORD = [
  '(?:no|number|nr|series|серії|серія|серіі|номер',
  '|is|was|є|це|jest)(?![\\p{L}\\d])',
].join('')
const PASSPORT_SERIES_TOKEN = '[A-Za-z\\u0400-\\u04FF]{1,2}(?![\\p{L}\\d])'
const PASSPORT_PATTERN = new RegExp(
  [
    '(?<![\\p{L}])(?:passport|паспорт|paszport|pasport)',
    `(?:${PASSPORT_GAP}(?:${PASSPORT_FILLER_WORD}|${PASSPORT_SERIES_TOKEN})){0,4}?`,
    PASSPORT_GAP,
    '((?<![\\p{L}])[A-Za-z\\u0400-\\u04FF]{1,2} ?)?',
    '(\\d{6,9})(?!\\d)',
  ].join(''),
  'giu',
)
const API_KEY_PATTERN = new RegExp(
  [
    '(?<![A-Za-z0-9])(?:',
    'sk-[A-Za-z0-9_-]{20,}',
    '|AIza[A-Za-z0-9_-]{35}',
    '|AQ\\.[A-Za-z0-9_-]{30,}',
    '|gh[pousr]_[A-Za-z0-9]{30,}',
    '|github_pat_[A-Za-z0-9_]{40,}',
    '|xox[abprs]-[A-Za-z0-9-]{10,}',
    '|(?:AKIA|ASIA)[A-Z0-9]{16}',
    '|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}',
    '|xai-[A-Za-z0-9]{30,}',
    '|gsk_[A-Za-z0-9]{30,}',
    '|hf_[A-Za-z0-9]{30,}',
    '|npm_[A-Za-z0-9]{36}',
    '|glpat-[A-Za-z0-9_-]{20,}',
    '|vck_[A-Za-z0-9]{20,}',
    '|BSA[A-Za-z0-9_-]{20,}',
    '|SG\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}',
    '|[Bb]earer\\s+[A-Za-z0-9._~+/=-]{20,}',
    ')',
  ].join(''),
  'gu',
)
const KEY_CONTEXT_PATTERN = new RegExp(
  [
    '(?<![\\p{L}])(?:',
    'exa|cloudflare|brave|vercel|openrouter',
    '|api[ _-]?keys?|tokens?|secrets?',
    '|секрет\\p{L}{0,4}|ключ\\p{L}{0,4}|токен\\p{L}{0,4}',
    ')(?![\\p{L}])',
  ].join(''),
  'iu',
)
const UUID_PATTERN = new RegExp(
  [
    '(?<![A-Za-z0-9-])',
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    '(?![A-Za-z0-9-])',
  ].join(''),
  'giu',
)
const LONG_TOKEN_PATTERN
  = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,64}(?![A-Za-z0-9_-])/gu
const JWT_PATTERN
  = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/gu
const STRONG_CREDENTIAL_LABELS = [
  '(?:password|passwd|pwd|passphrase)s?',
  'пароль',
  'парольна фраза',
  'hasło',
  'haslo',
].join('|')
const WEAK_CREDENTIAL_LABELS = [
  '(?:api[ _-]?key|apikey|secret|token)s?',
  'токен',
  'ключ',
].join('|')
const CREDENTIAL_VALUE = [
  '(?:"([^"\\n]+)"',
  '|\'([^\'\\n]+)\'',
  '|`([^`\\n]+)`',
  '|["\'`]?([^\\s"\'`]+))',
].join('')
const CREDENTIAL_SENTENCE_VERBS = 'is|є|це|jest|это|was'
const STRONG_CREDENTIAL_ASSIGNMENT_PATTERN = new RegExp(
  `((?:${STRONG_CREDENTIAL_LABELS})["'\`]?\\s*[:=]\\s*)${CREDENTIAL_VALUE}`,
  'dgiu',
)
const WEAK_CREDENTIAL_ASSIGNMENT_PATTERN = new RegExp(
  `((?:${WEAK_CREDENTIAL_LABELS})["'\`]?\\s*[:=]\\s*)${CREDENTIAL_VALUE}`,
  'dgiu',
)
const CREDENTIAL_SENTENCE_PATTERN = new RegExp(
  '(?<![\\p{L}\\d])((?:'
  + `${STRONG_CREDENTIAL_LABELS}|${WEAK_CREDENTIAL_LABELS})`
  + `\\s+(?:${CREDENTIAL_SENTENCE_VERBS})\\s+)${CREDENTIAL_VALUE}`,
  'dgiu',
)
const STRONG_CREDENTIAL_DASH_PATTERN = new RegExp(
  `(?<![\\p{L}\\d])((?:${STRONG_CREDENTIAL_LABELS})\\s+[-–—]\\s+)`
  + CREDENTIAL_VALUE,
  'dgiu',
)
const URL_USERINFO_PATTERN
  = /(?<=[A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+(?=@)/gu
const PRIVATE_KEY_PATTERN
  = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gu
const TRAILING_PUNCTUATION_PATTERN = /[.,;:!?)\]}>]+$/u
const DIGIT_OR_SYMBOL_PATTERN = /\p{N}|[^\p{L}\p{N}\s_]/u
const DIGIT_PATTERN = /\d/u
const ASCII_LETTER_PATTERN = /[A-Za-z]/u

interface NormalizedView {
  text: string
  starts: number[] | null
  ends: number[] | null
}

function matchStart(match: RegExpMatchArray): number {
  return match.index ?? 0
}

function digitsOnly(text: string): string {
  return text.replace(/\D/gu, '')
}

function isLuhnValid(digits: string): boolean {
  let sum = 0
  let isDoubled = false

  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index])

    if (isDoubled) {
      digit *= 2

      if (digit > 9) {
        digit -= 9
      }
    }

    sum += digit
    isDoubled = !isDoubled
  }

  return sum % 10 === 0
}

function isRepeatedDigit(digits: string): boolean {
  return new Set(digits).size === 1
}

function alphanumericValue(code: number): number {
  if (code <= 57) {
    return code - 48
  }

  return (code | 32) - 87
}

function isAlphanumericCode(code: number): boolean {
  return (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
}

function isAlphanumericAt(text: string, position: number): boolean {
  return position < text.length
    && isAlphanumericCode(text.charCodeAt(position))
}

function stepMod97(remainder: number, code: number): number {
  const value = alphanumericValue(code)
  const shift = value >= 10 ? 100 : 10

  return (remainder * shift + value) % 97
}

function extendMod97(
  remainder: number,
  text: string,
  from: number,
  to: number,
): number {
  let result = remainder

  for (let position = from; position < to; position++) {
    result = stepMod97(result, text.charCodeAt(position))
  }

  return result
}

function isIbanChecksumValid(compactIban: string): boolean {
  const rearranged = compactIban.slice(4) + compactIban.slice(0, 4)

  return extendMod97(0, rearranged, 0, rearranged.length) === 1
}

function weightedSum(digits: string, weights: number[]): number {
  let sum = 0

  weights.forEach((weight, index) => {
    sum += weight * Number(digits[index])
  })

  return sum
}

function isPeselValid(digits: string): boolean {
  const checksum = weightedSum(digits, PESEL_WEIGHTS)
  const expectedCheckDigit = (10 - (checksum % 10)) % 10

  if (expectedCheckDigit !== Number(digits[10])) {
    return false
  }

  const encodedMonth = Number(digits.slice(2, 4))
  const month = encodedMonth % 20
  const century = PESEL_CENTURY_BY_MONTH_BAND[Math.floor(encodedMonth / 20)]
  const day = Number(digits.slice(4, 6))

  if (century === undefined || month < 1 || month > 12 || day < 1) {
    return false
  }

  const year = century + Number(digits.slice(0, 2))
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()

  return day <= daysInMonth
}

function isSsnValid(ssn: string): boolean {
  const [area, group, serial] = ssn.split('-')

  if (area === '000' || area === '666' || area!.startsWith('9')) {
    return false
  }

  return group !== '00' && serial !== '0000'
}

function isNipValid(digits: string): boolean {
  const remainder = weightedSum(digits, NIP_WEIGHTS) % 11

  return remainder !== 10 && remainder === Number(digits[9])
}

function isRnokppValid(digits: string): boolean {
  const remainder = ((weightedSum(digits, RNOKPP_WEIGHTS) % 11) + 11) % 11

  return remainder % 10 === Number(digits[9])
}

function detectPaymentCards(text: string): NeverStoreMatch[] {
  const matches: NeverStoreMatch[] = []

  for (const run of text.matchAll(DIGIT_RUN_PATTERN)) {
    const runStart = matchStart(run)
    const groups = [...run[0].matchAll(DIGIT_GROUP_PATTERN)].map((group) => {
      return {
        start: runStart + matchStart(group),
        digits: group[0],
      }
    })
    let startIndex = 0

    while (startIndex < groups.length) {
      const candidateEnds: number[] = []
      let accumulatedDigits = ''

      for (
        let endIndex = startIndex;
        endIndex < groups.length
        && endIndex - startIndex < MAX_CARD_GROUPS;
        endIndex++
      ) {
        accumulatedDigits += groups[endIndex]!.digits

        if (accumulatedDigits.length > MAX_CARD_DIGITS) {
          break
        }

        if (accumulatedDigits.length >= MIN_CARD_DIGITS) {
          candidateEnds.push(endIndex)
        }
      }

      let matchedEndIndex = -1

      for (const endIndex of candidateEnds.toReversed()) {
        const digits = groups
          .slice(startIndex, endIndex + 1)
          .map(group => group.digits)
          .join('')

        if (
          /^[2-6]/u.test(digits)
          && !isRepeatedDigit(digits)
          && isLuhnValid(digits)
        ) {
          matchedEndIndex = endIndex
          break
        }
      }

      if (matchedEndIndex === -1) {
        startIndex++
        continue
      }

      const lastGroup = groups[matchedEndIndex]!

      matches.push({
        kind: 'payment-card',
        start: groups[startIndex]!.start,
        end: lastGroup.start + lastGroup.digits.length,
      })
      startIndex = matchedEndIndex + 1
    }
  }

  return matches
}

function skipIbanSeparator(text: string, position: number): number {
  let separatorEnd = position

  while (separatorEnd - position < 2 && separatorEnd < text.length) {
    const code = text.charCodeAt(separatorEnd)

    if (code !== SPACE_CODE && code !== HYPHEN_CODE) {
      break
    }

    separatorEnd++
  }

  if (separatorEnd === position || !isAlphanumericAt(text, separatorEnd)) {
    return -1
  }

  return separatorEnd
}

function findIbanEnd(text: string, start: number): number {
  const countryCode = text.slice(start, start + 2).toUpperCase()
  const knownLength = IBAN_COUNTRY_LENGTHS[countryCode]
  const minLength = knownLength ?? MIN_IBAN_LENGTH
  const maxLength = knownLength ?? MAX_IBAN_LENGTH
  let position = start
  let compactLength = 0
  let remainder = 0

  while (compactLength < maxLength && position < text.length) {
    const code = text.charCodeAt(position)

    if (!isAlphanumericCode(code)) {
      position = skipIbanSeparator(text, position)

      if (position === -1) {
        return -1
      }

      continue
    }

    if (compactLength >= IBAN_HEAD_LENGTH) {
      remainder = stepMod97(remainder, code)
    }

    compactLength++
    position++

    if (compactLength < minLength || isAlphanumericAt(text, position)) {
      continue
    }

    const headEnd = start + IBAN_HEAD_LENGTH

    if (extendMod97(remainder, text, start, headEnd) === 1) {
      return position
    }
  }

  return -1
}

function detectIbans(text: string): NeverStoreMatch[] {
  const matches: NeverStoreMatch[] = []

  for (const startMatch of text.matchAll(IBAN_START_PATTERN)) {
    const start = matchStart(startMatch)
    const end = findIbanEnd(text, start)

    if (end !== -1) {
      matches.push({ kind: 'iban', start, end })
    }
  }

  for (const nrb of text.matchAll(POLAND_NRB_PATTERN)) {
    const compact = `PL${digitsOnly(nrb[0])}`

    if (
      compact.length === POLAND_NRB_DIGITS + 2
      && isIbanChecksumValid(compact)
    ) {
      matches.push({
        kind: 'iban',
        start: matchStart(nrb),
        end: matchStart(nrb) + nrb[0].length,
      })
    }
  }

  return matches
}

function detectNationalIds(text: string): NeverStoreMatch[] {
  const matches: NeverStoreMatch[] = []

  for (const pesel of text.matchAll(PESEL_PATTERN)) {
    if (isPeselValid(pesel[0])) {
      matches.push({
        kind: 'national-id',
        start: matchStart(pesel),
        end: matchStart(pesel) + pesel[0].length,
      })
    }
  }

  for (const ssn of text.matchAll(SSN_PATTERN)) {
    if (isSsnValid(ssn[0])) {
      matches.push({
        kind: 'national-id',
        start: matchStart(ssn),
        end: matchStart(ssn) + ssn[0].length,
      })
    }
  }

  return matches
}

function detectTaxIds(text: string): NeverStoreMatch[] {
  const matches: NeverStoreMatch[] = []

  for (const candidate of text.matchAll(TAX_NUMBER_PATTERN)) {
    const start = matchStart(candidate)
    const precedingWindow = text.slice(
      Math.max(0, start - TAX_KEYWORD_WINDOW),
      start,
    )

    if (!TAX_KEYWORD_PATTERN.test(precedingWindow)) {
      continue
    }

    const digits = digitsOnly(candidate[0])
    const isHyphenated = candidate[0].includes('-')
    const isValid = isNipValid(digits)
      || (!isHyphenated && isRnokppValid(digits))

    if (isValid) {
      matches.push({
        kind: 'tax-id',
        start,
        end: start + candidate[0].length,
      })
    }
  }

  return matches
}

function detectPassports(text: string): NeverStoreMatch[] {
  const matches: NeverStoreMatch[] = []

  for (const passport of text.matchAll(PASSPORT_PATTERN)) {
    const identifierLength = (passport[1] ?? '').length + passport[2]!.length
    const end = matchStart(passport) + passport[0].length

    matches.push({
      kind: 'passport',
      start: end - identifierLength,
      end,
    })
  }

  return matches
}

function detectPatternMatches(
  text: string,
  pattern: RegExp,
  kind: NeverStoreKind,
): NeverStoreMatch[] {
  return [...text.matchAll(pattern)].map((match) => {
    return {
      kind,
      start: matchStart(match),
      end: matchStart(match) + match[0].length,
    }
  })
}

function acceptCredentialValue(
  rawValue: string,
  isQuoted: boolean,
  requiresDigitOrSymbol: boolean,
): number {
  const value = isQuoted
    ? rawValue
    : rawValue.replace(TRAILING_PUNCTUATION_PATTERN, '')

  if (value.length < MIN_CREDENTIAL_VALUE_LENGTH) {
    return 0
  }

  if (requiresDigitOrSymbol && !DIGIT_OR_SYMBOL_PATTERN.test(value)) {
    return 0
  }

  return value.length
}

function collectCredentialValues(
  text: string,
  pattern: RegExp,
  requiresDigitOrSymbol: boolean,
): NeverStoreMatch[] {
  const matches: NeverStoreMatch[] = []

  for (const found of text.matchAll(pattern)) {
    const valueGroup = [...QUOTED_VALUE_GROUPS, UNQUOTED_VALUE_GROUP].find(
      (group) => {
        return found[group] !== undefined
      },
    )

    if (valueGroup === undefined) {
      continue
    }

    const valueLength = acceptCredentialValue(
      found[valueGroup]!,
      QUOTED_VALUE_GROUPS.includes(valueGroup),
      requiresDigitOrSymbol,
    )

    if (valueLength > 0) {
      const start = found.indices![valueGroup]![0]

      matches.push({ kind: 'credential', start, end: start + valueLength })
    }
  }

  return matches
}

function detectCredentials(text: string): NeverStoreMatch[] {
  return [
    ...collectCredentialValues(
      text,
      STRONG_CREDENTIAL_ASSIGNMENT_PATTERN,
      false,
    ),
    ...collectCredentialValues(
      text,
      WEAK_CREDENTIAL_ASSIGNMENT_PATTERN,
      true,
    ),
    ...collectCredentialValues(text, CREDENTIAL_SENTENCE_PATTERN, true),
    ...collectCredentialValues(text, STRONG_CREDENTIAL_DASH_PATTERN, true),
    ...detectPatternMatches(text, URL_USERINFO_PATTERN, 'credential'),
  ]
}

function hasKeyContextBefore(text: string, start: number): boolean {
  const precedingWindow = text.slice(
    Math.max(0, start - KEY_CONTEXT_WINDOW),
    start,
  )

  return KEY_CONTEXT_PATTERN.test(precedingWindow)
}

function detectKeywordGatedKeys(text: string): NeverStoreMatch[] {
  const candidates = [
    ...text.matchAll(UUID_PATTERN),
    ...[...text.matchAll(LONG_TOKEN_PATTERN)].filter((token) => {
      return DIGIT_PATTERN.test(token[0])
        && ASCII_LETTER_PATTERN.test(token[0])
    }),
  ]

  return candidates
    .filter(candidate => hasKeyContextBefore(text, matchStart(candidate)))
    .map((candidate) => {
      return {
        kind: 'api-key' as const,
        start: matchStart(candidate),
        end: matchStart(candidate) + candidate[0].length,
      }
    })
}

function mergeMatches(matches: NeverStoreMatch[]): NeverStoreMatch[] {
  const sorted = matches.toSorted((first, second) => {
    if (first.start !== second.start) {
      return first.start - second.start
    }

    return (second.end - second.start) - (first.end - first.start)
  })
  const merged: NeverStoreMatch[] = []

  for (const match of sorted) {
    const previous = merged.at(-1)

    if (!previous || match.start >= previous.end) {
      merged.push({ ...match })
      continue
    }

    const previousLength = previous.end - previous.start
    const matchLength = match.end - match.start

    if (matchLength > previousLength) {
      previous.kind = match.kind
    }

    previous.end = Math.max(previous.end, match.end)
  }

  return merged
}

function normalizeSourceCharacter(character: string): string {
  if (FORMAT_CHARACTER_PATTERN.test(character)) {
    return ''
  }

  if (LINE_SEPARATOR_PATTERN.test(character)) {
    return '\n'
  }

  return character
    .normalize('NFKC')
    .replace(FORMAT_CHARACTERS_PATTERN, '')
    .replace(UNICODE_SPACES_PATTERN, ' ')
}

function buildNormalizedView(text: string): NormalizedView {
  if (!NON_ASCII_PATTERN.test(text)) {
    return { text, starts: null, ends: null }
  }

  const units: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  let sourceOffset = 0

  for (const character of text) {
    const sourceStart = sourceOffset
    const sourceEnd = sourceStart + character.length
    const normalized = character.charCodeAt(0) < ASCII_LIMIT
      ? character
      : normalizeSourceCharacter(character)

    sourceOffset = sourceEnd

    for (let unitIndex = 0; unitIndex < normalized.length; unitIndex++) {
      units.push(normalized[unitIndex]!)
      starts.push(sourceStart)
      ends.push(sourceEnd)
    }
  }

  return { text: units.join(''), starts, ends }
}

function mapMatchToSource(
  match: NeverStoreMatch,
  view: NormalizedView,
): NeverStoreMatch {
  if (!view.starts || !view.ends) {
    return match
  }

  return {
    kind: match.kind,
    start: view.starts[match.start]!,
    end: view.ends[match.end - 1]!,
  }
}

/**
 * Deterministic never-store detection (regex plus checksums) over a
 * normalized detection view (NFKC, no format characters, plain spaces);
 * spans are mapped back to offsets in the original text. Topical classes
 * such as criminal history or home address are not detectable here and rely
 * on the extractor label.
 */
export function detectNeverStore(text: string): NeverStoreMatch[] {
  const view = buildNormalizedView(text)
  const normalizedMatches = [
    ...detectPatternMatches(view.text, PRIVATE_KEY_PATTERN, 'private-key'),
    ...detectPatternMatches(view.text, JWT_PATTERN, 'jwt'),
    ...detectPatternMatches(view.text, API_KEY_PATTERN, 'api-key'),
    ...detectKeywordGatedKeys(view.text),
    ...detectPaymentCards(view.text),
    ...detectIbans(view.text),
    ...detectNationalIds(view.text),
    ...detectTaxIds(view.text),
    ...detectPassports(view.text),
    ...detectCredentials(view.text),
  ]

  return mergeMatches(
    normalizedMatches.map(match => mapMatchToSource(match, view)),
  )
}

export function redactNeverStore(text: string): {
  text: string
  blocked: ComplianceBlockedCounts
  blockedTotal: number
} {
  const matches = detectNeverStore(text)
  const blocked: ComplianceBlockedCounts = {}
  let redacted = ''
  let cursor = 0

  for (const match of matches) {
    redacted += text.slice(cursor, match.start) + REDACTION_PLACEHOLDER
    cursor = match.end
    blocked[match.kind] = (blocked[match.kind] ?? 0) + 1
  }

  redacted += text.slice(cursor)

  return { text: redacted, blocked, blockedTotal: matches.length }
}

export function recordBlockedCounts(
  blocked: ComplianceBlockedCounts,
  logger: ComplianceLogger,
  origin: string,
): void {
  const blockedTotal = Object.values(blocked).reduce((sum, count) => {
    return sum + (count ?? 0)
  }, 0)

  if (blockedTotal === 0) {
    return
  }

  logger.set({
    attributes: {
      memoryCompliance: { origin, blocked, blockedTotal },
    },
  })
}

export function combineMemoryEntryText(fields: {
  title: string
  description: string
  body: string
}): string {
  return [fields.title, fields.description, fields.body].join('\n')
}

export function recordSensitiveDetection(
  categories: MemorySensitiveCategory[],
  logger: ComplianceLogger,
  origin: string,
): void {
  if (categories.length === 0) {
    return
  }

  logger.set({
    attributes: {
      memoryCompliance: { sensitive: { origin, categories } },
    },
  })
}

/**
 * Decides whether an entry may be stored and with which sensitivity. The
 * never-store check wins over everything. Special-category text is detected
 * by the server classifier and never trusted to the caller's label: a
 * declared `special` is never downgraded, and a classifier hit upgrades a
 * declared `none` to `special` with the first detected category unless one
 * was declared. The returned sensitivity and category are the effective
 * values that must be persisted.
 */
export function evaluateMemoryEntry(
  input: MemoryEntryEvaluationInput,
): MemoryWriteVerdict {
  const detectedKinds = new Set<NeverStoreKind>()

  const combinedText = combineMemoryEntryText(input)

  for (const match of detectNeverStore(combinedText)) {
    detectedKinds.add(match.kind)
  }

  if (input.extractorNeverStoreKind) {
    detectedKinds.add(input.extractorNeverStoreKind)
  }

  if (detectedKinds.size > 0) {
    const kinds = neverStoreKindIds.filter(kind => detectedKinds.has(kind))

    return { allowed: false, reason: 'never-store', kinds }
  }

  const detectedCategories = classifySensitiveCategories(combinedText)
  const isSpecial = input.sensitivity === 'special'
    || detectedCategories.length > 0

  if (!isSpecial) {
    return { allowed: true, sensitivity: 'none', sensitiveCategory: null }
  }

  if (!input.includeSensitive) {
    return { allowed: false, reason: 'sensitive-disabled', detectedCategories }
  }

  return {
    allowed: true,
    sensitivity: 'special',
    sensitiveCategory: input.sensitiveCategory
      ?? detectedCategories[0]
      ?? null,
  }
}

export function buildSensitiveMemoryPurge(
  userId: number,
  db: DbClient = useDb(),
) {
  return db
    .delete(schema.memoryEntries)
    .where(and(
      eq(schema.memoryEntries.userId, userId),
      eq(schema.memoryEntries.sensitivity, 'special'),
    ))
    .returning({ id: schema.memoryEntries.id })
}

export async function purgeSensitiveMemoryEntries(
  userId: number,
  db: DbClient = useDb(),
): Promise<number> {
  const deletedRows = await buildSensitiveMemoryPurge(userId, db)

  return deletedRows.length
}
