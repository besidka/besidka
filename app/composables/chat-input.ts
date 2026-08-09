import { providerMeta } from '#shared/utils/provider-meta'

export function useChatInput() {
  const { selection, userModel } = useUserModel()
  const { hasKeyForProvider } = useUserKeys()

  const selectedModel = computed(() => {
    const currentModel = toValue(userModel)

    if (!currentModel) return null

    const { model } = getModel(currentModel)

    return model
  })

  const researchConfig = computed(() => {
    return getModelResearch(selectedModel.value)
  })

  const isDeepResearchModel = computed<boolean>(() => {
    return !!researchConfig.value
  })

  const isWebSearchSupported = computed<boolean>(() => {
    return !!selectedModel.value?.tools.includes('web_search')
  })

  const isImageGenerationSupported = computed<boolean>(() => {
    return !!(
      selectedModel.value?.tools.includes('image_generation')
      || isImageGenerationModel(selectedModel.value)
    )
  })

  const isImageGenerationRequired = computed<boolean>(() => {
    return isImageGenerationModel(selectedModel.value)
  })

  const reasoningCapability = computed(() => {
    return getReasoningCapability(selectedModel.value)
  })

  const isReasoningSupported = computed<boolean>(() => {
    return !!reasoningCapability.value
  })

  const reasoningMode = computed<'none' | 'toggle' | 'levels'>(() => {
    if (!reasoningCapability.value) {
      return 'none'
    }

    return reasoningCapability.value.mode
  })

  const reasoningLevels = computed(() => {
    return getReasoningDropdownLevels(reasoningCapability.value)
  })

  /**
   * The `providerMeta` id whose key unlocks the current selection — a gateway
   * id in gateway mode, the owning provider id otherwise. `useUserKeys` maps
   * it to the `keys.provider` enum value, so no caller builds that string.
   */
  const selectedModelKeyOwnerId = computed<string | null>(() => {
    const current = selection.value

    if (current.source === 'gateway') {
      return current.gatewayId
    }

    return getModel(current.modelId).provider?.id ?? null
  })

  const selectedModelKeyOwnerLabel = computed<string>(() => {
    const ownerId = selectedModelKeyOwnerId.value

    if (!ownerId) {
      return 'this provider'
    }

    return providerMeta[ownerId]?.label ?? ownerId
  })

  const isSelectedModelKeyless = computed<boolean>(() => {
    const ownerId = selectedModelKeyOwnerId.value

    if (!ownerId) {
      return false
    }

    return !hasKeyForProvider(ownerId)
  })

  return {
    isWebSearchSupported,
    isImageGenerationSupported,
    isImageGenerationRequired,
    reasoningCapability,
    reasoningMode,
    reasoningLevels,
    isReasoningSupported,
    researchConfig,
    isDeepResearchModel,
    isSelectedModelKeyless,
    selectedModelKeyOwnerLabel,
  }
}
