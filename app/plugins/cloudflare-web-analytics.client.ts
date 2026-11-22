import type { AnalyticsLocation } from '~/utils/artifact-share-location'
import { isArtifactShareLocation } from '~/utils/artifact-share-location'

const BEACON_SCRIPT_URL = 'https://static.cloudflareinsights.com/beacon.min.js'
const ANALYTICS_CATEGORY_ID = 'analytics'
const CHAT_ROUTE_PREFIX = '/chats/'

function readCurrentLocation(): AnalyticsLocation {
  return {
    path: window.location.pathname,
    query: Object.fromEntries(new URLSearchParams(window.location.search)),
  }
}

export default defineNuxtPlugin((nuxtApp): void => {
  const config = useRuntimeConfig()
  const token = config.public.cloudflareWebAnalyticsToken

  if (!token) {
    return
  }

  const { isAllowed, onConsentChange } = useCookieConsent()
  const router = nuxtApp.$router

  const beaconScript = useScript(
    {
      'src': BEACON_SCRIPT_URL,
      'defer': true,
      'crossorigin': false,
      'data-cf-beacon': JSON.stringify({ token, spa: true }),
    },
    { trigger: 'manual' },
  )

  const isBeaconLoaded = shallowRef<boolean>(false)
  const isReloadPending = shallowRef<boolean>(false)
  let beaconLoadRequest: Promise<void> | null = null
  let removeNavigationGuard: (() => void) | null = null
  let isBeaconDeferred = false

  async function loadBeacon(): Promise<void> {
    try {
      await beaconScript.load()
      isBeaconLoaded.value = true
    } catch (exception) {
      void exception
    }
  }

  function requestBeacon(): void {
    if (beaconLoadRequest) {
      return
    }

    if (isArtifactShareLocation(readCurrentLocation())) {
      isBeaconDeferred = true

      return
    }

    isBeaconDeferred = false
    beaconLoadRequest = loadBeacon()
  }

  function cancelDeferredReload(): void {
    removeNavigationGuard?.()
    removeNavigationGuard = null
  }

  function deferReloadToNextNavigation(): void {
    if (removeNavigationGuard) {
      return
    }

    removeNavigationGuard = router.beforeEach((to) => {
      cancelDeferredReload()

      if (isAllowed(ANALYTICS_CATEGORY_ID)) {
        return true
      }

      window.location.assign(to.fullPath)

      return false
    })
  }

  function reloadWithoutBeacon(): void {
    if (isAllowed(ANALYTICS_CATEGORY_ID)) {
      return
    }

    if (router.currentRoute.value.path.startsWith(CHAT_ROUTE_PREFIX)) {
      deferReloadToNextNavigation()

      return
    }

    window.location.reload()
  }

  onConsentChange(({ granted, denied }): void => {
    if (granted.includes(ANALYTICS_CATEGORY_ID)) {
      isReloadPending.value = false
      cancelDeferredReload()
      requestBeacon()

      return
    }

    if (denied.includes(ANALYTICS_CATEGORY_ID)) {
      isBeaconDeferred = false
    }

    if (denied.includes(ANALYTICS_CATEGORY_ID) && beaconLoadRequest) {
      isReloadPending.value = true
    }
  }, { immediate: true })

  router.beforeResolve((to) => {
    if (!beaconLoadRequest || !isArtifactShareLocation(to)) {
      return true
    }

    window.location.assign(to.fullPath)

    return false
  })

  router.afterEach((to) => {
    if (
      !isBeaconDeferred
      || isArtifactShareLocation(to)
      || !isAllowed(ANALYTICS_CATEGORY_ID)
    ) {
      return
    }

    isBeaconDeferred = false
    beaconLoadRequest ??= loadBeacon()
  })

  nuxtApp.hook('cookie-consent:receipt-sent', async ({ denied }) => {
    if (!isReloadPending.value || !denied.includes(ANALYTICS_CATEGORY_ID)) {
      return
    }

    await beaconLoadRequest

    if (!isReloadPending.value || !isBeaconLoaded.value) {
      return
    }

    reloadWithoutBeacon()
  })
})
