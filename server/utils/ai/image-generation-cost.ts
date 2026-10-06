interface AspectRatioImageCostUsd {
  square: number
  nonSquare: number
}

const flatImageGenerationCostUsdByModelId: Record<string, number> = {
  'gemini-3.1-flash-image': 0.067,
  'gemini-3.1-flash-lite-image': 0.0336,
  'gemini-3-pro-image': 0.134,
  'gemini-2.5-flash-image': 0.039,
  'grok-imagine-image-2.0': 0.04,
  'grok-imagine-image': 0.02,
}

const aspectRatioImageCostUsdByModelId: Record<
  string,
  AspectRatioImageCostUsd
> = {
  'gpt-image-2': { square: 0.053, nonSquare: 0.041 },
  'gpt-image-2.5-sunburst': { square: 0.013, nonSquare: 0.01 },
  'gpt-image-2.5-flare': { square: 0.013, nonSquare: 0.01 },
}

const squareAspectRatio = '1:1'

/**
 * Dollar cost of one generated image for a given image-only model, the
 * single source of truth shared by per-message usage (chat stream cost) and
 * per-file cost (files manager). Google and xAI image models are
 * flat-priced per image; OpenAI's GPT Image models are
 * aspect-ratio-dependent, more expensive for the square `1:1` size than the
 * non-square `2:3`/`3:2` sizes. The `gpt-image-2.5-*` prices at medium
 * quality are derived from OpenAI's image token calculator at $30 per 1M
 * output tokens (https://developers.openai.com/api/docs/guides/image-generation),
 * not published per-image rates.
 * Cross-checked against each model's `price.display` string in
 * `providers/openai.ts`, `providers/google.ts` and `providers/xai.ts`.
 * Returns `undefined` for any model with no known image-generation price,
 * so callers omit cost rather than fabricate one.
 */
export function getImageGenerationCost(
  modelId: string,
  aspectRatio: string,
): number | undefined {
  const flatCost = flatImageGenerationCostUsdByModelId[modelId]

  if (flatCost !== undefined) {
    return flatCost
  }

  const aspectRatioCost = aspectRatioImageCostUsdByModelId[modelId]

  if (!aspectRatioCost) {
    return undefined
  }

  return aspectRatio === squareAspectRatio
    ? aspectRatioCost.square
    : aspectRatioCost.nonSquare
}
