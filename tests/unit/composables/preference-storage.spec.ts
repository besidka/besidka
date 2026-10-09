import { nextTick, watchEffect } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  useCookieConsent,
} from '../../../modules/cookie-consent/src/runtime/composables/consent'
import {
  useCookieConsentUi,
} from '../../../modules/cookie-consent/src/runtime/composables/ui'
import {
  requestPersistence,
  usePreferenceStorage,
} from '../../../app/composables/preference-storage'

/**
 * Sequential lifecycle tests — one Nuxt app per file, state persists
 * across tests. Order matters: undecided → grant → deny → flush.
 *
 * Node 26 ships an experimental localStorage global that is undefined
 * without --localstorage-file. The shim stores items as enumerable own
 * props (methods non-enumerable) to match the Object.keys() semantics
 * the cleanup util relies on.
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

describe('usePreferenceStorage (sequential lifecycle)', () => {
  it('denied: setItem keeps real localStorage empty but getItem serves pending', () => {
    const { withdrawAll } = useCookieConsent()

    withdrawAll()

    const { setItem, getItem } = usePreferenceStorage()

    setItem('model', 'gpt-4')

    expect(window.localStorage.getItem('model')).toBeNull()
    expect(getItem('model')).toBe('gpt-4')
  })

  it('denied: a second setItem updates the pending value', () => {
    const { getItem, setItem } = usePreferenceStorage()

    setItem('model', 'gemini-pro')

    expect(window.localStorage.getItem('model')).toBeNull()
    expect(getItem('model')).toBe('gemini-pro')
  })

  it('denied: removeItem clears both real storage and pending map', () => {
    const { setItem, removeItem, getItem } = usePreferenceStorage()

    setItem('model', 'to-be-removed')
    removeItem('model')

    expect(window.localStorage.getItem('model')).toBeNull()
    expect(getItem('model')).toBeNull()
  })

  it('granted: setItem writes through to real localStorage', () => {
    const { allowAll } = useCookieConsent()

    allowAll()

    const { setItem, getItem } = usePreferenceStorage()

    setItem('model', 'claude-3')

    expect(window.localStorage.getItem('model')).toBe('claude-3')
    expect(getItem('model')).toBe('claude-3')
  })

  it('granted: getItem prefers real localStorage over pending map', () => {
    window.localStorage.setItem('chat_input', 'real-value')

    const { getItem } = usePreferenceStorage()

    expect(getItem('chat_input')).toBe('real-value')
  })

  it('reactivity: watchEffect re-runs after flushPending bumps storageVersion', async () => {
    const { withdrawAll, allowAll } = useCookieConsent()

    withdrawAll()

    const { setItem, flushPending, getItem } = usePreferenceStorage()

    setItem('flush-key', 'pre-flush')

    const observed: Array<string | null> = []
    const stop = watchEffect(() => {
      observed.push(getItem('flush-key'))
    })

    // Initial run recorded
    expect(observed).toHaveLength(1)
    expect(observed[0]).toBe('pre-flush')

    allowAll()
    flushPending()
    await nextTick()

    // After flush the effect must have re-run and now reads real storage
    expect(observed.length).toBeGreaterThan(1)
    expect(observed.at(-1)).toBe('pre-flush')

    stop()
  })

  it('flushPending writes all pending entries to localStorage and clears map', () => {
    const { withdrawAll } = useCookieConsent()

    withdrawAll()

    const { setItem, flushPending, getItem } = usePreferenceStorage()

    setItem('file-manager-view-mode', 'list')
    setItem('settings_reasoning_level', 'low')

    expect(window.localStorage.getItem('file-manager-view-mode')).toBeNull()
    expect(window.localStorage.getItem('settings_reasoning_level')).toBeNull()

    flushPending()

    expect(
      window.localStorage.getItem('file-manager-view-mode'),
    ).toBe('list')
    expect(
      window.localStorage.getItem('settings_reasoning_level'),
    ).toBe('low')

    setItem('file-manager-view-mode', 'grid')
    expect(
      window.localStorage.getItem('file-manager-view-mode'),
    ).toBeNull()

    const { allowAll } = useCookieConsent()

    allowAll()
    flushPending()

    expect(getItem('file-manager-view-mode')).toBe('grid')
  })
})

function stubThrowingSetItem(): () => void {
  const original = window.localStorage

  vi.stubGlobal('localStorage', new Proxy(original, {
    get: (target, key) => {
      if (key === 'setItem') {
        return () => {
          throw new Error('QuotaExceededError')
        }
      }

      return Reflect.get(target, key)
    },
  }))

  return () => {
    vi.stubGlobal('localStorage', original)
  }
}

describe('usePreferenceStorage when localStorage throws', () => {
  it('granted: setItem falls back to the pending map without throwing', () => {
    useCookieConsent().allowAll()

    const restore = stubThrowingSetItem()
    const { setItem, getItem } = usePreferenceStorage()

    expect(() => setItem('model', 'quota-model')).not.toThrow()
    expect(getItem('model')).toBe('quota-model')

    restore()
  })

  it('flushPending keeps failed entries pending and does not throw', () => {
    useCookieConsent().withdrawAll()

    const { setItem, flushPending, getItem } = usePreferenceStorage()

    setItem('settings_reasoning_level', 'high')
    useCookieConsent().allowAll()

    const restore = stubThrowingSetItem()

    expect(() => flushPending()).not.toThrow()
    expect(getItem('settings_reasoning_level')).toBe('high')

    restore()
    flushPending()

    expect(window.localStorage.getItem('settings_reasoning_level'))
      .toBe('high')
  })
})

/**
 * Sequential lifecycle tests for the just-in-time prompt. The once-per-load
 * latch is module-scope, so only one request can ever be shown in this file:
 * every suppression case runs before the single successful one.
 */
