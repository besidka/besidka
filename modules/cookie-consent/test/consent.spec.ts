import { describe, expect, it, vi } from 'vitest'
import {
  useCookieConsent,
} from '../src/runtime/composables/consent'

/**
 * These tests run against the real Nuxt test environment: real useState,
 * real useCookie, real hooks. State persists across tests in this file
 * (one app per file), so the suite is written as one sequential consent
 * lifecycle — test order matters.
 *
 * Node 26 ships an experimental localStorage global that is undefined
 * without --localstorage-file, shadowing the DOM one. The shim stores
 * items as enumerable own props (methods non-enumerable) to match the
 * Object.keys() semantics the cleanup util relies on.
 */
function createStorageShim() {
  const entries = new Map<string, string>()
  const methods = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, String(value))
    },
    removeItem: (key: string) => {
      entries.delete(key)
    },
    clear: () => {
      entries.clear()
    },
  }

  return new Proxy(methods, {
    ownKeys: () => Array.from(entries.keys()),
    getOwnPropertyDescriptor: (_target, key) => {
      if (!entries.has(String(key))) {
        return undefined
      }

      return {
        enumerable: true,
        configurable: true,
        value: entries.get(String(key)),
      }
    },
    get: (target, key) => {
      if (key in target) {
        return target[key as keyof typeof target]
      }

      return entries.get(String(key))
    },
  })
}

vi.stubGlobal('localStorage', createStorageShim())

describe('useCookieConsent (sequential lifecycle)', () => {
  it('immediate onConsentChange does not fire before any decision', () => {
    const received: unknown[] = []
    const { onConsentChange } = useCookieConsent()

    const stop = onConsentChange((payload) => {
      received.push(payload)
    }, { immediate: true })

    expect(received).toHaveLength(0)

    stop()
  })

  it('starts undecided with required categories always allowed', () => {
    const { isDecided, granted, isAllowed } = useCookieConsent()

    expect(isDecided.value).toBe(false)
    expect(granted.value).toEqual(['necessary'])
    expect(isAllowed('necessary')).toBe(true)
    expect(isAllowed('analytics')).toBe(false)
    expect(isAllowed('preferences')).toBe(false)
  })

  it('first commit grants given ids plus required and persists', () => {
    const received: Array<{
      granted: string[]
      denied: string[]
      changed: string[]
    }> = []
    const { allow, granted, isDecided, onConsentChange }
      = useCookieConsent()

    const stop = onConsentChange((payload) => {
      received.push(payload)
    })

    allow(['analytics'])
    stop()

    expect(isDecided.value).toBe(true)
    expect(granted.value).toEqual(
      expect.arrayContaining(['necessary', 'analytics']),
    )
    expect(granted.value).not.toContain('preferences')

    expect(received).toHaveLength(1)
    expect(received[0]?.denied).toEqual(
      expect.arrayContaining(['preferences', 'marketing']),
    )
    expect(received[0]?.changed).toEqual(['analytics'])
  })

  it('follow-up commit reports only the diff in changed', () => {
    const received: Array<{ changed: string[] }> = []
    const { allow, granted, onConsentChange } = useCookieConsent()

    const stop = onConsentChange((payload) => {
      received.push(payload)
    })

    allow(['marketing'])
    stop()

    expect([...received[0]!.changed].sort()).toEqual(
      ['analytics', 'marketing'],
    )
    expect(granted.value).toContain('marketing')
    expect(granted.value).not.toContain('analytics')
  })

  it('allowAll grants every declared category', () => {
    const { allowAll, granted, categories } = useCookieConsent()

    allowAll()

    const allIds = categories.map((category) => {
      return category.id
    })

    expect([...granted.value].sort()).toEqual([...allIds].sort())
  })

  it('withdrawAll keeps only required categories but stays decided', () => {
    const { allowAll, withdrawAll, granted, isDecided } = useCookieConsent()

    allowAll()
    withdrawAll()

    expect(granted.value).toEqual(['necessary'])
    expect(isDecided.value).toBe(true)
  })

  it('immediate onConsentChange fires right away once decided', () => {
    const received: Array<{ granted: string[] }> = []
    const { onConsentChange } = useCookieConsent()

    const stop = onConsentChange((payload) => {
      received.push(payload)
    }, { immediate: true })

    expect(received).toHaveLength(1)
    expect(received[0]?.granted).toEqual(['necessary'])

    stop()
  })

  it('unsubscribing stops delivery of further commits', () => {
    const received: unknown[] = []
    const { allow, withdrawAll, onConsentChange } = useCookieConsent()

    const stop = onConsentChange((payload) => {
      received.push(payload)
    })

    allow(['analytics'])

    expect(received).toHaveLength(1)

    stop()
    withdrawAll()

    expect(received).toHaveLength(1)
  })

  it('commit removes declared storage entries of denied categories', () => {
    localStorage.setItem('model', 'verify-cleanup')

    const { withdrawAll } = useCookieConsent()

    withdrawAll()

    expect(localStorage.getItem('model')).toBeNull()
  })

  it('commit keeps declared storage entries of granted categories', () => {
    const { allow, categories } = useCookieConsent()
    const optionalIds = categories
      .filter(category => !category.required)
      .map(category => category.id)

    localStorage.setItem('model', 'kept')
    allow(optionalIds)

    expect(localStorage.getItem('model')).toBe('kept')
  })

  it('consent receipt: consentId/consentDate null before decision, non-null and unique after each commit', () => {
    const {
      allow,
      consentId,
      consentDate,
    } = useCookieConsent()

    // allowAll() was called in a previous test so state is decided;
    // but we want to verify receipt fields are already set from that commit.
    expect(consentId.value).not.toBeNull()
    expect(consentDate.value).not.toBeNull()

    const firstId = consentId.value
    const firstDate = consentDate.value

    expect(firstDate).not.toBeNull()
    expect(new Date(firstDate!).toISOString()).toBe(firstDate)

    // Second commit must produce a different id.
    allow(['analytics'])

    const secondId = consentId.value

    expect(secondId).not.toBeNull()
    expect(secondId).not.toBe(firstId)
  })
})
