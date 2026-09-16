import type { UIMessage } from 'ai'

export const SEARCH_APOSTROPHE = 'ʼ'
export const MAX_INDEXED_BODY_LENGTH = 20000

const APOSTROPHE_VARIANTS = /['’`´]/g
const WHITESPACE_RUN = /\s+/g
const SNIPPET_SENTINEL_CHARS = /[]/g

// Pre-normalization NFC can slightly change string length, so the raw
// input is capped to a generous multiple of the final length before the
// (relatively expensive) normalization pass runs, guaranteeing bounded
// CPU work regardless of input size.
const PRE_NORMALIZE_LENGTH_MULTIPLIER = 2

/**
 * Extracts only `type === 'text'` parts, mirroring toMessageText() in
 * server/utils/projects/memory.ts. Tool calls, reasoning, file refs and
 * step-start parts are excluded on purpose.
 */
export function extractMessageSearchText(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return ''
  }

  const values: string[] = []

  for (const part of parts as UIMessage['parts']) {
    if (part.type !== 'text' || !part.text?.trim()) {
      continue
    }

    values.push(part.text.trim())
  }

  const rawBody = values.join('\n').slice(
    0,
    MAX_INDEXED_BODY_LENGTH * PRE_NORMALIZE_LENGTH_MULTIPLIER,
  )
  const body = normalizeSearchText(rawBody)

  return body.slice(0, MAX_INDEXED_BODY_LENGTH)
}

/**
 * NFC-normalises, canonicalises every apostrophe variant (U+0027, U+2019,
 * U+0060, U+00B4) to U+02BC, strips the private-use-area FTS5 snippet
 * sentinels (U+E000/U+E001) so message content can never inject fake
 * highlight boundaries into a `snippet()` result, and collapses
 * whitespace. Applied identically at index-write time and at query time.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFC')
    .replace(APOSTROPHE_VARIANTS, SEARCH_APOSTROPHE)
    .replace(SNIPPET_SENTINEL_CHARS, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
}
