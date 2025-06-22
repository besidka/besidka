export function useUserModel() {
  const { defaultModel } = useRuntimeConfig().public

  const userModel = useCookie<string>('model', {
    default: () => defaultModel as string,
  })

  return {
    userModel,
  }
}
