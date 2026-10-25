import type { Model } from '#shared/types/providers.d'
import { isDeepResearchModel } from '#shared/utils/research'

/**
 * The shared usability filter for a catalog model picked for memory work: it
 * must produce text, must not be an async deep-research agent or an
 * image-generation model, and must not be past its retirement date. A
 * `deprecated` model that is not yet retired stays usable.
 */
export function isUsableMemoryCatalogModel(model: Model): boolean {
  if (!model.modalities.output.includes('text')) {
    return false
  }

  if (isDeepResearchModel(model) || model.imageGeneration) {
    return false
  }

  if (!model.retiredAt) {
    return true
  }

  const retiredAtTime = Date.parse(model.retiredAt)

  return Number.isNaN(retiredAtTime) || retiredAtTime > Date.now()
}
