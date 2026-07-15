const flatImageGenerationCostUsdByModelId: Record<string, number> = {
  'gemini-3.1-flash-image': 0.067,
  'gemini-3.1-flash-lite-image': 0.0336,
  'gemini-3-pro-image': 0.134,
  'gemini-2.5-flash-image': 0.039,
}

const openAiImageModelId = 'gpt-image-2'
const openAiSquareAspectRatio = '1:1'
const openAiSquareImageCostUsd = 0.041
const openAiNonSquareImageCostUsd = 0.053

/**
 * Dollar cost of one generated image for a given image-only model, the
 * single source of truth shared by per-message usage (chat stream cost) and
 * per-file cost (files manager). Google image models are flat-priced per
 * image; OpenAI's `gpt-image-2` is aspect-ratio-dependent, cheaper for the
 * square `1:1` size than the non-square `2:3`/`3:2` sizes. Cross-checked
 * against each model's `price.display` string in `providers/openai.ts` and
 * `providers/google.ts`. Returns `undefined` for any model with no known
 * image-generation price, so callers omit cost rather than fabricate one.
 */
export function getImageGenerationCost(
  modelId: string,
  aspectRatio: string,
): number | undefined {
  const flatCost = flatImageGenerationCostUsdByModelId[modelId]

  if (flatCost !== undefined) {
    return flatCost
  }

  if (modelId !== openAiImageModelId) {
    return undefined
  }

  return aspectRatio === openAiSquareAspectRatio
    ? openAiSquareImageCostUsd
    : openAiNonSquareImageCostUsd
}
