import type { GatewayId, GatewayModel } from '#shared/types/gateways.d'

interface GatewayModelsResponse {
  gateway: GatewayId
  models: GatewayModel[]
}

/**
 * Shared catalog state, readable without mounting a fetch — lets UI that only
 * needs a label for an already-selected gateway model (the picker trigger)
 * avoid pulling a whole catalog on every page load.
 */
export function useGatewayCatalogCache() {
  return useState<Partial<Record<GatewayId, GatewayModel[]>>>(
    'gateway-catalog-cache',
    () => ({}),
  )
}

const gatewayCatalogHydrations = new Map<GatewayId, Promise<void>>()

/**
 * Imperatively warms the shared catalog cache for one gateway, for callers
 * that need `GatewayModel` capability data (`toolCall`, `supportsWebSearch`,
 * ...) to be available as soon as possible without mounting the picker's
 * `useGatewayCatalog()` — a persisted gateway selection restored on page
 * load being the motivating case. No-ops when the cache already has that
 * gateway, when a hydration for it is already in flight (deduping this
 * function's own concurrent callers — namely the two `useChatInput()` call
 * sites), or outside the client (this is a client-only UX concern, and the
 * module-scope dedupe map must never carry state across server requests).
 * This dedupe is local to this function only: the picker's
 * `useGatewayCatalog()` has its own independent `useLazyFetch()` and does
 * not consult this map, so a picker opened during this function's in-flight
 * fetch still issues its own request — both write the same shape into the
 * same `useGatewayCatalogCache()` `useState`, so the result is a harmless
 * duplicate write, not a conflict. Fetch failures resolve silently: a
 * keyless or rate-limited user should see the search toggle stay hidden,
 * the same as before the catalog loaded, not an error toast.
 */
export function hydrateGatewayCatalog(gatewayId: GatewayId): Promise<void> {
  if (!import.meta.client) {
    return Promise.resolve()
  }

  const gatewayCatalogCache = useGatewayCatalogCache()

  if (gatewayCatalogCache.value[gatewayId]) {
    return Promise.resolve()
  }

  const inFlight = gatewayCatalogHydrations.get(gatewayId)

  if (inFlight) {
    return inFlight
  }

  const hydration = (async () => {
    try {
      const response = await $fetch<GatewayModelsResponse>(
        `/api/v1/gateways/${gatewayId}/models`,
      )

      gatewayCatalogCache.value[response.gateway] = markRaw(response.models)
    } catch {
      return
    } finally {
      gatewayCatalogHydrations.delete(gatewayId)
    }
  })()

  gatewayCatalogHydrations.set(gatewayId, hydration)

  return hydration
}

/**
 * Accepts any `GatewayId`: the models route, not this wrapper, decides which
 * gateways it can serve, and answers an unsupported one with an error the
 * caller already renders. Keeping the narrower type here would only force a
 * cast at every call site that iterates `enabledGateways`.
 */
export function useGatewayCatalog(
  gatewayId: Ref<GatewayId> | GatewayId,
) {
  const gatewayCatalogCache = useGatewayCatalogCache()

  const { data, pending, error, refresh } = useLazyFetch<
    GatewayModelsResponse
  >(
    () => `/api/v1/gateways/${toValue(gatewayId)}/models`,
    {
      key: () => `gateway-catalog-${toValue(gatewayId)}`,
      getCachedData: () => {
        const currentGatewayId = toValue(gatewayId)
        const cachedModels = gatewayCatalogCache.value[currentGatewayId]

        return cachedModels
          ? { gateway: currentGatewayId, models: cachedModels }
          : undefined
      },
    },
  )

  watch(data, (value) => {
    if (!value) {
      return
    }

    gatewayCatalogCache.value[value.gateway] = markRaw(value.models)
  })

  const models = computed(() => data.value?.models ?? [])

  return { models, pending, error, refresh }
}
