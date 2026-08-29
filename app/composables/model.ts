export function useUserModel() {
  const { defaultModel } = useRuntimeConfig().public
  const prefStorage = usePreferenceStorage()

  const userModel = customRef<string>((track, trigger) => ({
    get() {
      track()

      const parsed = parseModelSelection(
        prefStorage.getItem('model'),
        defaultModel as string,
      )

      if (!getModel(parsed).model) {
        return defaultModel as string
      }

      return parsed
    },
    set(value) {
      prefStorage.setItem('model', value)
      trigger()
    },
  }))

  return {
    userModel,
  }
}
