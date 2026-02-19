import { vi } from 'vitest'
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
