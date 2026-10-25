import type { MemorySensitiveCategory } from '#shared/types/memory.d'

/**
 * Seam to be switched to `classifySensitiveCategories` once W4's
 * deterministic classifier is in this branch. Until then no code-level
 * Art. 9 backstop exists for the callers.
 */
export function detectSpecialCategories(
  _text: string,
): MemorySensitiveCategory[] {
  return []
}
