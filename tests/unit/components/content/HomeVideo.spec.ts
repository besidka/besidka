import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockComponent, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import HomeVideo from '../../../../app/components/content/HomeVideo.vue'

interface ObserverInstance {
  callback: IntersectionObserverCallback
  options: IntersectionObserverInit | undefined
  disconnect: ReturnType<typeof vi.fn>
}

const SCROLL_CONTAINER_CLASS = 'js-page-content'

const observers = vi.hoisted(() => {
  return [] as ObserverInstance[]
})

mockComponent('LandingVideoPlayer', () => {
  return {
    name: 'LandingVideoPlayer',
    props: ['src', 'poster', 'caption', 'markers'],
    template: '<div class="player-stub" />',
  }
})

const mountOptions = {
  props: { src: '/videos/demo.mp4', caption: 'A 54-second tour' },
}

describe('HomeVideo.vue', () => {
  let scrollContainer: HTMLElement

  beforeEach(() => {
    scrollContainer = document.createElement('div')
    scrollContainer.className = SCROLL_CONTAINER_CLASS
    document.body.append(scrollContainer)

    observers.length = 0

    class FakeIntersectionObserver {
      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        observers.push({
          callback,
          options,
          disconnect: this.disconnect,
        })
      }

      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      takeRecords = vi.fn(() => {
        return []
      })
    }

    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  })

  afterEach(() => {
    scrollContainer.remove()
    vi.unstubAllGlobals()
  })

  function mountInScrollContainer() {
    return mountSuspended(HomeVideo, {
      ...mountOptions,
      attachTo: scrollContainer,
    })
  }

  function intersect(isIntersecting: boolean) {
    for (const observer of observers) {
      observer.callback(
        [{ isIntersecting } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    }
  }

  it('renders the skeleton and no player before intersection', async () => {
    const wrapper = await mountSuspended(HomeVideo, mountOptions)

    await flushPromises()

    expect(wrapper.find('.player-stub').exists()).toBe(false)
    expect(wrapper.find('.skeleton').exists()).toBe(true)
    expect(wrapper.text()).toContain('A 54-second tour')
  })

  it('observes the section with a 300px root margin', async () => {
    await mountSuspended(HomeVideo, mountOptions)

    await flushPromises()

    expect(observers.length).toBeGreaterThan(0)
    expect(observers[0]!.options?.rootMargin).toBe('300px')
  })

  it('uses the inner page scroll container as the observer root',
    async () => {
      await mountInScrollContainer()

      await flushPromises()

      expect(observers.at(-1)!.options?.root).toBe(scrollContainer)
    })

  it('falls back to the viewport root without a scroll container',
    async () => {
      await mountSuspended(HomeVideo, mountOptions)

      await flushPromises()

      expect(observers.at(-1)!.options?.root ?? null).toBeNull()
    })

  it('disconnects the observer after the first intersection', async () => {
    await mountInScrollContainer()

    await flushPromises()

    const observer = observers.at(-1)!

    intersect(false)
    expect(observer.disconnect).not.toHaveBeenCalled()

    intersect(true)
    await flushPromises()

    expect(observer.disconnect).toHaveBeenCalledTimes(1)
  })

  it('keeps the player unmounted while the section is out of range',
    async () => {
      const wrapper = await mountSuspended(HomeVideo, mountOptions)

      await flushPromises()
      intersect(false)
      await flushPromises()

      expect(wrapper.find('.player-stub').exists()).toBe(false)
    })

  it('mounts the player once the section nears the viewport', async () => {
    const wrapper = await mountSuspended(HomeVideo, mountOptions)

    await flushPromises()
    intersect(true)
    await flushPromises()

    expect(wrapper.find('.player-stub').exists()).toBe(true)
    expect(wrapper.find('.skeleton').exists()).toBe(false)
  })

  it('stays mounted after the section leaves the viewport', async () => {
    const wrapper = await mountSuspended(HomeVideo, mountOptions)

    await flushPromises()
    intersect(true)
    await flushPromises()
    intersect(false)
    await flushPromises()

    expect(wrapper.find('.player-stub').exists()).toBe(true)
  })
})
