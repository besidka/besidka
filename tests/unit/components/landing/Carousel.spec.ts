import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import Carousel from '../../../../app/components/landing/Carousel.vue'

const INTERVAL_MS = 1000
const ITEMS = [
  { src: '/one.png', alt: 'One' },
  { src: '/two.png', alt: 'Two' },
  { src: '/three.png', alt: 'Three' },
  { src: '/four.png', alt: 'Four' },
]

let isDocumentHidden = false
let wrapper: VueWrapper | undefined

function changeVisibility(hidden: boolean) {
  isDocumentHidden = hidden
  document.dispatchEvent(new Event('visibilitychange'))
}

function getToggleLabel() {
  const toggle = wrapper!.find(
    'button[aria-label="Pause carousel"], button[aria-label="Play carousel"]',
  )

  return toggle.attributes('aria-label')
}

function clickToggle() {
  return wrapper!.find(
    'button[aria-label="Pause carousel"], button[aria-label="Play carousel"]',
  ).trigger('click')
}

function getActiveSlideNumber() {
  const label = wrapper!.find('button[aria-current="true"]')
    .attributes('aria-label')

  return Number(label!.replace('Go to slide ', ''))
}

async function mountCarousel() {
  wrapper = await mountSuspended(Carousel, {
    props: {
      items: ITEMS,
      autoplay: true,
      intervalMs: INTERVAL_MS,
    },
  })
}

describe('landing/Carousel.vue autoplay', () => {
  beforeEach(() => {
    isDocumentHidden = false
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => isDocumentHidden,
    })
    vi.stubGlobal('matchMedia', (query: string) => {
      return {
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, 'hidden')
  })

  it('starts playing on mount and advances slides', async () => {
    await mountCarousel()

    expect(getToggleLabel()).toBe('Pause carousel')
    expect(getActiveSlideNumber()).toBe(1)

    await vi.advanceTimersByTimeAsync(INTERVAL_MS)

    expect(getActiveSlideNumber()).toBe(2)
  })

  it('does not stack intervals on repeated visible events', async () => {
    await mountCarousel()

    changeVisibility(false)
    changeVisibility(false)

    await vi.advanceTimersByTimeAsync(INTERVAL_MS)

    expect(getActiveSlideNumber()).toBe(2)
  })

  it('stops advancing after pause even when visible fired earlier', async () => {
    await mountCarousel()

    changeVisibility(false)
    await clickToggle()

    expect(getToggleLabel()).toBe('Play carousel')

    const slideAtPause = getActiveSlideNumber()

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5)

    expect(getActiveSlideNumber()).toBe(slideAtPause)
  })

  it('keeps the toggle label in sync with the running interval', async () => {
    await mountCarousel()

    changeVisibility(false)
    changeVisibility(false)
    await clickToggle()
    await clickToggle()

    expect(getToggleLabel()).toBe('Pause carousel')

    await vi.advanceTimersByTimeAsync(INTERVAL_MS)

    expect(getActiveSlideNumber()).toBe(2)
  })

  it('resumes after hide and show when it was playing', async () => {
    await mountCarousel()

    changeVisibility(true)

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3)

    expect(getActiveSlideNumber()).toBe(1)

    changeVisibility(false)
    await wrapper!.vm.$nextTick()

    expect(getToggleLabel()).toBe('Pause carousel')

    await vi.advanceTimersByTimeAsync(INTERVAL_MS)

    expect(getActiveSlideNumber()).toBe(2)
  })

  it('keeps an explicit user pause across hide and show', async () => {
    await mountCarousel()

    await clickToggle()
    changeVisibility(true)
    changeVisibility(false)
    await wrapper!.vm.$nextTick()

    expect(getToggleLabel()).toBe('Play carousel')

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5)

    expect(getActiveSlideNumber()).toBe(1)
  })

  it('plays again after the user presses play following a pause', async () => {
    await mountCarousel()

    await clickToggle()
    changeVisibility(true)
    changeVisibility(false)
    await clickToggle()

    expect(getToggleLabel()).toBe('Pause carousel')

    await vi.advanceTimersByTimeAsync(INTERVAL_MS)

    expect(getActiveSlideNumber()).toBe(2)

    changeVisibility(true)
    changeVisibility(false)
    await wrapper!.vm.$nextTick()

    expect(getToggleLabel()).toBe('Pause carousel')
  })
})
