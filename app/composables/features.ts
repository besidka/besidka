import type { ComputedRef } from 'vue'
import type {
  ClientFeaturesPayload,
  ClientFeatureState,
} from '#shared/types/features.d'
import type { FeatureKey } from '#shared/utils/features/registry'
import { parseError } from 'evlog'
import { log } from 'evlog/client'

export const FEATURES_STATE_KEY = 'features'

interface FeaturesPayloadFlags {
  serverRendered?: boolean
  prerenderedAt?: number
  isCached?: boolean
}

interface FeatureRefreshTracker {
  latestRefreshId: number
}

const disabledFeature: Readonly<ClientFeatureState> = Object.freeze({
  enabled: false,
  active: false,
  variant: null,
})

const refreshTrackers = new WeakMap<object, FeatureRefreshTracker>()

function useRefreshTracker(nuxtApp: object): FeatureRefreshTracker {
  let tracker = refreshTrackers.get(nuxtApp)

  if (!tracker) {
    tracker = { latestRefreshId: 0 }
    refreshTrackers.set(nuxtApp, tracker)
  }

  return tracker
}

/**
 * Feature access for the signed-in user, filled during SSR by
 * `app/plugins/10.features.ts` and refreshed on sign-in and sign-out. It
 * lives only in the SSR payload and `useState`, never in cookies or browser
 * storage (pre-check C11). The client check only hides UI; server routes
 * enforce access with `requireFeature`.
 */
export function useFeatures() {
  const features = useState<ClientFeaturesPayload | null>(
    FEATURES_STATE_KEY,
    () => null,
  )
  const nuxtApp = useNuxtApp()
  const tracker = useRefreshTracker(nuxtApp)

  async function refreshFeatures(): Promise<void> {
    const refreshId = ++tracker.latestRefreshId
    let payload: ClientFeaturesPayload

    try {
      payload = await $fetch('/api/v1/features')
    } catch (exception) {
      const parsedException = parseError(exception)

      log.warn({
        action: 'features-refresh',
        attributes: {
          features: {
            error: parsedException.message,
          },
        },
      })

      return
    }

    if (refreshId !== tracker.latestRefreshId) {
      return
    }

    features.value = payload
    await nuxtApp.callHook('features:changed', payload)
  }

  function clearFeatures(): void {
    tracker.latestRefreshId++
    features.value = null
  }

  async function prefillServerFeatures(
    payloadFlags: FeaturesPayloadFlags,
  ): Promise<void> {
    if (
      !payloadFlags.serverRendered
      || payloadFlags.prerenderedAt
      || payloadFlags.isCached
    ) {
      return
    }

    try {
      features.value = await useRequestFetch()('/api/v1/features')
    } catch {
      features.value = null
    }
  }

  return {
    features,
    refreshFeatures,
    clearFeatures,
    prefillServerFeatures,
  }
}

export function useFeature(
  key: FeatureKey,
): ComputedRef<Readonly<ClientFeatureState>> {
  const { features } = useFeatures()

  return computed<Readonly<ClientFeatureState>>(() => {
    return features.value?.features?.[key] ?? disabledFeature
  })
}

export function useIsAdmin(): ComputedRef<boolean> {
  const { features } = useFeatures()

  return computed<boolean>(() => {
    return features.value?.isAdmin === true
  })
}
