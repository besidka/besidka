import { nextTick, watchEffect } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  useCookieConsent,
} from '../../../modules/cookie-consent/src/runtime/composables/consent'
import {
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
