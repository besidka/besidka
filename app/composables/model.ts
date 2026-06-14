export function useUserModel() {
  const { defaultModel } = useRuntimeConfig().public
  const prefStorage = usePreferenceStorage()

  const userModel = customRef<string>((track, trigger) => ({
    get() {
      track()

      return prefStorage.getItem('model') ?? (defaultModel as string)
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
