/**
 * Resolves what the currently-selected model should be called.
 */
export function useSelectedModelInfo() {
  const { userModel } = useUserModel()

  const name = computed<string>(() => {
    return getModelName(userModel.value)
  })

  const description = computed<string | undefined>(() => {
    return getModel(userModel.value).model?.description
  })

  const iconProviderId = computed<string | null>(() => {
    return getModel(userModel.value).provider?.id ?? null
  })

  return {
    name,
    description,
    iconProviderId,
  }
}
