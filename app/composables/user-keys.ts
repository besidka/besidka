import { providerMeta } from '#shared/utils/provider-meta'

interface UserKeysResponse {
  keys: Array<{ provider: string, hasKey: boolean }>
}

/**
 * Key presence for every provider and gateway, fetched once into shared state.
 *
 * Every lookup fails OPEN — an id the summary does not mention, a request still
 * in flight, and a request that failed all report "has a key". Gating is UI
 * guidance layered on top of the server's 401, so the worst case of failing
 * open is the pre-existing behaviour, while failing closed would disable a
 * working account's entire model list on a slow or broken response.
 */
export function useUserKeys() {
  const {
    data,
    pending: isFetching,
    error,
    refresh,
  } = useLazyFetch<UserKeysResponse>('/api/v1/profiles/keys', {
    key: 'user-keys',
  })

  const pending = computed<boolean>(() => {
    return isFetching.value && !data.value
  })

  /**
   * Takes the `keys.provider` enum value, which is NOT interchangeable with a
   * gateway's `GatewayId` — `vercel` is stored as `vercel-gateway`. Resolve
   * gateway and provider ids through `hasKeyForProvider` instead of building
   * that string at a call site.
   */
  function hasKey(keyProviderId: string): boolean {
    const entry = data.value?.keys.find((row) => {
      return row.provider === keyProviderId
    })

    if (!entry) {
      return true
    }

    return entry.hasKey
  }

  function hasKeyForProvider(providerOrGatewayId: string): boolean {
    const keyProviderId = providerMeta[providerOrGatewayId]?.keyProviderId

    if (!keyProviderId) {
      return true
    }

    return hasKey(keyProviderId)
  }

  const hasAnyKey = computed<boolean>(() => {
    const rows = data.value?.keys

    if (!rows) {
      return true
    }

    return rows.some((row) => {
      return row.hasKey
    })
  })

  return {
    pending,
    error,
    hasKey,
    hasKeyForProvider,
    hasAnyKey,
    refresh,
  }
}
