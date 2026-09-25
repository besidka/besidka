import type {
  ReasoningCapability,
  ReasoningEnabledLevel,
} from '#shared/types/reasoning.d'
import {
  isGatewayReasoningSupported,
  isGatewayToolAllowed,
} from '#shared/utils/gateway-capabilities'
import { providerMeta } from '#shared/utils/provider-meta'
import type { WebSearchOption } from '~/types/web-search'

const noToolCallReason = 'This model does not support tool calling, so it '
  + 'cannot use an external search provider.'

export function useChatInput() {
  const { selection, userModel } = useUserModel()
  const { hasKeyForProvider } = useUserKeys()
  const { isImageInputSupported } = useImageInputSupport()
  const { gatewayModel } = useSelectedModelInfo()
  const gatewayCatalogCache = useGatewayCatalogCache()

  /**
   * Eagerly warms the gateway catalog cache the moment a gateway model is
   * selected — including a gateway selection restored from
   * `usePreferenceStorage()` on a plain page reload, resolved synchronously
   * before this watcher's first run. Without this, `gatewayModel` below
   * stays `null` (and every capability computed fails closed) until the
   * model picker for that specific gateway happens to be opened, which is
   * exactly the bug this closes: the web-search toggle must reflect the
   * model's real capability on load, not only after the picker has fetched
   * its catalog.
   */
  watch(
    () => {
      const current = selection.value

      return current.source === 'gateway' ? current.gatewayId : null
    },
    (gatewayId) => {
      if (!gatewayId) {
        return
      }

      hydrateGatewayCatalog(gatewayId)
    },
    { immediate: true },
  )

  /**
   * True once the current selection's capability state is knowable — always
   * for a direct provider (resolved synchronously from the curated catalog),
   * and for a gateway selection only once `useGatewayCatalogCache()` holds an
   * entry for that `gatewayId`: the catalog was fetched, whether by this
   * composable's `hydrateGatewayCatalog()` watcher above or by the picker's
   * own `useGatewayCatalog()`. `false` while that fetch is still in flight,
   * or forever after a failed fetch that was never retried — either way, the
   * capability computeds below (`reasoningCapability`, `isWebSearchSupported`,
   * ...) are failing closed rather than reporting a real answer, so callers
   * must not treat their current value as ground truth yet. `ChatInput.
   * client.vue`'s reasoning/tools reset watchers key off this to avoid
   * wiping real user state (a persisted reasoning level, a chat's carried-
   * over search tool) during that window instead of only once the model's
   * real capability is known.
   */
  const isModelCapabilityResolved = computed<boolean>(() => {
    const current = selection.value

    if (current.source === 'provider') {
      return true
    }

    return !!gatewayCatalogCache.value[current.gatewayId]
  })

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

  /**
   * Gateway models resolve web search through the shared catalog signal
   * (`GatewayModel.supportsWebSearch`, `'native' | 'universal' | undefined`)
   * instead of a curated `tools` array — any resolved value means the send
   * gate (`isGatewayToolAllowed` in `#shared/utils/gateway-capabilities`)
   * will accept the request. Reads from the already-cached catalog only, so
   * a persisted gateway selection resolves to `false` for one brief window
   * on load — until the `hydrateGatewayCatalog()` watcher above resolves —
   * the same fail-closed shape the gateway image-input check avoids by
   * failing open, but web search has no safe "assume yes" default the way
   * vision does.
   */
  const isWebSearchSupported = computed<boolean>(() => {
    if (selection.value.source === 'gateway') {
      return gatewayModel.value?.supportsWebSearch !== undefined
    }

    return !!selectedModel.value?.tools.includes('web_search')
  })

  /**
   * The gateway counterpart of `Model.toolCall`, mirroring the server-side
   * gate in `index.post.ts` (`gatewayToolCall !== true`): a persisted
   * gateway selection resolves to `false` until `GatewayModel.toolCall` is
   * confirmed `true` from the catalog — eagerly hydrated by the watcher
   * above rather than only on a picker open — so Brave/Exa never appear as
   * offerable ahead of a send the server would then reject.
   */
  const isToolCallingSupported = computed<boolean>(() => {
    if (selection.value.source === 'gateway') {
      return gatewayModel.value?.toolCall === true
    }

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
          : 'Add a Brave Search key in Search Providers.',
      },
      {
        value: 'web_search_exa',
        label: 'Exa',
        providerId: 'exa',
        enabled: hasKeyForProvider('exa'),
        disabledReason: hasKeyForProvider('exa')
          ? undefined
          : 'Add an Exa key in Search Providers.',
      },
    )

    return options
  })

  /**
   * Gateway models resolve image generation from the shared catalog signal
   * (`GatewayModel.supportsImageGeneration`, derived from the model's own
   * OUTPUT modalities — see `shared/utils/gateway-capabilities.ts`) gated
   * through `isGatewayToolAllowed`, the same server-side send-gate policy —
   * a model's catalog entry can report `supportsImageGeneration: true` on a
   * gateway whose policy still rejects the tool (Cloudflare's `@cf/` catalog
   * derives the same output-modalities signal but has no working image
   * generation mechanism), and the toggle must never appear for a send the
   * server would then 400.
   */
  const isImageGenerationSupported = computed<boolean>(() => {
    const current = selection.value

    if (current.source === 'gateway') {
      return gatewayModel.value?.supportsImageGeneration === true
        && isGatewayToolAllowed(current.gatewayId, 'image_generation')
    }

    return !!(
      selectedModel.value?.tools.includes('image_generation')
      || isImageGenerationModel(selectedModel.value)
    )
  })

  /**
   * A dedicated image-generation gateway model has no curated
   * `Model.imageGeneration` entry to read (the curated catalog only covers
   * direct providers, and a gateway model id like
   * `google/gemini-3.1-flash-image` never matches a bare curated id like
   * `gemini-3.1-flash-image`), so this mirrors the direct-provider
   * required/forced decision with `isImageGenerationSupported` instead: a
   * live fetch of both Vercel's and OpenRouter's full catalogs confirmed
   * every model reporting an `image` output modality is tagged
   * `image-generation`-only (Flux, Recraft, GPT Image, the Gemini
   * `*-image` line, …) — no general chat model leaks through — so
   * "this gateway model can produce images" and "this gateway model is a
   * dedicated image generator" are the same fact on both catalogs today.
   */
  const isImageGenerationRequired = computed<boolean>(() => {
    if (selection.value.source === 'gateway') {
      return isImageGenerationSupported.value
    }

    return isImageGenerationModel(selectedModel.value)
  })

  /**
   * Gateway models resolve reasoning the same fail-closed way web search
   * does (`isWebSearchSupported` above): a functional control only appears
   * once `isGatewayReasoningSupported` (OpenRouter/Vercel; never Cloudflare
   * — see `#shared/utils/gateway-capabilities`) AND the already-cached
   * catalog reports `supportsReasoning === true` for the selected model. A
   * gateway model carries no curated `low`/`medium`/`high` level list the
   * way direct providers do, so any supported gateway model gets the app's
   * full level set — the server-side mapping per gateway/provider is what
   * actually decides how each level is honored (see
   * `docs/providers/gateways.md`'s "Gateway reasoning" section).
   */
  const gatewayReasoningCapability = computed<
    ReasoningCapability | null
  >(() => {
    const current = selection.value

    if (current.source !== 'gateway') {
      return null
    }

    if (!isGatewayReasoningSupported(current.gatewayId)) {
      return null
    }

    if (gatewayModel.value?.supportsReasoning !== true) {
      return null
    }

    return {
      mode: 'levels',
      levels: reasoningEnabledLevels,
    }
  })

  const reasoningCapability = computed<ReasoningCapability | null>(() => {
    if (selection.value.source === 'gateway') {
      return gatewayReasoningCapability.value
    }

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
   * The `providerMeta` id whose key unlocks the current selection — a gateway
   * id in gateway mode, the owning provider id otherwise. `useUserKeys` maps
   * it to the `keys.provider` enum value, so no caller builds that string.
   */
  const selectedModelKeyOwnerId = computed<string | null>(() => {
    const current = selection.value

    if (current.source === 'gateway') {
      return current.gatewayId
    }

    return getModel(current.modelId).provider?.id ?? null
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

  /**
   * A gateway selection whose catalog has loaded (`isModelCapabilityResolved`)
   * but no longer lists the persisted `modelId` — removed upstream, or a
   * stale `localStorage` value. Unlike a curated-provider selection (see
   * `useUserModel()`'s own fallback to `defaultModel`), a gateway catalog
   * miss is never silently substituted: the user picked that exact model, so
   * `ChatInput.client.vue` surfaces this and blocks send instead.
   */
  const isSelectedModelUnavailable = computed<boolean>(() => {
    const current = selection.value

    if (current.source !== 'gateway') {
      return false
    }

    return isModelCapabilityResolved.value && !gatewayModel.value
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
    isModelCapabilityResolved,
    isSelectedModelUnavailable,
  }
}