describe('requestPersistence (sequential lifecycle)', () => {
  function resetToUndecided(): void {
    useState<boolean>('cookie-consent:decided').value = false
    useState<string[]>('cookie-consent:granted').value = ['necessary']
    useState<string | null>('cookie-consent:request').value = null
    useState<boolean>('notification-prompt:is-visible').value = false
  }

  it('never asks a visitor who accepted', () => {
    resetToUndecided()
    useCookieConsent().allowAll()

    const { consentRequest } = useCookieConsentUi()

    requestPersistence()

    expect(consentRequest.value).toBeNull()
  })

  it('never asks a visitor who rejected', () => {
    resetToUndecided()
    useCookieConsent().withdrawAll()

    const { consentRequest } = useCookieConsentUi()

    requestPersistence()

    expect(consentRequest.value).toBeNull()
  })

  it('stays silent while a consent view is open', () => {
    resetToUndecided()

    const { openPopup, close, consentRequest } = useCookieConsentUi()

    openPopup()
    requestPersistence()

    expect(consentRequest.value).toBeNull()

    close()
  })

  it('stays silent while the notification prompt is visible', () => {
    resetToUndecided()
    useState<boolean>('notification-prompt:is-visible').value = true

    const { consentRequest } = useCookieConsentUi()

    requestPersistence()

    expect(consentRequest.value).toBeNull()
  })

  it('asks an undecided visitor', () => {
    resetToUndecided()

    const { consentRequest } = useCookieConsentUi()

    requestPersistence()

    expect(consentRequest.value).toBe('preferences')
  })

  it('asks at most once per page load', () => {
    const { consentRequest, dismissRequest } = useCookieConsentUi()

    dismissRequest()
    requestPersistence()

    expect(consentRequest.value).toBeNull()
  })

  it('Remember grants preferences and flushes pending values', async () => {
    resetToUndecided()
    window.localStorage.removeItem('model')

    const { setItem } = usePreferenceStorage()
    const { granted, isDecided } = useCookieConsent()
    const { grantRequest } = useCookieConsentUi()

    setItem('model', 'remembered-model')

    expect(window.localStorage.getItem('model')).toBeNull()

    useState<string | null>('cookie-consent:request').value = 'preferences'
    grantRequest('preferences')

    expect(granted.value).toContain('preferences')
    expect(isDecided.value).toBe(true)

    await vi.waitFor(() => {
      expect(window.localStorage.getItem('model')).toBe('remembered-model')
    })
  })
})
