export type GoogleSearchBillingUnit = 'query' | 'grounded-prompt'

/**
 * Gemini 3.x bills Grounding with Google Search per deduplicated non-empty
 * search query; Gemini 2.5 and earlier instead bill per grounded
 * prompt/request regardless of how many queries that request ran. The AI
 * SDK's Google provider exposes no generation field to read this from, so it
 * is inferred from the model id string. This must be revisited for a future
 * Gemini 4.x generation, whose billing rule is unknown today. See
 * https://ai.google.dev/gemini-api/docs/google-search (as of 2026-09-21).
 */
export function getGoogleSearchBillingUnit(
  modelId: string,
): GoogleSearchBillingUnit | undefined {
  const match = modelId.match(/^gemini-(\d+)/)

  if (!match?.[1]) {
    return undefined
  }

  return Number(match[1]) >= 3 ? 'query' : 'grounded-prompt'
}
