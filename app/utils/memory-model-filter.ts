import type { Model } from '#shared/types/providers.d'
import type { GatewayModel } from '#shared/types/gateways.d'
import { isDeepResearchModel } from '#shared/utils/research'
import { getModelCategory } from '~/utils/models-picker'

const NON_CHAT_GATEWAY_MODEL_PATTERN = new RegExp(
  '(^|[/\\-_:.\\s])('
  + 'embed(ding)?s?|rerank(er|ing)?|tts|text-to-speech|speech|whisper'
  + '|transcri(be|ption)|moderation|text-to-image|image-gen(eration)?'
  + '|stable-diffusion|sdxl|dall-e'
  + ')([/\\-_:.\\s]|$)',
  'i',
)

function isNonChatGatewayModelName(model: GatewayModel): boolean {
  return NON_CHAT_GATEWAY_MODEL_PATTERN.test(model.id)
    || NON_CHAT_GATEWAY_MODEL_PATTERN.test(model.name)
}

export function isMemoryModelSelectable(model: Model): boolean {
  if (!model.modalities.output.includes('text')) {
    return false
  }

  if (model.imageGeneration || isDeepResearchModel(model)) {
    return false
  }

  if (getModelCategory(model) !== 'chat') {
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

  const { modalities } = model

  if (!modalities) {
    return !isNonChatGatewayModelName(model)
  }

  if (!modalities.output.includes('text')) {
    return false
  }

  return modalities.input.length === 0 || modalities.input.includes('text')
}
