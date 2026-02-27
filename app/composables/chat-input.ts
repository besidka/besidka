export function useChatInput() {
  const { userModel } = useUserModel()

  const isWebSearchSupported = computed<boolean>(() => {
    const currentModel = toValue(userModel)

    if (!currentModel) return false

    const { model } = getModel(currentModel)

    return !!model?.tools.includes('web_search')
  })

  const reasoningCapability = computed(() => {
    const currentModel = toValue(userModel)

    if (!currentModel) {
      return null
    }

    const { model } = getModel(currentModel)

    return getReasoningCapability(model)
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
    reasoningCapability,
    reasoningMode,
    reasoningLevels,
    isReasoningSupported,
  }
}
