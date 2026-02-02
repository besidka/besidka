export function useChatInput() {
  const { userModel } = useUserModel()

  const isWebSearchSupported = computed<boolean>(() => {
    const currentModel = toValue(userModel)

    if (!currentModel) return false

    const { model } = getModel(currentModel)

    return !!model?.tools.includes('web_search')
  })

  const isReasoningSupported = computed<boolean>(() => {
    const currentModel = toValue(userModel)

    if (!currentModel) return false

    const { model } = getModel(currentModel)

    return !!model?.reasoning
  })

  return {
    isWebSearchSupported,
    isReasoningSupported,
  }
}
