import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import plugin from '../../../app/plugins/cloudflare-web-analytics.client'

interface ConsentPayload {
  granted: string[]
  denied: string[]
  changed: string[]
}

type ConsentListener = (payload: ConsentPayload) => void
type ReceiptListener = (payload: ConsentPayload) => Promise<void> | void
type NavigationGuard = (to: { fullPath: string }) => boolean

const BEACON_TOKEN = 'test-beacon-token'

const mocks = vi.hoisted(() => ({
  token: 'test-beacon-token',
  isDecided: false,
  granted: ['necessary'] as string[],
  isAnalyticsAllowed: false,
  routePath: '/',
  navigationGuards: [] as NavigationGuard[],
  useScript: vi.fn(),
  load: vi.fn(),
  consentListeners: [] as ConsentListener[],
}))

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    app: { baseURL: '/' },
    public: { cloudflareWebAnalyticsToken: mocks.token },
  })
})

mockNuxtImport('useScript', () => mocks.useScript)

mockNuxtImport('useCookieConsent', () => {
  return () => ({
    isAllowed: () => mocks.isAnalyticsAllowed,
    onConsentChange: (
      listener: ConsentListener,
      options?: { immediate?: boolean },
    ) => {
      mocks.consentListeners.push(listener)

      if (options?.immediate && mocks.isDecided) {
        listener({
          granted: mocks.granted,
          denied: ['analytics'].filter((id) => {
            return !mocks.granted.includes(id)
          }),
          changed: [],
        })
      }

      return () => {}
    },
  })
})

function createFakeNuxtApp() {
  const receiptListeners: ReceiptListener[] = []

  const $router = {
    currentRoute: {
      get value() {
        return { path: mocks.routePath }
      },
    },
    beforeEach: (guard: NavigationGuard) => {
      mocks.navigationGuards.push(guard)

      return () => {
        mocks.navigationGuards = mocks.navigationGuards.filter((entry) => {
          return entry !== guard
        })
      }
    },
  }

  return {
    $router,
    hook: vi.fn((name: string, listener: ReceiptListener) => {
      if (name === 'cookie-consent:receipt-sent') {
        receiptListeners.push(listener)
      }
    }),
    async emitReceiptSent(payload: ConsentPayload) {
      for (const listener of receiptListeners) {
        await listener(payload)
      }
    },
  }
}

function install() {
  const nuxtApp = createFakeNuxtApp()

  plugin(nuxtApp as never)

  return nuxtApp
}

function navigate(fullPath: string): boolean {
  const [guard] = mocks.navigationGuards

  return guard ? guard({ fullPath }) : true
}

function emitConsentChange(payload: ConsentPayload) {
  for (const listener of mocks.consentListeners) {
    listener(payload)
  }
}

const grantAnalytics: ConsentPayload = {
  granted: ['necessary', 'analytics'],
  denied: [],
  changed: ['analytics'],
}

const withdrawAnalytics: ConsentPayload = {
  granted: ['necessary'],
  denied: ['analytics'],
  changed: ['analytics'],
}

