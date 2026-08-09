/**
 * Whether the currently selected model accepts image input, resolved for
 * both direct-provider and gateway selections.
 *
 * Deliberately independent of `useUserKeys()` (unlike `useChatInput()`,
 * which also needs key-presence data): this composable is read from
 * `Chat/GeneratedImage.vue`, which renders on the public `/shared/[slug]`
 * page for anonymous visitors — pulling in an authenticated fetch there
 * would repeat the class of bug fixed for push notifications, where an
 * unconditional authenticated request fired for signed-out users.
 */
export function useImageInputSupport() {
  const { selection, userModel } = useUserModel()
  const { gatewayModel } = useSelectedModelInfo()

  const selectedModel = computed(() => {
    const currentModel = toValue(userModel)

    if (!currentModel) return null

    const { model } = getModel(currentModel)

    return model
  })

  /**
   * Fails open (defaults to `true`) whenever modality data is missing or the
   * model can't be resolved: Cloudflare AI Gateway's catalog currently
   * exposes no modalities at all, and treating that gap as unsupported would
   * incorrectly block image attachment for every Cloudflare model, including
   * ones that genuinely support vision. Only positive evidence — an
   * `input` array that is present but excludes `'image'` — blocks it.
   */
  const isImageInputSupported = computed<boolean>(() => {
    if (selection.value.source === 'gateway') {
      return gatewayModel.value?.modalities?.input?.includes('image') ?? true
    }

    return selectedModel.value?.modalities?.input?.includes('image') ?? true
  })

  return {
    isImageInputSupported,
  }
}
