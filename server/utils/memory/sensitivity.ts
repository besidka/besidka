import type { MemorySensitiveCategory } from '#shared/types/memory.d'
import {
  sensitiveTextRuleTable,
  sensitiveWordEnd,
  sensitiveWordStart,
} from '~~/server/utils/memory/sensitivity-rules'

interface CompiledSensitiveTextRule {
  category: MemorySensitiveCategory
  expression: RegExp
}

const SPACE_PLACEHOLDER = ' '
const SPACE_EXPRESSION = String.raw`\s+`

export const sensitiveTextRules = sensitiveTextRuleTable

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
 * Lowercases with NFKC, straightens apostrophe variants and folds `ё` to `е`,
 * the form every rule source is written against.
 */
export function normalizeSensitiveText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ʼ’‘`´]/g, '\'')
    .replace(/ё/g, 'е')
}

const compiledRules: readonly CompiledSensitiveTextRule[] = sensitiveTextRules
  .map((rule) => {
    return {
      category: rule.category,
      expression: compileSensitiveTextExpression(
        rule.patterns.map((pattern) => {
          return pattern.source
        }),
      ),
    }
  })

export function classifySensitiveCategories(
  text: string,
): MemorySensitiveCategory[] {
  if (!text) {
    return []
  }

  const normalizedText = normalizeSensitiveText(text)

  return compiledRules
    .filter((rule) => {
      return rule.expression.test(normalizedText)
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
  const matchedRule = compiledRules.find((rule) => {
    return rule.expression.test(normalizedText)
  })

  return matchedRule?.category ?? null
}
