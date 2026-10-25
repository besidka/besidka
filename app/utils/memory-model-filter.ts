import type { Model } from '#shared/types/providers.d'
import type { GatewayModel } from '#shared/types/gateways.d'
import { isDeepResearchModel } from '#shared/utils/research'

export function isMemoryModelSelectable(model: Model): boolean {
  if (!model.modalities.output.includes('text')) {
    return false
  }

  if (model.imageGeneration || isDeepResearchModel(model)) {
    return false
  }

  if (model.retiredAt && Date.parse(model.retiredAt) <= Date.now()) {
    return false
  }

  return true
}

export function isMemoryGatewayModelSelectable(model: GatewayModel): boolean {
  if (model.supportsImageGeneration === true) {
    return false
  }

  if (!model.modalities) {
    return true
  }

  return model.modalities.output.includes('text')
}
