import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import plugin from '../../../app/plugins/cookie-consent-gate.client'

interface ConsentPayload {
  granted: string[]
  denied: string[]
  changed: string[]
}

type ConsentListener = (payload: ConsentPayload) => void

const RECEIPT_DELAY_MS = 150
const RECEIPT_TIMEOUT_MS = 5000
const CONSENT_REVISION = 2

const mocks = vi.hoisted(() => ({
  consentId: { value: 'consent-id' as string | null },
  consentDate: { value: '2026-10-24T10:00:00.000Z' as string | null },
  consentListeners: [] as ConsentListener[],
  fetch: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    app: { baseURL: '/' },
    public: { cookieConsent: { revision: 2 } },
  })
})

mockNuxtImport('useCookieConsent', () => {
  return () => ({
    isAllowed: () => true,
    consentId: mocks.consentId,
    consentDate: mocks.consentDate,
    onConsentChange: (listener: ConsentListener) => {
      mocks.consentListeners.push(listener)

      return () => {}
    },
  })
})

mockNuxtImport('usePreferenceStorage', () => {
  return () => ({ flushPending: vi.fn() })
})

mockNuxtImport('useColorMode', () => {
  return () => reactive({ preference: 'system' })
})

mockNuxtImport('useAuth', () => {
  return () => ({
    lastLoginMethod: shallowRef<string | null>(null),
    client: {},
  })
})

function install() {
  const callHook = vi.fn().mockResolvedValue(undefined)

  plugin({ callHook } as never)

  return callHook
}

function emitConsentChange(payload: ConsentPayload) {
  for (const listener of mocks.consentListeners) {
    listener(payload)
  }
}

const withdrawAnalytics: ConsentPayload = {
  granted: ['necessary'],
  denied: ['analytics'],
  changed: ['analytics'],
}

describe('cookie-consent-gate plugin receipt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.consentId.value = 'consent-id'
    mocks.consentDate.value = '2026-10-24T10:00:00.000Z'
    mocks.consentListeners = []
    mocks.fetch.mockReset()
    mocks.fetch.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the receipt only after the deferral delay', async () => {
    install()

    emitConsentChange(withdrawAnalytics)

    await vi.advanceTimersByTimeAsync(RECEIPT_DELAY_MS - 1)

    expect(mocks.fetch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/consents',
      expect.objectContaining({
        method: 'POST',
        body: {
          id: 'consent-id',
          date: '2026-10-24T10:00:00.000Z',
          revision: CONSENT_REVISION,
          ...withdrawAnalytics,
        },
      }),
    )
  })

  it('bounds the receipt request with a timeout', async () => {
    install()

    emitConsentChange(withdrawAnalytics)
    await vi.advanceTimersByTimeAsync(RECEIPT_DELAY_MS)

    expect(mocks.fetch.mock.calls[0]![1].timeout).toBe(RECEIPT_TIMEOUT_MS)
  })

  it('fires receipt-sent with the payload after the POST succeeds',
    async () => {
      const callHook = install()

      emitConsentChange(withdrawAnalytics)
      await vi.advanceTimersByTimeAsync(RECEIPT_DELAY_MS - 1)

      expect(callHook).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)

      expect(callHook).toHaveBeenCalledTimes(1)
      expect(callHook).toHaveBeenCalledWith(
        'cookie-consent:receipt-sent',
        withdrawAnalytics,
      )
      expect(mocks.fetch.mock.invocationCallOrder[0]).toBeLessThan(
        callHook.mock.invocationCallOrder[0]!,
      )
    })

  it('fires receipt-sent with the payload after the POST fails',
    async () => {
      mocks.fetch.mockRejectedValue(new Error('timeout'))

      const callHook = install()

      emitConsentChange(withdrawAnalytics)
      await vi.advanceTimersByTimeAsync(RECEIPT_DELAY_MS)

      expect(callHook).toHaveBeenCalledTimes(1)
      expect(callHook).toHaveBeenCalledWith(
        'cookie-consent:receipt-sent',
        withdrawAnalytics,
      )
    })

  it('fires receipt-sent once per consent change', async () => {
    const callHook = install()
    const grantAnalytics: ConsentPayload = {
      granted: ['necessary', 'analytics'],
      denied: [],
      changed: ['analytics'],
    }

    emitConsentChange(grantAnalytics)
    emitConsentChange(withdrawAnalytics)
    await vi.advanceTimersByTimeAsync(RECEIPT_DELAY_MS)

    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(callHook).toHaveBeenCalledTimes(2)
    expect(callHook).toHaveBeenNthCalledWith(
      1,
      'cookie-consent:receipt-sent',
      grantAnalytics,
    )
    expect(callHook).toHaveBeenNthCalledWith(
      2,
      'cookie-consent:receipt-sent',
      withdrawAnalytics,
    )
  })

  it('sends no receipt when the consent id is missing', async () => {
    mocks.consentId.value = null

    const callHook = install()

    emitConsentChange(withdrawAnalytics)
    await vi.advanceTimersByTimeAsync(RECEIPT_DELAY_MS)

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(callHook).not.toHaveBeenCalled()
  })
})
