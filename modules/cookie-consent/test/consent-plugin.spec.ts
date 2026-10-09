import { describe, expect, it, vi } from 'vitest'
import { useCookieConsent } from '../src/runtime/composables/consent'
import plugin from '../src/runtime/plugins/consent.client'

/**
 * The module plugin purges declared entries of every optional category that
 * is not allowed, including while the visitor is still undecided. State is
 * shared across tests in this file (one app per file), so the suite is one
 * sequential lifecycle: undecided, granted, withdrawn.
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

function runPlugin() {
  plugin({ runWithContext: (callback: () => unknown) => callback() } as never)
}

describe('consent.client plugin (sequential lifecycle)', () => {
  it('purges optional entries while the visitor is undecided', () => {
    const { isDecided } = useCookieConsent()

    expect(isDecided.value).toBe(false)

    localStorage.setItem('model', 'written-before-consent')

    runPlugin()

    expect(localStorage.getItem('model')).toBeNull()
  })

  it('keeps required entries while the visitor is undecided', () => {
    const { isDecided } = useCookieConsent()

    expect(isDecided.value).toBe(false)

    localStorage.setItem('chat_input_backup', 'unsent message')
    document.cookie = 'session_token=abc123; path=/'

    runPlugin()

    expect(localStorage.getItem('chat_input_backup')).toBe('unsent message')
    expect(document.cookie).toContain('session_token=abc123')
  })

  it('keeps optional entries once their category is granted', () => {
    const { allowAll, isDecided } = useCookieConsent()

    allowAll()

    expect(isDecided.value).toBe(true)

    localStorage.setItem('model', 'granted')

    runPlugin()

    expect(localStorage.getItem('model')).toBe('granted')
  })

  it('purges optional entries after a withdrawal', () => {
    const { withdrawAll } = useCookieConsent()

    withdrawAll()
    localStorage.setItem('model', 'written-after-withdrawal')

    runPlugin()

    expect(localStorage.getItem('model')).toBeNull()
  })
})
