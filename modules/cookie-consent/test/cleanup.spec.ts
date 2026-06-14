import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildCookieDeleteString,
  cleanupEntry,
} from '../src/runtime/utils/cleanup'

// ---------------------------------------------------------------------------
// The Nuxt test environment may not provide working localStorage/sessionStorage
// in all configurations. We provide in-memory stubs that satisfy the Storage
// interface used by cleanupEntry().
// ---------------------------------------------------------------------------

class InMemoryStorage {
  private readonly store: Record<string, string> = {}

  get length(): number {
    return Object.keys(this.store).length
  }

  key(index: number): string | null {
    return Object.keys(this.store)[index] ?? null
  }

  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key)
      ? (this.store[key] ?? null)
      : null
  }

  setItem(key: string, value: string): void {
    this.store[key] = value
  }

  removeItem(key: string): void {
    Reflect.deleteProperty(this.store, key)
  }

  clear(): void {
    for (const key of Object.keys(this.store)) {
      Reflect.deleteProperty(this.store, key)
    }
  }

  [key: string]: unknown
}

// Proxy so Object.keys() on the instance returns the storage keys,
// which is what cleanupEntry() uses for prefix matching.

function makeStorage(): Storage & { [key: string]: unknown } {
  const base = new InMemoryStorage()

  return new Proxy(base, {
    ownKeys(target) {
      const methods = new Set(
        Object.getOwnPropertyNames(InMemoryStorage.prototype),
      )
      const store = Reflect.get(
        target,
        'store',
      ) as Record<string, string>

      return Object.keys(store).filter(key => !methods.has(key))
    },
    getOwnPropertyDescriptor(target, key) {
      const store = Reflect.get(
        target,
        'store',
      ) as Record<string, string>

      if (Object.prototype.hasOwnProperty.call(store, key)) {
        return {
          configurable: true,
          enumerable: true,
          value: store[key as string],
        }
      }

      return Object.getOwnPropertyDescriptor(target, key)
    },
  }) as Storage & { [key: string]: unknown }
}

let localStore: ReturnType<typeof makeStorage>
let sessionStore: ReturnType<typeof makeStorage>

beforeEach(() => {
  localStore = makeStorage()
  sessionStore = makeStorage()

  vi.stubGlobal('localStorage', localStore)
  vi.stubGlobal('sessionStorage', sessionStore)
})

// ---------------------------------------------------------------------------

describe('cleanup utils', () => {
  // -------------------------------------------------------------------------
  // buildCookieDeleteString
  // -------------------------------------------------------------------------

  describe('buildCookieDeleteString()', () => {
    it('produces the correct deletion string for a named cookie', () => {
      expect(buildCookieDeleteString('my_cookie')).toBe(
        'my_cookie=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/',
      )
      expect(buildCookieDeleteString('_ga', '/app')).toContain('path=/app')
    })
  })

  // -------------------------------------------------------------------------
  // cleanupEntry — localStorage and sessionStorage
  // -------------------------------------------------------------------------

  describe('cleanupEntry() — localStorage', () => {
    it('removes an exact-name key', () => {
      localStore.setItem('my_key', 'value')

      cleanupEntry({ id: 'prefs', name: 'my_key', type: 'localStorage' })

      expect(localStore.getItem('my_key')).toBeNull()
    })

    it('removes all keys matching a * prefix and leaves others intact', () => {
      localStore.setItem('_ga_session1', '1')
      localStore.setItem('_ga_session2', '2')
      localStore.setItem('other_key', 'keep')

      cleanupEntry({
        id: 'analytics',
        name: '_ga_*',
        type: 'localStorage',
      })

      expect(localStore.getItem('_ga_session1')).toBeNull()
      expect(localStore.getItem('_ga_session2')).toBeNull()
      expect(localStore.getItem('other_key')).toBe('keep')
    })

    it('is a no-op when the key does not exist', () => {
      expect(() => {
        cleanupEntry({ id: 'x', name: 'nonexistent', type: 'localStorage' })
      }).not.toThrow()
    })
  })

  describe('cleanupEntry() — sessionStorage', () => {
    it('removes exact-name and prefix-matched keys', () => {
      sessionStore.setItem('session_key', 'value')
      sessionStore.setItem('track_a', '1')
      sessionStore.setItem('track_b', '2')
      sessionStore.setItem('unrelated', 'keep')

      cleanupEntry({
        id: 'prefs',
        name: 'session_key',
        type: 'sessionStorage',
      })

      cleanupEntry({
        id: 'analytics',
        name: 'track_*',
        type: 'sessionStorage',
      })

      expect(sessionStore.getItem('session_key')).toBeNull()
      expect(sessionStore.getItem('track_a')).toBeNull()
      expect(sessionStore.getItem('track_b')).toBeNull()
      expect(sessionStore.getItem('unrelated')).toBe('keep')
    })
  })

  // -------------------------------------------------------------------------
  // cleanupEntry — cookie (default type when type is omitted)
  // -------------------------------------------------------------------------

  describe('cleanupEntry() — cookie (default type)', () => {
    it('writes deletion string to document.cookie for an exact name', () => {
      const cookieSetter = vi.fn()

      Object.defineProperty(document, 'cookie', {
        get: () => '_ga=abc; _gid=xyz',
        set: cookieSetter,
        configurable: true,
      })

      cleanupEntry({ id: 'analytics', name: '_ga' })

      expect(cookieSetter).toHaveBeenCalledTimes(1)

      const calls = cookieSetter.mock.calls.map(call => call[0] as string)

      expect(calls.every(call => call.startsWith('_ga='))).toBe(true)
      expect(
        calls.every(call => call.includes('expires=Thu, 01 Jan 1970')),
      ).toBe(true)
    })

    it('deletes all cookies matching a * prefix', () => {
      const cookieSetter = vi.fn()

      Object.defineProperty(document, 'cookie', {
        get: () => '_ga_abc=1; _ga_xyz=2; fb_pixel=3',
        set: cookieSetter,
        configurable: true,
      })

      cleanupEntry({ id: 'analytics', name: '_ga_*' })

      const deletedNames = cookieSetter.mock.calls
        .map(call => (call[0] as string).split('=')[0])

      expect(deletedNames).toContain('_ga_abc')
      expect(deletedNames).toContain('_ga_xyz')
      expect(deletedNames).not.toContain('fb_pixel')
    })
  })
})
