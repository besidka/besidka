import type { KnowledgeTokenFamily } from '#shared/types/project-knowledge.d'
import { estimateMemoryTokens } from '#shared/utils/memory-tokens'
import {
  SKILL_ACTIVATE_MAX_BYTES,
  SKILL_ARGUMENTS_MAX_BYTES,
} from '#shared/utils/skills-policy'

export const SKILL_ARGUMENTS_PLACEHOLDER = '$ARGUMENTS'
export const SKILL_CONTENT_TAG = 'skill_content'
export const SKILL_RESOURCES_TAG = 'skill_resources'
export const SKILL_ACTIVE_BLOCK_TAG = 'active_skills'
export const SKILL_CATALOG_TAG = 'available_skills'

const SKILL_DELIMITER_TAGS = [
  SKILL_CONTENT_TAG,
  SKILL_RESOURCES_TAG,
  SKILL_ACTIVE_BLOCK_TAG,
  SKILL_CATALOG_TAG,
  'skill_notice',
]
const DELIMITER_OPENING = new RegExp(
  `<(\\s*(?:\\/\\s*)?)(${SKILL_DELIMITER_TAGS.join('|')})(?![\\w-])`,
  'gi',
)
const WHITESPACE_RUN = /\s+/g
const ATTRIBUTE_UNSAFE = /[&"<>]/g
const TRUNCATION_SHRINK_FACTOR = 0.9

const attributeEscapes: Record<string, string> = {
  '&': '&amp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
}

/**
 * Swaps the opening angle bracket of the skill wrapper tags, and only of
 * those, for a guillemet, so a skill body or a description can close neither
 * its own `<skill_content>` nor the catalog or the active-skills block. Every
 * other `<` is left alone because skills are often code and Markdown.
 */
export function neutralizeSkillDelimiters(text: string): string {
  return text.replace(DELIMITER_OPENING, '‹$1$2')
}

export function toSkillAttributeValue(value: string): string {
  return neutralizeSkillDelimiters(value)
    .replace(WHITESPACE_RUN, ' ')
    .trim()
    .replace(ATTRIBUTE_UNSAFE, character => attributeEscapes[character]!)
}

export function toSkillSingleLine(value: string): string {
  return neutralizeSkillDelimiters(value).replace(WHITESPACE_RUN, ' ').trim()
}

/**
 * Substitutes the user's text for every `$ARGUMENTS` with split and join,
 * never a string replacement, because user text such as `$&` or `$1` would
 * otherwise be read as a replacement pattern. The text is cut at
 * `SKILL_ARGUMENTS_MAX_BYTES`, and the expansion stops once it is past the
 * activation byte cap, so a body full of placeholders cannot multiply a long
 * text into megabytes (the caller cuts the result to the cap). A body without
 * the placeholder gets the text appended as `ARGUMENTS: ...`, and nothing
 * when there is none.
 */
export function applySkillArguments(
  body: string,
  argumentsText: string,
): string {
  const trimmed = truncateToByteBudget(
    argumentsText,
    SKILL_ARGUMENTS_MAX_BYTES,
  ).text.trim()

  if (!body.includes(SKILL_ARGUMENTS_PLACEHOLDER)) {
    return trimmed ? `${body.trimEnd()}\n\nARGUMENTS: ${trimmed}` : body
  }

  const segments = body.split(SKILL_ARGUMENTS_PLACEHOLDER)
  let expanded = segments[0]!

  for (const segment of segments.slice(1)) {
    if (expanded.length > SKILL_ACTIVATE_MAX_BYTES) {
      break
    }

    expanded += trimmed + segment
  }

  return expanded
}

export function isOverTokenBudget(
  text: string,
  maxTokens: number,
  family: KnowledgeTokenFamily,
): boolean {
  return estimateMemoryTokens(text, family) > maxTokens
}

/**
 * Cuts text to at most `maxTokens` for the model family, on a code point
 * boundary. The estimate is class-aware (Latin versus Cyrillic), so the cut
 * shrinks until the estimate fits instead of dividing by one fixed ratio.
 */
export function truncateToTokenBudget(
  text: string,
  maxTokens: number,
  family: KnowledgeTokenFamily,
): { text: string, isTruncated: boolean } {
  if (!isOverTokenBudget(text, maxTokens, family)) {
    return { text, isTruncated: false }
  }

  const codePoints = Array.from(text)
  let keep = Math.max(
    0,
    Math.floor(codePoints.length * maxTokens
      / estimateMemoryTokens(text, family)),
  )

  while (keep > 0) {
    const candidate = codePoints.slice(0, keep).join('')

    if (!isOverTokenBudget(candidate, maxTokens, family)) {
      return { text: candidate, isTruncated: true }
    }

    keep = Math.floor(keep * TRUNCATION_SHRINK_FACTOR)
  }

  return { text: '', isTruncated: true }
}

export function truncateToByteBudget(
  text: string,
  maxBytes: number,
): { text: string, isTruncated: boolean } {
  const encoded = new TextEncoder().encode(text)

  if (encoded.byteLength <= maxBytes) {
    return { text, isTruncated: false }
  }

  const decoder = new TextDecoder('utf-8', { fatal: false })
  const decoded = decoder.decode(encoded.slice(0, maxBytes))

  return { text: decoded.replace(/�+$/, ''), isTruncated: true }
}
