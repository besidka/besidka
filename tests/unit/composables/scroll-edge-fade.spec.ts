import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'
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
})
