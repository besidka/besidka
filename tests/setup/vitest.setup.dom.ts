import { afterEach, beforeEach, vi } from 'vitest'
import { config } from '@vue/test-utils'

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
    v: 2,
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
 * Mock MutationObserver
 *
 * happy-dom's native MutationObserver throws
 * "Cannot read private member #destroyed from an object whose class did
 * not declare it" when constructed from within a mounted component in this
 * test environment (hit by UiFormInput's 1Password-autofill workaround).
 * A minimal stub avoids the cross-realm private-field mismatch.
 */
global.MutationObserver = class MutationObserver {
  disconnect() {}
  observe() {}
  takeRecords() {
    return []
  }
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
