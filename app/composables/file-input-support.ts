import { createInputMediaTypePredicate } from '#shared/utils/input-media-types'

const FAIL_OPEN_INPUT_MODALITIES = ['image', 'pdf']

/**
 * Which attachment media types the currently selected model accepts,
 * resolved for both direct-provider and gateway selections.
 *
 * Deliberately independent of `useUserKeys()` (unlike `useChatInput()`,
 * which also needs key-presence data): this composable is read from
 * `Chat/GeneratedImage.vue`, which renders on the public `/shared/[slug]`
 * page for anonymous visitors — pulling in an authenticated fetch there
 * would repeat the class of bug fixed for push notifications, where an
 * unconditional authenticated request fired for signed-out users.
 *
 * Images fail open (accepted) whenever modality data is missing or the
 * model can't be resolved: Cloudflare AI Gateway's catalog currently
 * exposes no modalities at all, and treating that gap as unsupported would
 * incorrectly block image attachment for every Cloudflare model, including
 * ones that genuinely support vision. Only positive evidence — an `input`
 * array that is present but excludes `'image'` — blocks it.
 *
 * PDFs are gated only for direct models, by their `'pdf'` input modality.
 * On gateways they are ALWAYS accepted: gateway catalogs describe documents
 * as `file` rather than `pdf`, OpenRouter parses PDFs for any routed model,
 * and the server only gates images on gateways.
 *
 * `fileDeliveryContext` is the resolver input for the same selection (the
 * caller adds the send's Run code state), and `resolveDelivery` answers the
 * per-file question from it without that state
 * (native, text or unsupported, with a reason) through the resolver the send
 * route uses, so the file manager and the chips agree with the server.
 */
export function useFileInputSupport() {
  const { selection, userModel } = useUserModel()
  const { gatewayModel } = useSelectedModelInfo()

  const selectedModelInfo = computed(() => {
    const currentModel = toValue(userModel)

    if (!currentModel) return { model: null, provider: null }

    const { model, provider } = getModel(currentModel)

    return { model, provider }
  })

  const selectedModel = computed(() => selectedModelInfo.value.model)

  const canAttachMediaType = computed<(mediaType: string) => boolean>(() => {
    if (selection.value.source === 'gateway') {
      const isGatewayImageSupported
        = gatewayModel.value?.modalities?.input?.includes('image') ?? true

      return createInputMediaTypePredicate(
        isGatewayImageSupported ? ['image', 'pdf'] : ['pdf'],
      )
    }

    return createInputMediaTypePredicate(
      selectedModel.value?.modalities
        ? getModelInputModalities(selectedModel.value)
        : FAIL_OPEN_INPUT_MODALITIES,
    )
  })

  const isImageInputSupported = computed<boolean>(() => {
    return canAttachMediaType.value('image/png')
  })

  const fileDeliveryContext = computed<FileDeliveryContext>(() => {
    return getFileDeliveryContext({
      selection: selection.value,
      model: selectedModel.value,
      providerId: selectedModelInfo.value.provider?.id,
      gatewayModel: gatewayModel.value,
    })
  })

  const resolveDelivery = computed<FileDeliveryResolver>(() => {
    return createFileDeliveryResolver(fileDeliveryContext.value)
  })

  return {
    isImageInputSupported,
    canAttachMediaType,
    fileDeliveryContext,
    resolveDelivery,
  }
}
