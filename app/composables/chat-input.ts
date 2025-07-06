function replaceUserPre(input: string): string {
  return input
    .replace(/<pre>?(\r?\n+)?/, '```$1')
    .replace(/(\r?\n+)?<?\/pre>?/, '$1```')
}

export function useChatInput() {
  const { userModel } = useUserModel()

  const isWebSearchSupported = computed<boolean>(() => {
    if (!userModel) return false

    const { model } = getModel(toValue(userModel))

    return !!model?.tools.includes('web_search')
  })

  return {
    replaceUserPre,
    isWebSearchSupported,
  }
}
