import { afterEach, beforeEach, vi } from 'vitest'
import { config } from '@vue/test-utils'
import { $fetch } from 'ofetch'

/**
 * Mock Nuxt auto-imports
 */
vi.mock('#app', () => ({
  useNuxtApp: vi.fn(() => ({
    $i18n: {
      t: (key: string) => key,
    },
    callHook: vi.fn(),
    hook: vi.fn(),
    runWithContext: (callback: () => unknown) => callback(),
  })),
  useState: vi.fn((key: string, init?: () => any) => {
    const state = ref<unknown>(init ? init() : null)

    return state
  }),
  useRuntimeConfig: vi.fn(() => ({
    public: {
      redirectUserTo: '/chats/new',
      redirectGuestTo: '/signin',
      allowedFileFormats: [
        'image/png',
        'image/jpeg',
        'image/webp',
        'application/pdf',
        'text/plain',
      ],
      maxFilesPerMessage: 10,
      maxMessageFilesBytes: 1000 * 1024 * 1024,
    },
  })),
  navigateTo: vi.fn(),
  useRequestHeaders: vi.fn(() => ({})),
  useRequestURL: vi.fn(() => new URL('http://localhost:3000')),
  reloadNuxtApp: vi.fn(),
  defineNuxtRouteMiddleware: vi.fn(middleware => middleware),
  defineNuxtPlugin: vi.fn(plugin => plugin),
  abortNavigation: vi.fn(),
}))

/**
 * Stub $fetch to allow MSW interception in tests
 */
vi.stubGlobal('$fetch', $fetch.create({
  baseURL: 'http://localhost',
}))

/**
 * Mock better-auth/vue client
 */
vi.mock('better-auth/vue', () => ({
  createAuthClient: vi.fn(() => ({
    signIn: {
      social: vi.fn(),
      email: vi.fn(),
    },
    signUp: {
      email: vi.fn(),
    },
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    getSession: vi.fn(() => Promise.resolve({ data: null })),
    $store: {
      listen: vi.fn(),
    },
    $ERROR_CODES: {
      INVALID_EMAIL: 'INVALID_EMAIL',
      INVALID_PASSWORD: 'INVALID_PASSWORD',
      USER_NOT_FOUND: 'USER_NOT_FOUND',
    },
  })),
}))

/**
 * Node 26 ships an experimental `localStorage` global that is `undefined`
 * unless `--localstorage-file` is passed. The happy-dom nuxt test env does
 * not provide one either, so any spec that calls `localStorage.clear()` (or
 * any other method) crashes. Install a Map-backed Proxy shim as a true
 * `globalThis` property (not a vi.stubGlobal stub) so it survives
 * `vi.unstubAllGlobals()` calls in individual specs. `configurable: true`
 * and `writable: true` allow per-spec `vi.stubGlobal('localStorage', ...)`
 * overrides to take effect — vitest will restore to this shim (not undefined)
 * on unstub. Because `window === globalThis` in this env, the same property
 * is also visible as `window.localStorage`.
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

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: createStorageShim(),
})

Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  writable: true,
  value: createStorageShim(),
})

/**
 * Pre-grant all cookie-consent categories so that `usePreferenceStorage`
 * writes through to real localStorage by default. Specs that need denied
 * state (e.g. preference-storage.spec.ts) override this by calling
 * `withdrawAll()` directly, which mutates the shared `useState` ref and
 * takes precedence over the initial cookie value. The cookie must be set
 * at module-load time — before any test file creates its Nuxt app instance
 * and `useCookieConsent` reads the initial state from `useCookie`.
 */
document.cookie = [
  'cookies_consent=',
  encodeURIComponent(JSON.stringify({
    v: 1,
    granted: ['necessary', 'preferences', 'analytics', 'marketing'],
    id: 'test-setup',
    date: '2026-01-01T00:00:00.000Z',
  })),
  '; path=/',
].join('')

const windowHistory = window.history
const unstubAllGlobals = vi.unstubAllGlobals.bind(vi)

function ensureHistoryGlobal() {
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: windowHistory,
  })
}

/**
 * Expose window.history as a global for vue-router web history compatibility.
 * In the nuxt test environment, window.history exists but is not mapped to the
 * bare `history` global that vue-router accesses in finalizeNavigation.
 * Re-apply it around each test because some specs call `vi.unstubAllGlobals()`
 * during teardown and CI appears to schedule router work later than local runs.
 */
ensureHistoryGlobal()

;(vi as typeof vi & { unstubAllGlobals: typeof vi.unstubAllGlobals })
  .unstubAllGlobals = () => {
    unstubAllGlobals()
    ensureHistoryGlobal()
  }

beforeEach(() => {
  ensureHistoryGlobal()
})

afterEach(() => {
  ensureHistoryGlobal()
})

/**
 * Mock IntersectionObserver
 */
global.IntersectionObserver = class IntersectionObserver {
  disconnect() {}
  observe() {}
  takeRecords() {
    return []
  }

  unobserve() {}
} as any

/**
 * Mock matchMedia for theme tests
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

/**
 * Configure Vue Test Utils
 */
config.global.stubs = {
  Teleport: true,
  NuxtLink: {
    template: '<a><slot /></a>',
  },
  ClientOnly: {
    template: '<div><slot /></div>',
  },
}

vi.stubGlobal('useErrorMessage', vi.fn())
vi.stubGlobal('useSuccessMessage', vi.fn())
vi.stubGlobal('useWarningMessage', vi.fn())

/**
 * Suppress Vue lifecycle hook warnings in tests
 * when composables are called outside component context
 */
// eslint-disable-next-line no-console
const originalWarn = console.warn
// eslint-disable-next-line no-console
console.warn = (...args: unknown[]) => {
  const message = String(args[0])

  if (message.includes('is called when there is no active'
    + ' component instance')) {
    return
  }

  originalWarn(...args)
}
