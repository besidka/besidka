/**
 * Whether the currently selected model accepts image input.
 *
 * Deliberately independent of `useUserKeys()` (unlike `useChatInput()`,
 * which also needs key-presence data): this composable is read from
 * `Chat/GeneratedImage.vue`, which renders on the public `/shared/[slug]`
 * page for anonymous visitors — pulling in an authenticated fetch there
 * would repeat the class of bug fixed for push notifications, where an
 * unconditional authenticated request fired for signed-out users.
 */
export function useImageInputSupport() {
  const { userModel } = useUserModel()

  const selectedModel = computed(() => {
    const currentModel = toValue(userModel)

    if (!currentModel) return null

    const { model } = getModel(currentModel)

    return model
  })

  /**
   * Fails open (defaults to `true`) whenever modality data is missing or the
   * model can't be resolved. Only positive evidence — an `input` array that
   * is present but excludes `'image'` — blocks it.
   */
  const isImageInputSupported = computed<boolean>(() => {
    return selectedModel.value?.modalities?.input?.includes('image') ?? true
  })

  return {
    isImageInputSupported,
  }
}