describe('cloudflare-web-analytics plugin', () => {
  const reload = vi.fn()
  const assign = vi.fn()

  beforeEach(() => {
    mocks.token = BEACON_TOKEN
    mocks.isDecided = false
    mocks.granted = ['necessary']
    mocks.consentListeners = []
    mocks.isAnalyticsAllowed = false
    mocks.routePath = '/'
    mocks.navigationGuards = []
    mocks.load.mockReset()
    mocks.load.mockResolvedValue(undefined)
    mocks.useScript.mockReset()
    mocks.useScript.mockReturnValue({ load: mocks.load })
    reload.mockReset()
    assign.mockReset()

    vi.stubGlobal('location', { ...window.location, reload, assign })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('never loads the beacon when no token is configured', async () => {
    mocks.token = ''
    mocks.isDecided = true
    mocks.granted = ['necessary', 'analytics']

    const nuxtApp = install()

    emitConsentChange(grantAnalytics)
    await nuxtApp.emitReceiptSent(withdrawAnalytics)

    expect(mocks.useScript).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
    expect(nuxtApp.hook).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('declares the beacon script without loading it until consent',
    () => {
      install()

      expect(mocks.useScript).toHaveBeenCalledTimes(1)

      const [input, options] = mocks.useScript.mock.calls[0]!

      expect(input.src).toBe(
        'https://static.cloudflareinsights.com/beacon.min.js',
      )
      expect(input.defer).toBe(true)
      expect(JSON.parse(input['data-cf-beacon'])).toEqual({
        token: BEACON_TOKEN,
        spa: true,
      })
      expect(options.trigger).toBe('manual')
      expect(mocks.load).not.toHaveBeenCalled()
    })

  it('does not load the beacon while consent is undecided', () => {
    install()

    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('does not load the beacon when analytics was denied on boot', () => {
    mocks.isDecided = true
    mocks.granted = ['necessary', 'preferences']

    install()

    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('loads the beacon once when analytics is already allowed on boot',
    async () => {
      mocks.isDecided = true
      mocks.granted = ['necessary', 'analytics']

      install()
      emitConsentChange(grantAnalytics)

      expect(mocks.load).toHaveBeenCalledTimes(1)
    })

  it('loads the beacon when analytics is granted later', () => {
    install()

    emitConsentChange(grantAnalytics)

    expect(mocks.load).toHaveBeenCalledTimes(1)
  })

  it('reloads the page only after the receipt was sent when analytics '
    + 'is withdrawn after the beacon loaded', async () => {
    const nuxtApp = install()

    emitConsentChange(grantAnalytics)
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))
    emitConsentChange(withdrawAnalytics)

    expect(reload).not.toHaveBeenCalled()

    await nuxtApp.emitReceiptSent(withdrawAnalytics)

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload when analytics is withdrawn before the beacon '
    + 'was ever loaded', async () => {
    const nuxtApp = install()

    emitConsentChange(withdrawAnalytics)
    await nuxtApp.emitReceiptSent(withdrawAnalytics)

    expect(mocks.load).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not reload when the beacon failed to load', async () => {
    mocks.load.mockRejectedValue(new Error('blocked'))

    const nuxtApp = install()

    emitConsentChange(grantAnalytics)
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))
    emitConsentChange(withdrawAnalytics)
    await nuxtApp.emitReceiptSent(withdrawAnalytics)

    expect(reload).not.toHaveBeenCalled()
  })

  it('does not reload on a receipt for an unrelated consent change',
    async () => {
      const nuxtApp = install()

      emitConsentChange(grantAnalytics)
      await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))
      emitConsentChange(withdrawAnalytics)
      await nuxtApp.emitReceiptSent(grantAnalytics)

      expect(reload).not.toHaveBeenCalled()
    })

  it('does not reload when analytics is granted again before the '
    + 'withdrawal receipt settles', async () => {
    const nuxtApp = install()

    emitConsentChange(grantAnalytics)
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))
    emitConsentChange(withdrawAnalytics)
    emitConsentChange(grantAnalytics)
    await nuxtApp.emitReceiptSent(withdrawAnalytics)

    expect(mocks.load).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not reload when analytics is allowed again by the time the '
    + 'receipt settles', async () => {
    const nuxtApp = install()

    emitConsentChange(grantAnalytics)
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))
    emitConsentChange(withdrawAnalytics)
    mocks.isAnalyticsAllowed = true
    await nuxtApp.emitReceiptSent(withdrawAnalytics)

    expect(reload).not.toHaveBeenCalled()
    expect(mocks.navigationGuards).toHaveLength(0)
  })

  it('reloads once the in-flight beacon load resolves after withdrawal',
    async () => {
      let resolveLoad: () => void = () => {}

      mocks.load.mockReturnValue(new Promise<void>((resolve) => {
        resolveLoad = resolve
      }))

      const nuxtApp = install()

      emitConsentChange(grantAnalytics)
      emitConsentChange(withdrawAnalytics)

      const receiptHandled = nuxtApp.emitReceiptSent(withdrawAnalytics)

      await Promise.resolve()

      expect(reload).not.toHaveBeenCalled()

      resolveLoad()
      await receiptHandled

      expect(reload).toHaveBeenCalledTimes(1)
    })

  describe('on a chat route', () => {
    async function withdrawOnChatRoute() {
      mocks.routePath = '/chats/abc123'

      const nuxtApp = install()

      emitConsentChange(grantAnalytics)
      await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))
      emitConsentChange(withdrawAnalytics)
      await nuxtApp.emitReceiptSent(withdrawAnalytics)

      return nuxtApp
    }

    it('defers the reload to the next navigation', async () => {
      await withdrawOnChatRoute()

      expect(reload).not.toHaveBeenCalled()
      expect(assign).not.toHaveBeenCalled()
      expect(mocks.navigationGuards).toHaveLength(1)
    })

    it('turns the next navigation into a full page load once',
      async () => {
        await withdrawOnChatRoute()

        const isNavigationAllowed = navigate('/chats/projects')

        expect(isNavigationAllowed).toBe(false)
        expect(assign).toHaveBeenCalledTimes(1)
        expect(assign).toHaveBeenCalledWith('/chats/projects')
        expect(reload).not.toHaveBeenCalled()
        expect(mocks.navigationGuards).toHaveLength(0)
        expect(navigate('/profile')).toBe(true)
      })

    it('keeps a single guard when the receipt hook fires twice',
      async () => {
        const nuxtApp = await withdrawOnChatRoute()

        await nuxtApp.emitReceiptSent(withdrawAnalytics)

        expect(mocks.navigationGuards).toHaveLength(1)
      })

    it('removes the pending guard when analytics is granted again',
      async () => {
        await withdrawOnChatRoute()

        emitConsentChange(grantAnalytics)

        expect(mocks.navigationGuards).toHaveLength(0)
        expect(navigate('/chats/projects')).toBe(true)
        expect(assign).not.toHaveBeenCalled()
      })

    it('lets the navigation through when consent is allowed again at '
      + 'navigation time', async () => {
      await withdrawOnChatRoute()

      mocks.isAnalyticsAllowed = true

      expect(navigate('/chats/projects')).toBe(true)
      expect(assign).not.toHaveBeenCalled()
      expect(mocks.navigationGuards).toHaveLength(0)
    })

    it('does not register a guard when the beacon never loaded',
      async () => {
        mocks.routePath = '/chats/abc123'

        const nuxtApp = install()

        emitConsentChange(withdrawAnalytics)
        await nuxtApp.emitReceiptSent(withdrawAnalytics)

        expect(mocks.navigationGuards).toHaveLength(0)
        expect(reload).not.toHaveBeenCalled()
      })
  })

  it('reloads immediately on a route outside the chats', async () => {
    mocks.routePath = '/profile'

    const nuxtApp = install()

    emitConsentChange(grantAnalytics)
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))
    emitConsentChange(withdrawAnalytics)
    await nuxtApp.emitReceiptSent(withdrawAnalytics)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(mocks.navigationGuards).toHaveLength(0)
  })
})
