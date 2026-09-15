import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PwaRefresher from '../../../../app/components/Pwa/Refresher.client.vue'

enableAutoUnmount(afterEach)

const REFRESH_FALLBACK_DELAY_MS = 4000

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

function mountRefresher(updateServiceWorker: ReturnType<typeof vi.fn>) {
  return mountSuspended(PwaRefresher, {
    global: {
      mocks: {
        $pwa: { updateServiceWorker },
      },
    },
  })
}

describe('Pwa/Refresher', () => {
  let updateServiceWorker: ReturnType<typeof vi.fn>
  let controllerChangeHandler: (() => void) | null
  let addEventListenerMock: ReturnType<typeof vi.fn>
  let removeEventListenerMock: ReturnType<typeof vi.fn>
  let reloadMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    updateServiceWorker = vi.fn()
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
  })

  it('calls updateServiceWorker on refresh click', async () => {
    const wrapper = await mountRefresher(updateServiceWorker)

    await wrapper.get('button').trigger('click')

    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('reloads exactly once when controllerchange fires', async () => {
    const wrapper = await mountRefresher(updateServiceWorker)

    await wrapper.get('button').trigger('click')

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

    const wrapper = await mountRefresher(updateServiceWorker)

    await wrapper.get('button').trigger('click')

    vi.advanceTimersByTime(REFRESH_FALLBACK_DELAY_MS)

    expect(reloadMock).toHaveBeenCalledTimes(1)

    controllerChangeHandler?.()

    expect(reloadMock).toHaveBeenCalledTimes(1)
  })

  it('ignores the fallback timer when controllerchange fires first', async () => {
    vi.useFakeTimers()

    const wrapper = await mountRefresher(updateServiceWorker)

    await wrapper.get('button').trigger('click')

    controllerChangeHandler?.()

    expect(reloadMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(REFRESH_FALLBACK_DELAY_MS)

    expect(reloadMock).toHaveBeenCalledTimes(1)
  })

  it('ignores a second click while a refresh is already pending', async () => {
    const wrapper = await mountRefresher(updateServiceWorker)
    const button = wrapper.get('button')

    button.trigger('click')
    await button.trigger('click')
    await flushPromises()

    expect(updateServiceWorker).toHaveBeenCalledTimes(1)
    expect(addEventListenerMock).toHaveBeenCalledTimes(1)
  })

  it('disables the refresh button once a refresh is pending', async () => {
    const refreshButtonSelector = 'button[aria-label="Refresh"]'
    const wrapper = await mountRefresher(updateServiceWorker)

    expect(wrapper.find(refreshButtonSelector).exists()).toBe(true)

    await wrapper.get(refreshButtonSelector).trigger('click')

    expect(wrapper.find(refreshButtonSelector).exists()).toBe(false)
  })
})
