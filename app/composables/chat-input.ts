export function useChatInput() {
  const { userModel } = useUserModel()

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
  }
}
