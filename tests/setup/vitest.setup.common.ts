import { vi } from 'vitest'
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

vi.mock('nuxt/server', async (importOriginal) => {
  const { withGlobalStubOverrides } = await import('./mocks/nuxt-server')

  return withGlobalStubOverrides(
    await importOriginal<Record<string, unknown>>(),
  )
})

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
 * Provide an in-memory localStorage global for Node.js 26+ compatibility.
 *
 * Node 26 introduces an experimental built-in `localStorage` that is
 * `undefined` unless `--localstorage-file` is provided. The @vite-pwa/nuxt
 * client plugin accesses `localStorage.getItem()` during Nuxt app
 * initialization (which runs in a `beforeAll` hook registered by
 * @nuxt/test-utils before any tests execute), crashing the entire worker.
 *
 * This stub is placed at the top level of the setup file so it is installed
 * synchronously before @nuxt/test-utils fires `setupNuxt()` in `beforeAll`.
 * happy-dom does expose a localStorage on `window`, but `window.localStorage`
 * is also `undefined` at this point because Node 26's experimental localStorage
 * shadows it. We create our own Storage-compatible instance instead.
 */
function createInMemoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value))
    },
    removeItem(key: string): void {
      store.delete(key)
    },
    clear(): void {
      store.clear()
    },
  }
}

const inMemoryLocalStorage = createInMemoryStorage()

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  enumerable: true,
  writable: true,
  value: inMemoryLocalStorage,
})

const unstubAllGlobals = vi.unstubAllGlobals.bind(vi)

;(vi as typeof vi & { unstubAllGlobals: typeof vi.unstubAllGlobals })
  .unstubAllGlobals = () => {
    unstubAllGlobals()

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: inMemoryLocalStorage,
    })
  }

vi.stubGlobal('useErrorMessage', vi.fn())
vi.stubGlobal('useSuccessMessage', vi.fn())
vi.stubGlobal('useWarningMessage', vi.fn())

const SUPPRESSED_WARNING_FRAGMENTS = [
  'is called when there is no active component instance',
  '[Icon] failed to load icon',
]

/**
 * Suppress warnings that are expected in the unit-test environment:
 * Vue lifecycle hooks called by composables outside a component, and
 * @nuxt/icon failing to fetch icon data because no Nitro server runs
 */
// eslint-disable-next-line no-console
const originalWarn = console.warn
// eslint-disable-next-line no-console
console.warn = (...args: unknown[]) => {
  const message = String(args[0])
  const isSuppressed = SUPPRESSED_WARNING_FRAGMENTS.some((fragment) => {
    return message.includes(fragment)
  })

  if (isSuppressed) {
    return
  }

  originalWarn(...args)
}
