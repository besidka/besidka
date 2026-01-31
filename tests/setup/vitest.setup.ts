import { vi } from 'vitest'
import { config } from '@vue/test-utils'

/**
 * Mock Nuxt auto-imports
 */
vi.mock('#app', () => ({
  useNuxtApp: vi.fn(() => ({
    $i18n: {
      t: (key: string) => key,
    },
  })),
  useState: vi.fn((key: string, init?: () => any) => {
    const state = ref(init ? init() : null)
    return state
  }),
  useRuntimeConfig: vi.fn(() => ({
    public: {
      auth: {
        redirectUserTo: '/chats/new',
        redirectGuestTo: '/signin',
      },
    },
  })),
  navigateTo: vi.fn(),
  useRequestHeaders: vi.fn(() => ({})),
  useRequestURL: vi.fn(() => new URL('http://localhost:3000')),
  reloadNuxtApp: vi.fn(),
  defineNuxtRouteMiddleware: vi.fn(middleware => middleware),
  abortNavigation: vi.fn(),
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
    forgetPassword: vi.fn(),
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
