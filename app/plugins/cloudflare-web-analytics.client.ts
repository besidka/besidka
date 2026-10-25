const BEACON_SCRIPT_URL = 'https://static.cloudflareinsights.com/beacon.min.js'
const ANALYTICS_CATEGORY_ID = 'analytics'
const CHAT_ROUTE_PREFIX = '/chats/'

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

  async function loadBeacon(): Promise<void> {
    try {
      await beaconScript.load()
      isBeaconLoaded.value = true
    } catch (exception) {
      void exception
    }
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
      beaconLoadRequest ??= loadBeacon()

      return
    }

    if (denied.includes(ANALYTICS_CATEGORY_ID) && beaconLoadRequest) {
      isReloadPending.value = true
    }
  }, { immediate: true })

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
