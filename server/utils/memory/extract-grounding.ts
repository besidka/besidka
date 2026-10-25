import { MEMORY_EXTRACTION_LIMITS } from '~~/server/utils/memory/extract-limits'
import {
  memoryExtractionNormalizeText,
} from '~~/server/utils/memory/extract-input'

export interface MemoryExtractionGroundingText {
  collapsed: string
  lined: string
}

const LINE_BREAK_PATTERN = /[\r\n\u2028\u2029]+/u
const WORD_SEPARATOR_PATTERN = /\s+/u
const CONTENT_TOKEN_PATTERN = /[\p{L}\p{N}]+/gu
const EDGE_ELLIPSIS_PATTERN = /^(?:\.{3,}\s*)+|(?:\s*\.{3,})+$/gu
const LINE_BREAK = '\n'
const SPACE = ' '
const SENTENCE_TERMINATORS: ReadonlySet<string> = new Set([
  '.',
  '!',
  '?',
  '。',
])
const BULLET_MARKERS: ReadonlySet<string> = new Set(['-', '*', '•'])
const OPENING_WRAPPERS: ReadonlySet<string> = new Set(['"', '(', '[', '\''])
const CLOSING_WRAPPERS: ReadonlySet<string> = new Set(['"', ')', ']', '\''])

export function prepareMemoryExtractionGroundingText(
  text: string,
): MemoryExtractionGroundingText {
  const lined = text
    .split(LINE_BREAK_PATTERN)
    .map(memoryExtractionNormalizeText)
    .filter(Boolean)
    .join(LINE_BREAK)

  return {
    lined,
    collapsed: lined.replaceAll(LINE_BREAK, SPACE),
  }
}

export function memoryExtractionEvidenceNeedle(evidence: string): string {
  return memoryExtractionNormalizeText(evidence)
    .replace(EDGE_ELLIPSIS_PATTERN, '')
    .trim()
}

function memoryExtractionContentTokens(text: string): Set<string> {
  const tokens = memoryExtractionNormalizeText(text).match(
    CONTENT_TOKEN_PATTERN,
  ) ?? []

  return new Set(tokens.filter((token) => {
    return token.length >= MEMORY_EXTRACTION_LIMITS.evidenceContentTokenMinChars
  }))
}

function memoryExtractionTokensMatch(left: string, right: string): boolean {
  if (left === right) {
    return true
  }

  const stemLength = MEMORY_EXTRACTION_LIMITS.evidenceStemMinChars

  return left.length >= stemLength
    && right.length >= stemLength
    && left.slice(0, stemLength) === right.slice(0, stemLength)
}

function memoryExtractionSharesContentToken(
  needle: string,
  savedText: string,
): boolean {
  const savedTokens = [...memoryExtractionContentTokens(savedText)]

  for (const token of memoryExtractionContentTokens(needle)) {
    if (savedTokens.some(saved => memoryExtractionTokensMatch(token, saved))) {
      return true
    }
  }

  return false
}

function memoryExtractionStartsSentence(text: string, start: number): boolean {
  let index = start - 1

  while (
    index >= 0
    && (text[index] === SPACE || OPENING_WRAPPERS.has(text[index]!))
  ) {
    index -= 1
  }

  if (index < 0) {
    return true
  }

  const previous = text[index]!

  if (previous === LINE_BREAK) {
    return true
  }

  if (index === start - 1) {
    return false
  }

  if (SENTENCE_TERMINATORS.has(previous)) {
    return true
  }

  return BULLET_MARKERS.has(previous)
    && (index === 0 || text[index - 1] === LINE_BREAK)
}

function memoryExtractionEndsSentence(
  text: string,
  end: number,
  needle: string,
): boolean {
  if (end >= text.length) {
    return true
  }

  const nextCharacter = text[end]!

  if (SENTENCE_TERMINATORS.has(needle.at(-1)!)) {
    return nextCharacter === SPACE
      || nextCharacter === LINE_BREAK
      || CLOSING_WRAPPERS.has(nextCharacter)
  }

  let index = end

  while (index < text.length && text[index] === SPACE) {
    index += 1
  }

  if (index >= text.length || text[index] === LINE_BREAK) {
    return true
  }

  if (!SENTENCE_TERMINATORS.has(text[index]!)) {
    return false
  }

  const afterTerminator = text[index + 1]

  return afterTerminator === undefined
    || afterTerminator === SPACE
    || afterTerminator === LINE_BREAK
    || CLOSING_WRAPPERS.has(afterTerminator)
}

function memoryExtractionHasSentenceAlignedMatch(
  groundingText: MemoryExtractionGroundingText,
  needle: string,
): boolean {
  const { collapsed, lined } = groundingText
  let searchFrom = 0

  while (searchFrom <= collapsed.length) {
    const start = collapsed.indexOf(needle, searchFrom)

    if (start === -1) {
      return false
    }

    const end = start + needle.length

    if (
      memoryExtractionStartsSentence(lined, start)
      && memoryExtractionEndsSentence(lined, end, needle)
    ) {
      return true
    }

    searchFrom = start + 1
  }

  return false
}

/**
 * Decides whether an op's evidence quote is grounded in the user's own words.
 * Both branches need the quote to share a content word with the text that
 * would be saved (`savedText`: the whole entry for a create, only the changed
 * lines, title or description for an update or append), so a generic phrase
 * such as "thanks a lot for your help" can never vouch for an unrelated
 * entry. A word matches exactly or, for words of at least
 * `evidenceStemMinChars`, by a shared prefix of that length, which covers
 * inflected forms. A long quote (enough characters and words) then only has to
 * be a verbatim substring. A short quote is how a one-line fact like "I'm
 * vegetarian" is stated, so it is also accepted, but only when it is a whole
 * sentence of the source text (it starts and ends on a sentence, line or
 * message boundary).
 */
export function isMemoryExtractionEvidenceGrounded(
  evidence: string,
  groundingTexts: MemoryExtractionGroundingText[],
  savedText: string,
): boolean {
  const needle = memoryExtractionEvidenceNeedle(evidence)
  const wordCount = needle.split(WORD_SEPARATOR_PATTERN).filter(Boolean).length
  const isLongQuote = needle.length >= MEMORY_EXTRACTION_LIMITS.evidenceMinChars
    && wordCount >= MEMORY_EXTRACTION_LIMITS.evidenceMinWords

  if (!isLongQuote && needle.length
    < MEMORY_EXTRACTION_LIMITS.evidenceShortMinChars) {
    return false
  }

  if (!memoryExtractionSharesContentToken(needle, savedText)) {
    return false
  }

  if (isLongQuote) {
    return groundingTexts.some(text => text.collapsed.includes(needle))
  }

  return groundingTexts.some((text) => {
    return memoryExtractionHasSentenceAlignedMatch(text, needle)
  })
}
