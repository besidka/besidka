import type { KnowledgeTokenFamily } from '#shared/types/project-knowledge.d'
import {
  countKnowledgeChars,
  estimateKnowledgeTextTokens,
} from '#shared/utils/project-knowledge-budget'

export const DEFAULT_MEMORY_TOKEN_FAMILY: KnowledgeTokenFamily = 'default'

/**
 * Offline token estimate for memory text injected into a prompt, with the
 * same per-family characters-per-token factors as the project knowledge
 * budget (`KNOWLEDGE_CHARS_PER_TOKEN`): Latin, Cyrillic and other characters
 * are counted per class, divided by the family's figure, summed and rounded
 * up once. The family is the tokenizer of the model the text goes to, so
 * Cyrillic is estimated conservatively on Claude, Qwen, DeepSeek and Kimi;
 * without one the conservative `default` family applies. Counts Unicode
 * code points, so a surrogate pair is one character.
 */
export function estimateMemoryTokens(
  text: string,
  family: KnowledgeTokenFamily = DEFAULT_MEMORY_TOKEN_FAMILY,
): number {
  return estimateKnowledgeTextTokens(countKnowledgeChars(text), family)
}
