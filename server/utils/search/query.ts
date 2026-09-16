import { normalizeSearchText } from '~~/server/utils/search/text'
import {
  MAX_SEARCH_TOKENS, stemSearchToken, tokenizeSearchText,
} from '~~/server/utils/search/tokens'

export const MAX_SEARCH_QUERY_LENGTH = 128

// Pre-normalization NFC can slightly change string length, so the raw
// query is capped to a generous multiple of the final length before the
// (relatively expensive) normalization pass runs, guaranteeing bounded
// CPU work regardless of input size.
const PRE_NORMALIZE_LENGTH_MULTIPLIER = 2

export interface SearchMatchExpression {
  match: string | null
  tokens: string[]
}

export function buildSearchOwnerTag(userId: number): string {
  return `u${userId}`
}

/**
 * Builds the FTS5 MATCH expression. Every token is emitted as a quoted
 * phrase with a prefix star, in an OR pair across body and body_stem, all
 * ANDed together under an owner column filter.
 */
export function buildSearchMatchExpression(
  search: string,
  userId: number,
): SearchMatchExpression {
  const preNormalized = search.slice(
    0,
    MAX_SEARCH_QUERY_LENGTH * PRE_NORMALIZE_LENGTH_MULTIPLIER,
  )
  const normalized = normalizeSearchText(preNormalized)
    .slice(0, MAX_SEARCH_QUERY_LENGTH)
  const tokens = tokenizeSearchText(normalized).slice(0, MAX_SEARCH_TOKENS)

  if (!tokens.length) {
    return { match: null, tokens: [] }
  }

  const ownerTag = buildSearchOwnerTag(userId)
  const tokenClauses = tokens.map((token) => {
    const escapedToken = escapeSearchMatchToken(token)
    const escapedStem = escapeSearchMatchToken(stemSearchToken(token))

    return `({body}: "${escapedToken}"* OR {body_stem}: "${escapedStem}"*)`
  })

  const match = `{owner}: ${ownerTag} AND ${tokenClauses.join(' AND ')}`

  return { match, tokens }
}

function escapeSearchMatchToken(token: string): string {
  return token.replaceAll('"', '""')
}
