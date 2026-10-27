import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import { useScrollEdgeFade } from '../../../app/composables/scroll-edge-fade'

function createScroller(metrics: {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
}): HTMLElement {
  const element = document.createElement('div')

  Object.defineProperty(element, 'scrollHeight', {
    value: metrics.scrollHeight,
  })
  Object.defineProperty(element, 'clientHeight', {
    value: metrics.clientHeight,
  })
  element.scrollTop = metrics.scrollTop

  return element
}

describe('useScrollEdgeFade', () => {
  it('adds no mask when nothing is hidden', () => {
    const target = shallowRef<HTMLElement | null>(createScroller({
      scrollHeight: 300,
      clientHeight: 300,
      scrollTop: 0,
    }))
    const { fadeStyle, update } = useScrollEdgeFade(target)

    update()

    expect(fadeStyle.value).toEqual({})
  })

  it('fades only the bottom edge at the top of overflowing content', () => {
    const target = shallowRef<HTMLElement | null>(createScroller({
      scrollHeight: 600,
      clientHeight: 300,
      scrollTop: 0,
    }))
    const {
      fadeStyle,
      hasHiddenAbove,
      hasHiddenBelow,
      update,
    } = useScrollEdgeFade(target)

    update()

    expect(hasHiddenAbove.value).toBe(false)
    expect(hasHiddenBelow.value).toBe(true)
    expect(JSON.stringify(fadeStyle.value)).toContain('#000 0')
    expect(JSON.stringify(fadeStyle.value)).toContain('transparent 100%')
  })

  it('fades the right edge of an overflowing horizontal row', () => {
    const element = document.createElement('div')

    Object.defineProperty(element, 'scrollWidth', { value: 500 })
    Object.defineProperty(element, 'clientWidth', { value: 300 })

    const target = shallowRef<HTMLElement | null>(element)
    const { fadeStyle, hasHiddenBelow, update } = useScrollEdgeFade(
      target,
      'x',
    )

    update()

    expect(hasHiddenBelow.value).toBe(true)
    expect(JSON.stringify(fadeStyle.value)).toContain('to right')
  })

  it('fades both edges mid-scroll and only the top at the end', () => {
    const element = createScroller({
      scrollHeight: 600,
      clientHeight: 300,
      scrollTop: 150,
    })
    const target = shallowRef<HTMLElement | null>(element)
    const { hasHiddenAbove, hasHiddenBelow, update } = useScrollEdgeFade(target)

    update()

    expect(hasHiddenAbove.value).toBe(true)
    expect(hasHiddenBelow.value).toBe(true)

    element.scrollTop = 300
    update()

    expect(hasHiddenAbove.value).toBe(true)
    expect(hasHiddenBelow.value).toBe(false)
  })

  describe('content changes without a scroll event', () => {
    interface ObserverRecord {
      callback: () => void
      observed: Element[]
    }

    const resizeObservers: ObserverRecord[] = []
    const mutationObservers: ObserverRecord[] = []

    function stubObservers() {
      resizeObservers.length = 0
      mutationObservers.length = 0

      vi.stubGlobal('ResizeObserver', class {
        record: ObserverRecord

        constructor(callback: () => void) {
          this.record = { callback, observed: [] }
          resizeObservers.push(this.record)
        }

        observe(element: Element) {
          this.record.observed.push(element)
        }

        unobserve() {}
        disconnect() {
          this.record.observed = []
        }
      })
      vi.stubGlobal('MutationObserver', class {
        record: ObserverRecord

        constructor(callback: () => void) {
          this.record = { callback, observed: [] }
          mutationObservers.push(this.record)
        }

        observe(element: Element) {
          this.record.observed.push(element)
        }

        disconnect() {}
        takeRecords() {
          return []
        }
      })
    }

    function createResizableScroller() {
      const metrics = { scrollHeight: 300, clientHeight: 300 }
      const element = document.createElement('div')
      const content = document.createElement('div')

      Object.defineProperty(element, 'scrollHeight', {
        get: () => metrics.scrollHeight,
      })
      Object.defineProperty(element, 'clientHeight', {
        get: () => metrics.clientHeight,
      })
      element.append(content)

      return { element, content, metrics }
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('re-measures when a row is added or removed', async () => {
      stubObservers()

      const { element, metrics } = createResizableScroller()
      const target = shallowRef<HTMLElement | null>(element)
      const { hasHiddenBelow, update } = useScrollEdgeFade(target)

      update()

      expect(hasHiddenBelow.value).toBe(false)

      metrics.scrollHeight = 420
      mutationObservers.at(-1)?.callback()

      expect(hasHiddenBelow.value).toBe(true)

      metrics.scrollHeight = 300
      mutationObservers.at(-1)?.callback()

      expect(hasHiddenBelow.value).toBe(false)
    })

    it('observes the scroll element and its content for size changes',
      async () => {
        stubObservers()

        const { element, content, metrics } = createResizableScroller()
        const target = shallowRef<HTMLElement | null>(element)
        const { hasHiddenBelow } = useScrollEdgeFade(target)

        await nextTick()

        const observed = resizeObservers.at(-1)?.observed

        expect(observed).toContain(element)
        expect(observed).toContain(content)

        metrics.scrollHeight = 420
        resizeObservers.at(-1)?.callback()

        expect(hasHiddenBelow.value).toBe(true)
      })

    it('starts observing a content child added later', async () => {
      stubObservers()

      const { element } = createResizableScroller()
      const target = shallowRef<HTMLElement | null>(element)

      useScrollEdgeFade(target)
      await nextTick()

      const addedContent = document.createElement('div')

      element.append(addedContent)
      mutationObservers.at(-1)?.callback()
      await nextTick()

      expect(resizeObservers.at(-1)?.observed).toContain(addedContent)
    })
  })
})
