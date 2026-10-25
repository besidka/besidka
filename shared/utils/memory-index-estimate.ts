import type { MemoryEntry } from '#shared/types/memory.d'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import { estimateMemoryTokens } from '#shared/utils/memory-tokens'

export type MemoryIndexEstimateEntry = Pick<
  MemoryEntry,
  | 'projectId'
  | 'category'
  | 'slug'
  | 'title'
  | 'description'
  | 'body'
  | 'sensitivity'
>

const WHITESPACE_RUN = /\s+/g

function toSingleLine(value: string): string {
  return value.replace(WHITESPACE_RUN, ' ').trim()
}

function renderIndexPart(entry: MemoryIndexEstimateEntry): string {
  const hasInjectedBody = entry.body.trim() !== ''
    && (entry.category === 'profile' || entry.category === 'preferences')

  if (hasInjectedBody) {
    return entry.body.trim()
  }

  const title = toSingleLine(entry.title)
  const description = toSingleLine(entry.description)
  const line = `- ${entry.category}/${entry.slug} | ${title}`

  return description === '' ? line : `${line} — ${description}`
}

/**
 * Client-side estimate of the account `<memory>` index that every send
 * carries, for entries already loaded on the page. It mirrors the server
 * rendering of `buildMemoryIndex` (`server/utils/memory/index-builder.ts`):
 * profile and preferences bodies in full, every other entry as one
 * `handle | title — description` line, legacy `special` entries skipped.
 * It leaves out the fixed header text, and it caps the result at the
 * server's index budget because the server trims descriptions to fit it.
 * Returns 0 when there is nothing to send.
 */
export function estimateMemoryIndexTokens(
  entries: readonly MemoryIndexEstimateEntry[],
): number {
  const injectedEntries = entries.filter((entry) => {
    return !entry.projectId && entry.sensitivity !== 'special'
  })

  if (injectedEntries.length === 0) {
    return 0
  }

  const text = injectedEntries.map(renderIndexPart).join('\n')

  return Math.min(estimateMemoryTokens(text), MEMORY_LIMITS.indexTokenBudget)
}
