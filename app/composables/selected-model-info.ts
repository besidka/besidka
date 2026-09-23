import type { GatewayModel } from '#shared/types/gateways.d'

/**
 * Resolves what the currently-selected model should be called, from whichever
 * catalog owns it. Gateway names come from already-cached catalog data only —
 * resolving a label must not be a reason to fetch hundreds of models on every
 * page load, so an unfetched gateway model falls back to its id, which every
 * gateway renders in readable `vendor/model` form.
 */
export function useSelectedModelInfo() {
  const { selection } = useUserModel()
  const gatewayCatalogCache = useGatewayCatalogCache()

  const gatewayModel = computed<GatewayModel | null>(() => {
    const current = selection.value

    if (current.source !== 'gateway') {
      return null
    }

    const models = gatewayCatalogCache.value[current.gatewayId] ?? []

    return models.find((model) => {
      return model.id === current.modelId
    }) ?? null
  })

  const name = computed<string>(() => {
    const current = selection.value

    if (current.source === 'provider') {
      return getModelName(current.modelId)
    }

    return gatewayModel.value?.name || current.modelId
  })

  const description = computed<string | undefined>(() => {
    const current = selection.value

    if (current.source === 'provider') {
      return getModel(current.modelId).model?.description
    }

    return gatewayModel.value?.description
  })

  const iconProviderId = computed<string | null>(() => {
    const current = selection.value

    if (current.source === 'gateway') {
      return current.gatewayId
    }

    return getModel(current.modelId).provider?.id ?? null
  })

  return {
    selection,
    gatewayModel,
    name,
    description,
    iconProviderId,
  }
}
