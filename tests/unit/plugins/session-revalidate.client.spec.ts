import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import plugin from '../../../app/plugins/session-revalidate.client'

const mocks = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  session: { value: null as unknown },
  loggedIn: { value: false },
  options: { redirectGuestTo: '/signin' },
  routeAuth: { only: 'user' } as unknown,
  navigateTo: vi.fn(),
}))

mockNuxtImport('useAuth', () => {
  return () => ({
    fetchSession: mocks.fetchSession,
    session: mocks.session,
    loggedIn: mocks.loggedIn,
    options: mocks.options,
  })
})

mockNuxtImport('useRoute', () => {
  return () => ({ meta: { auth: mocks.routeAuth } })
})

mockNuxtImport('navigateTo', () => mocks.navigateTo)

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('session-revalidate plugin', () => {
  let visibilityHandler: (() => void) | null = null

  beforeEach(() => {
    visibilityHandler = null
    mocks.fetchSession.mockReset()
    mocks.navigateTo.mockReset()
    mocks.session.value = { id: 'live' }
    mocks.loggedIn.value = true
    mocks.routeAuth = { only: 'user' }

    vi.spyOn(document, 'addEventListener').mockImplementation((type, handler) => {
      if (type === 'visibilitychange') {
        visibilityHandler = handler as () => void
      }
    })
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {})
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function install() {
    plugin({ runWithContext: (fn: () => unknown) => fn() } as never)
  }

  it('redirects to the guest route when the session is authoritatively gone', async () => {
    mocks.fetchSession.mockImplementation(async () => {
      mocks.session.value = null
    })

    install()
    visibilityHandler?.()
    await flushPromises()

    expect(mocks.fetchSession).toHaveBeenCalledWith({
      disableCookieCache: true,
    })
    expect(mocks.navigateTo).toHaveBeenCalledWith('/signin')
  })

  it('does not redirect when a transient failure leaves the session intact', async () => {
    mocks.fetchSession.mockResolvedValue(undefined)

    install()
    visibilityHandler?.()
    await flushPromises()

    expect(mocks.fetchSession).toHaveBeenCalled()
    expect(mocks.navigateTo).not.toHaveBeenCalled()
  })

  it('does nothing when the user is not logged in', async () => {
    mocks.loggedIn.value = false

    install()
    visibilityHandler?.()
    await flushPromises()

    expect(mocks.fetchSession).not.toHaveBeenCalled()
  })

  it('does not redirect on routes that are not user-only', async () => {
    mocks.routeAuth = { only: 'guest' }
    mocks.fetchSession.mockImplementation(async () => {
      mocks.session.value = null
    })

    install()
    visibilityHandler?.()
    await flushPromises()

    expect(mocks.navigateTo).not.toHaveBeenCalled()
  })

  it('throttles repeated revalidations within the interval', async () => {
    mocks.fetchSession.mockResolvedValue(undefined)

    install()
    visibilityHandler?.()
    visibilityHandler?.()
    await flushPromises()

    expect(mocks.fetchSession).toHaveBeenCalledTimes(1)
  })
})
