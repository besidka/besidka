export function useChatInput() {
  const { userModel } = useUserModel()

  const isWebSearchSupported = computed<boolean>(() => {
    if (!userModel) return false

    const { model } = getModel(toValue(userModel))

    return !!model?.tools.includes('web_search')
  })

  return {
    isWebSearchSupported,
  }
}
