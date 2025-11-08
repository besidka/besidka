export function useUserModel() {
  const { defaultModel } = useRuntimeConfig().public

  const userModel = useLocalStorage<string>('model', defaultModel as string)

  return {
    userModel,
  }
}
