import type {
  ReasoningCapability,
  ReasoningEnabledLevel,
} from '#shared/types/reasoning.d'
import { providerMeta } from '#shared/utils/provider-meta'
import type { WebSearchOption } from '~/types/web-search'

const noToolCallReason = 'This model does not support tool calling, so it '
  + 'cannot use an external search provider.'

export function useChatInput() {
  const { userModel } = useUserModel()
  const { hasKeyForProvider } = useUserKeys()
  const { isImageInputSupported } = useImageInputSupport()

  const selectedModel = computed(() => {
    const currentModel = toValue(userModel)

    if (!currentModel) return null

    const { model } = getModel(currentModel)

    return model
  })

  const researchConfig = computed(() => {
    return getModelResearch(selectedModel.value)
  })

  const isDeepResearchModel = computed<boolean>(() => {
    return !!researchConfig.value
  })

  const isWebSearchSupported = computed<boolean>(() => {
    return !!selectedModel.value?.tools.includes('web_search')
  })

  const isToolCallingSupported = computed<boolean>(() => {
    return selectedModel.value?.toolCall === true
  })

  const webSearchProviderOptions = computed<WebSearchOption[]>(() => {
    const options: WebSearchOption[] = [
      {
        value: 'web_search',
        label: 'Model\'s built-in search',
        enabled: isWebSearchSupported.value,
        disabledReason: isWebSearchSupported.value
          ? undefined
          : 'This model has no built-in web search.',
      },
    ]

    if (!isToolCallingSupported.value) {
      options.push(
        {
          value: 'web_search_brave',
          label: 'Brave Search',
          providerId: 'brave',
          enabled: false,
          disabledReason: noToolCallReason,
        },
        {
          value: 'web_search_exa',
          label: 'Exa',
          providerId: 'exa',
          enabled: false,
          disabledReason: noToolCallReason,
        },
      )

      return options
    }

    options.push(
      {
        value: 'web_search_brave',
        label: 'Brave Search',
        providerId: 'brave',
        enabled: hasKeyForProvider('brave'),
        disabledReason: hasKeyForProvider('brave')
          ? undefined
          : 'Add a Brave Search key in Search providers.',
      },
      {
        value: 'web_search_exa',
        label: 'Exa',
        providerId: 'exa',
        enabled: hasKeyForProvider('exa'),
        disabledReason: hasKeyForProvider('exa')
          ? undefined
          : 'Add an Exa key in Search providers.',
      },
    )

    return options
  })

  const isImageGenerationSupported = computed<boolean>(() => {
    return !!(
      selectedModel.value?.tools.includes('image_generation')
      || isImageGenerationModel(selectedModel.value)
    )
  })

  const isImageGenerationRequired = computed<boolean>(() => {
    return isImageGenerationModel(selectedModel.value)
  })

  const reasoningCapability = computed<ReasoningCapability | null>(() => {
    return getReasoningCapability(selectedModel.value)
  })

  const isReasoningSupported = computed<boolean>(() => {
    return !!reasoningCapability.value
  })

  const reasoningMode = computed<'none' | 'toggle' | 'levels'>(() => {
    if (!reasoningCapability.value) {
      return 'none'
    }

    return reasoningCapability.value.mode
  })

  const reasoningMenuLevels = computed<ReasoningEnabledLevel[]>(() => {
    return getReasoningMenuLevels(reasoningCapability.value)
  })

  /**
   * The `providerMeta` id whose key unlocks the current selection.
   * `useUserKeys` maps it to the `keys.provider` enum value, so no caller
   * builds that string.
   */
  const selectedModelKeyOwnerId = computed<string | null>(() => {
    return getModel(userModel.value).provider?.id ?? null
  })

  const selectedModelKeyOwnerLabel = computed<string>(() => {
    const ownerId = selectedModelKeyOwnerId.value

    if (!ownerId) {
      return 'this provider'
    }

    return providerMeta[ownerId]?.label ?? ownerId
  })

  const isSelectedModelKeyless = computed<boolean>(() => {
    const ownerId = selectedModelKeyOwnerId.value

    if (!ownerId) {
      return false
    }

    return !hasKeyForProvider(ownerId)
  })

  return {
    isWebSearchSupported,
    isToolCallingSupported,
    webSearchProviderOptions,
    isImageGenerationSupported,
    isImageGenerationRequired,
    isImageInputSupported,
    reasoningCapability,
    reasoningMode,
    reasoningMenuLevels,
    isReasoningSupported,
    researchConfig,
    isDeepResearchModel,
    isSelectedModelKeyless,
    selectedModelKeyOwnerLabel,
  }
}
