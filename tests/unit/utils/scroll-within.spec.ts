import { describe, expect, it, vi } from 'vitest'
import { scrollWithin } from '../../../app/utils/scroll-within'

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 100,
    width: 100,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}

function element(top: number, bottom: number): HTMLElement {
  const node = document.createElement('div')

  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(rect(top, bottom))

  return node
}

describe('scrollWithin', () => {
  it('scrolls the container up when the target is above the view', () => {
    const container = element(100, 400)

    container.scrollTop = 200
    scrollWithin(container, element(60, 100))

    expect(container.scrollTop).toBe(200 + (60 - 28 - 100))
  })

  it('scrolls the container down to show the trailing error', () => {
    const container = element(100, 400)

    scrollWithin(container, element(350, 390), {
      trailingElement: element(392, 410),
    })

    expect(container.scrollTop).toBe(410 + 8 - 400)
  })

  it('keeps clear of the reserved bottom area', () => {
    const container = element(100, 400)

    scrollWithin(container, element(300, 340), { reservedBottomPx: 60 })

    expect(container.scrollTop).toBe(340 + 8 - 340)
  })

  it('does not scroll when the region is already visible', () => {
    const container = element(100, 400)

    scrollWithin(container, element(200, 240))

    expect(container.scrollTop).toBe(0)
  })

  it('aligns the top when the region is taller than the view', () => {
    const container = element(100, 300)

    scrollWithin(container, element(150, 500))

    expect(container.scrollTop).toBe(150 - 28 - 100)
  })

  it('never scrolls the window', () => {
    const scrollIntoView = vi.fn()
    const windowScroll = vi.spyOn(window, 'scrollTo')
    const container = element(100, 400)
    const target = element(500, 540)

    Object.assign(target, { scrollIntoView })
    scrollWithin(container, target)

    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(windowScroll).not.toHaveBeenCalled()
  })
})
