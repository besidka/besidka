import type { MemorySensitiveCategory } from '#shared/types/memory.d'
import {
  sensitiveTextRuleTable,
  sensitiveWordEnd,
  sensitiveWordStart,
} from '~~/server/utils/memory/sensitivity-rules'
import {
  collapseSpacedLetters,
  foldMixedScriptLookalikes,
  foldPolishDiacritics,
  stripLatinDiacritics,
} from '~~/server/utils/memory/text-folding'

interface CompiledSensitiveTextRule {
  category: MemorySensitiveCategory
  expression: RegExp
}

const SPACE_PLACEHOLDER = ' '
const SPACE_EXPRESSION = String.raw`\s+`

export const sensitiveTextRules = sensitiveTextRuleTable

const FORMAT_CHARACTERS_PATTERN = /\p{Cf}/gu
const NONSPACING_MARKS_PATTERN = /\p{Mn}/gu

interface FoldedSensitiveTextRule extends CompiledSensitiveTextRule {
  foldedExpression: RegExp
}

/**
 * Turns pattern sources into one Unicode-aware expression: every space in a
 * source becomes `\s+` and the alternation is wrapped in letter-or-digit
 * boundaries, because `\b` does not work for Cyrillic or Polish.
 */
export function compileSensitiveTextExpression(
  sources: readonly string[],
): RegExp {
  const alternatives = sources
    .map((source) => {
      return source.replaceAll(SPACE_PLACEHOLDER, SPACE_EXPRESSION)
    })
    .join('|')

  return new RegExp(
    `${sensitiveWordStart}(?:${alternatives})${sensitiveWordEnd}`,
    'u',
  )
}

/**
 * The form every rule source is written against: `normalizeSensitiveTextCase`
 * (NFKC, hidden characters removed, Latin accents stripped), lowercased,
 * apostrophe variants straightened, `ё` folded to `е`, spaced-out single
 * letters joined into a word, and look-alike letters inside a mixed Latin and
 * Cyrillic word mapped to the word's main script.
 */
export function normalizeSensitiveText(text: string): string {
  const lowercased = normalizeSensitiveTextCase(text)
    .toLowerCase()
    .replace(NONSPACING_MARKS_PATTERN, '')
    .replace(/[ʼ’‘`´]/g, '\'')
    .replace(/ё/g, 'е')

  return foldMixedScriptLookalikes(collapseSpacedLetters(lowercased))
}

/**
 * The case-preserving part of `normalizeSensitiveText`: NFKC, hidden
 * characters removed, accents stripped from Latin letters (Polish diacritics
 * kept) and stray combining marks dropped. Rules that need capitalisation,
 * such as a capitalised street name, match against it.
 */
export function normalizeSensitiveTextCase(text: string): string {
  return stripLatinDiacritics(
    text
      .normalize('NFKC')
      .replace(FORMAT_CHARACTERS_PATTERN, ''),
  ).replace(NONSPACING_MARKS_PATTERN, '')
}

const compiledRules: readonly FoldedSensitiveTextRule[] = sensitiveTextRules
  .map((rule) => {
    const sources = rule.patterns.map((pattern) => {
      return pattern.source
    })

    return {
      category: rule.category,
      expression: compileSensitiveTextExpression(sources),
      foldedExpression: compileSensitiveTextExpression(
        sources.map(foldPolishDiacritics),
      ),
    }
  })

/**
 * A rule matches when its sources match the normalized text, or when the
 * diacritic-folded sources match the diacritic-folded text, so Polish typed
 * without `ą ć ę ł ń ó ś ź ż` is caught too. A source alternative whose
 * folded form is an everyday word elsewhere (`heroinę` folds to the English
 * `heroine`) spells the diacritic as a `\u` escape, which folding leaves
 * alone, so it matches only with the diacritic.
 */
function matchesRule(
  rule: FoldedSensitiveTextRule,
  normalizedText: string,
  foldedText: string,
): boolean {
  return rule.expression.test(normalizedText)
    || rule.foldedExpression.test(foldedText)
}

export function classifySensitiveCategories(
  text: string,
): MemorySensitiveCategory[] {
  if (!text) {
    return []
  }

  const normalizedText = normalizeSensitiveText(text)
  const foldedText = foldPolishDiacritics(normalizedText)

  return compiledRules
    .filter((rule) => {
      return matchesRule(rule, normalizedText, foldedText)
    })
    .map((rule) => {
      return rule.category
    })
}

export function classifySensitiveText(
  text: string,
): MemorySensitiveCategory | null {
  if (!text) {
    return null
  }

  const normalizedText = normalizeSensitiveText(text)
  const foldedText = foldPolishDiacritics(normalizedText)
  const matchedRule = compiledRules.find((rule) => {
    return matchesRule(rule, normalizedText, foldedText)
  })

  return matchedRule?.category ?? null
}
