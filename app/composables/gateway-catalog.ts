import type { GatewayId, GatewayModel } from '#shared/types/gateways.d'

type SupportedGatewayId = Exclude<GatewayId, 'cloudflare'>

interface GatewayModelsResponse {
  gateway: GatewayId
  models: GatewayModel[]
}

export function useGatewayCatalog(
  gatewayId: Ref<SupportedGatewayId> | SupportedGatewayId,
) {
  const gatewayCatalogCache = useState<
    Partial<Record<GatewayId, GatewayModel[]>>
  >('gateway-catalog-cache', () => ({}))

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
