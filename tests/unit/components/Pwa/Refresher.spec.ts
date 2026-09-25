import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PwaRefresher from '../../../../app/components/Pwa/Refresher.client.vue'

enableAutoUnmount(afterEach)

const REFRESH_FALLBACK_DELAY_MS = 4000
const DISMISS_INTERVAL_MS = 30 * 60 * 1000

const mocks = vi.hoisted(() => ({
  updateServiceWorker: vi.fn(),
  needRefresh: true,
  getItem: vi.fn((_key: string): string | null => null),
}))

mockNuxtImport('usePWA', () => {
  return () => ({
    get needRefresh() {
      return mocks.needRefresh
    },
    updateServiceWorker: mocks.updateServiceWorker,
  })
})

mockNuxtImport('usePreferenceStorage', () => {
  return () => ({
    getItem: mocks.getItem,
    setItem: vi.fn(),
    removeItem: vi.fn(),
    flushPending: vi.fn(),
  })
})

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

function mountRefresher() {
  return mountSuspended(PwaRefresher)
}

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
}

function clearSessionStorage() {
  try {
    sessionStorage.clear()
  } catch {
    return
  }
}

describe('Pwa/Refresher', () => {
  let controllerChangeHandler: (() => void) | null
  let addEventListenerMock: ReturnType<typeof vi.fn>
  let removeEventListenerMock: ReturnType<typeof vi.fn>
  let reloadMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // `useState` is backed by a real, file-scoped Nuxt app instance under
    // this test environment (not recreated per test), so the streaming flag
    // set by one test would otherwise leak into every later one in this file.
    useState<boolean>('chat-streaming', () => false).value = false

    mocks.updateServiceWorker.mockReset()
    mocks.needRefresh = true
    mocks.getItem.mockReset()
    mocks.getItem.mockReturnValue(null)

    clearSessionStorage()
    setVisibilityState('visible')

    controllerChangeHandler = null

    addEventListenerMock = vi.fn((type: string, handler: () => void) => {
      if (type === 'controllerchange') {
        controllerChangeHandler = handler
      }
    })
    removeEventListenerMock = vi.fn()

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        addEventListener: addEventListenerMock,
        removeEventListener: removeEventListenerMock,
      },
    })

    reloadMock = vi.fn()
    vi.spyOn(window.location, 'reload').mockImplementation(reloadMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    clearSessionStorage()
  })

  it('calls updateServiceWorker on refresh click', async () => {
    const wrapper = await mountRefresher()

    await wrapper.get('button[aria-label="Refresh"]').trigger('click')

    expect(mocks.updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('reloads exactly once when controllerchange fires', async () => {
    const wrapper = await mountRefresher()

    await wrapper.get('button[aria-label="Refresh"]').trigger('click')

    expect(addEventListenerMock).toHaveBeenCalledWith(
      'controllerchange',
      expect.any(Function),
    )

    controllerChangeHandler?.()
    controllerChangeHandler?.()

    expect(reloadMock).toHaveBeenCalledTimes(1)
    expect(removeEventListenerMock).toHaveBeenCalledWith(
      'controllerchange',
      expect.any(Function),
    )
  })

  it('reloads exactly once via the fallback timer when controllerchange never fires', async () => {
    vi.useFakeTimers()

    const wrapper = await mountRefresher()

    await wrapper.get('button[aria-label="Refresh"]').trigger('click')

    vi.advanceTimersByTime(REFRESH_FALLBACK_DELAY_MS)

    expect(reloadMock).toHaveBeenCalledTimes(1)

    controllerChangeHandler?.()

    expect(reloadMock).toHaveBeenCalledTimes(1)
  })

  it('ignores the fallback timer when controllerchange fires first', async () => {
    vi.useFakeTimers()

    const wrapper = await mountRefresher()

    await wrapper.get('button[aria-label="Refresh"]').trigger('click')

    controllerChangeHandler?.()

    expect(reloadMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(REFRESH_FALLBACK_DELAY_MS)

    expect(reloadMock).toHaveBeenCalledTimes(1)
  })

  it('ignores a second click while a refresh is already pending', async () => {
    const wrapper = await mountRefresher()
    const button = wrapper.get('button[aria-label="Refresh"]')

    button.trigger('click')
    await button.trigger('click')
    await flushPromises()

    expect(mocks.updateServiceWorker).toHaveBeenCalledTimes(1)
    expect(addEventListenerMock).toHaveBeenCalledTimes(1)
  })

  it('disables the refresh button once a refresh is pending', async () => {
    const refreshButtonSelector = 'button[aria-label="Refresh"]'
    const wrapper = await mountRefresher()

    expect(wrapper.find(refreshButtonSelector).exists()).toBe(true)

    await wrapper.get(refreshButtonSelector).trigger('click')

    expect(wrapper.find(refreshButtonSelector).exists()).toBe(false)
  })

  it('does not dismiss when clicking the alert body', async () => {
    const wrapper = await mountRefresher()

    await wrapper.get('[role="alert"]').trigger('click')
    await wrapper.get('span').trigger('click')

    expect(wrapper.get('[role="alert"]').classes()).not.toContain('!hidden')
  })

  it('dismisses via the close control and re-shows after the interval', async () => {
    vi.useFakeTimers()

    const wrapper = await mountRefresher()

    await wrapper.get('button[aria-label="Hide"]').trigger('click')

    expect(wrapper.get('[role="alert"]').classes()).toContain('!hidden')

    vi.advanceTimersByTime(DISMISS_INTERVAL_MS)
    await flushPromises()

    expect(wrapper.get('[role="alert"]').classes()).not.toContain('!hidden')
  })

  it('auto-applies the update while hidden and idle', async () => {
    setVisibilityState('hidden')

    await mountRefresher()
    await flushPromises()

    expect(mocks.updateServiceWorker).toHaveBeenCalledTimes(1)
  })

  it('never auto-applies while the tab is visible', async () => {
    setVisibilityState('visible')

    await mountRefresher()
    await flushPromises()

    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()

    expect(mocks.updateServiceWorker).not.toHaveBeenCalled()
  })

  it('does not auto-apply while a chat is streaming', async () => {
    useState<boolean>('chat-streaming', () => false).value = true
    setVisibilityState('hidden')

    await mountRefresher()
    await flushPromises()

    expect(mocks.updateServiceWorker).not.toHaveBeenCalled()
  })

  it('does not auto-apply while there is unsent draft text', async () => {
    mocks.getItem.mockImplementation((key: string) => {
      return key === 'chat_input' ? 'unsent draft' : null
    })
    setVisibilityState('hidden')

    await mountRefresher()
    await flushPromises()

    expect(mocks.updateServiceWorker).not.toHaveBeenCalled()
  })

  it('guards against a second auto-apply for the same worker across a remount', async () => {
    setVisibilityState('hidden')

    const firstWrapper = await mountRefresher()
    await flushPromises()

    expect(mocks.updateServiceWorker).toHaveBeenCalledTimes(1)

    firstWrapper.unmount()

    await mountRefresher()
    await flushPromises()

    expect(mocks.updateServiceWorker).toHaveBeenCalledTimes(1)
  })
})
