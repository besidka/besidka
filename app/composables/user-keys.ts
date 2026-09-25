import { providerMeta } from '#shared/utils/provider-meta'

interface UserKeysResponse {
  keys: Array<{ provider: string, hasKey: boolean }>
}

export type UserKeyStatus = 'saved' | 'missing' | 'unknown'

/**
 * Key presence for every provider and gateway, fetched once into shared state.
 * Several independent components call this on every chat page mount, so the
 * fetch is deduped two ways: `dedupe: 'defer'` makes concurrent first-mount
 * callers share one in-flight request instead of each cancelling and
 * restarting it, and `getCachedData` makes a later mount (a chat-to-chat
 * navigation) reuse the already-fetched rows instead of refetching at all.
 *
 * Every lookup fails OPEN — an id the summary does not mention, a request still
 * in flight, and a request that failed all report "has a key". Gating is UI
 * guidance layered on top of the server's 401, so the worst case of failing
 * open is the pre-existing behaviour, while failing closed would disable a
 * working account's entire model list on a slow or broken response.
 *
 * Lookups read `lastKnownKeys` rather than the raw fetch `data`, so a
 * transient failure (rate limit, offline) on a background refresh keeps
 * reporting the previously fetched rows instead of blanking every provider
 * back to the loading/fail-open state.
 */
export function useUserKeys() {
  const {
    data,
    pending: isFetching,
    error,
    refresh,
  } = useLazyFetch<UserKeysResponse>('/api/v1/profiles/keys', {
    key: 'user-keys',
    dedupe: 'defer',
    getCachedData(key, nuxtApp, context) {
      if (
        context.cause === 'refresh:manual'
        || context.cause === 'refresh:hook'
      ) {
        return
      }

      return nuxtApp.static.data[key] ?? nuxtApp.payload.data[key]
    },
  })

  const lastKnownKeys = shallowRef<UserKeysResponse | null>(null)

  watch(data, (value) => {
    if (value) {
      lastKnownKeys.value = value
    }
  }, { immediate: true })

  const pending = computed<boolean>(() => {
    return isFetching.value && !lastKnownKeys.value
  })

  /**
   * Takes the `keys.provider` enum value, which is NOT interchangeable with a
   * gateway's `GatewayId` — `vercel` is stored as `vercel-gateway`. Resolve
   * gateway and provider ids through `hasKeyForProvider` instead of building
   * that string at a call site.
   */
  function hasKey(keyProviderId: string): boolean {
    const entry = lastKnownKeys.value?.keys.find((row) => {
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

  /**
   * The keys page's counterpart to `hasKeyForProvider`, and deliberately NOT
   * fail-open: a still-loading, failed, or unrecognised lookup reports
   * `'unknown'` so the UI can stay silent instead of badging a keyless
   * provider as saved. Picker gating wants the opposite trade-off — never
   * swap one for the other.
   *
   * Gated on `pending` rather than the raw in-flight flag for the same reason
   * that computed exists: the post-save/post-delete `refresh()` must resolve
   * against the rows already held, or every card's badge, delete button and
   * placeholder would blank out and pop back on each save. Once rows have
   * been fetched at least once, a later `pending`/`error` state no longer
   * forces `'unknown'` — the known rows keep reporting instead.
   */
  function keyStatusForProvider(providerOrGatewayId: string): UserKeyStatus {
    if (!lastKnownKeys.value && (pending.value || error.value)) {
      return 'unknown'
    }

    const keyProviderId = providerMeta[providerOrGatewayId]?.keyProviderId

    if (!keyProviderId) {
      return 'unknown'
    }

    const entry = lastKnownKeys.value?.keys.find((row) => {
      return row.provider === keyProviderId
    })

    if (!entry) {
      return 'unknown'
    }

    return entry.hasKey ? 'saved' : 'missing'
  }

  const hasAnyKey = computed<boolean>(() => {
    const rows = lastKnownKeys.value?.keys

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
    keyStatusForProvider,
    hasAnyKey,
    refresh,
  }
}
