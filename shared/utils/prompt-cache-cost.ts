import type {
  PromptCacheCostEstimate,
  PromptCacheCostInput,
} from '#shared/types/project-knowledge.d'

const TOKENS_PER_PRICE_UNIT = 1_000_000

/**
 * Prices are USD per 1M tokens. A missing cache read or write price falls
 * back to the plain input price, so a model without cache pricing reports
 * zero savings and `hasCachePrice: false`. The cached total includes the
 * first turn's cache write; `perChangeUsd` is the extra cost of one
 * knowledge change that rewrites the cached block.
 */
export function estimatePromptCacheCost(
  input: PromptCacheCostInput,
): PromptCacheCostEstimate {
  const { cost, tokens, turns } = input
  const hasCachePrice = typeof cost.cacheRead === 'number'
    && Number.isFinite(cost.cacheRead)

  if (turns < 1 || tokens <= 0) {
    return {
      uncachedUsd: 0,
      cachedUsd: 0,
      perChangeUsd: 0,
      savingsRatio: 0,
      hasCachePrice,
    }
  }

  const readPrice = cost.cacheRead ?? cost.input
  const writePrice = cost.cacheWrite ?? cost.input
  const uncachedUsd = turns * tokens * cost.input / TOKENS_PER_PRICE_UNIT
  const cachedUsd = tokens * writePrice / TOKENS_PER_PRICE_UNIT
    + (turns - 1) * tokens * readPrice / TOKENS_PER_PRICE_UNIT
  const perChangeUsd = tokens * (writePrice - readPrice)
    / TOKENS_PER_PRICE_UNIT
  const savingsRatio = uncachedUsd > 0 ? 1 - cachedUsd / uncachedUsd : 0

  return {
    uncachedUsd,
    cachedUsd,
    perChangeUsd,
    savingsRatio,
    hasCachePrice,
  }
}
