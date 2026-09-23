import type { GatewayModel } from '#shared/types/gateways.d'

/**
 * Resolves what the currently-selected model should be called, from whichever
 * catalog owns it. Gateway names come from already-cached catalog data only —
 * resolving a label is not itself a reason to fetch a whole gateway's model
 * list, so an unfetched gateway model falls back to its id (readable
 * `vendor/model` form) until the cache is populated. `useChatInput()`'s
 * `hydrateGatewayCatalog()` watcher is what actually populates that cache
 * eagerly for a restored gateway selection — this composable only reads it.
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
