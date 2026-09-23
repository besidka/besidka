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

    gatewayCatalogCache.value[value.gateway] = value.models
  })

  const models = computed(() => data.value?.models ?? [])

  return { models, pending, error, refresh }
}
