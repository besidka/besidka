import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import {
  createDoubleTapDetector,
  getWheelZoomScale,
  useImageZoom,
} from '../../../app/composables/image-zoom'
import type { ZoomPointerEvent } from '../../../app/composables/image-zoom'

const mocks = vi.hoisted(() => {
  const instance = {
    destroy: vi.fn(),
    reset: vi.fn(),
    resetStyle: vi.fn(),
    zoomToPoint: vi.fn(),
    zoom: vi.fn(),
    pan: vi.fn(),
    setOptions: vi.fn(),
    getScale: vi.fn(() => 1),
  }

  return {
    instance,
    panzoom: vi.fn(() => instance),
  }
})

vi.mock('@panzoom/panzoom', () => {
  return { default: mocks.panzoom }
})

let nextPointerId = 1

function pointer(
  overrides: Partial<ZoomPointerEvent> = {},
): ZoomPointerEvent {
  return {
    pointerId: 1,
    pointerType: 'touch',
    button: 0,
    clientX: 100,
    clientY: 100,
    timeStamp: 0,
    ...overrides,
  }
}

function tap(
  detector: ReturnType<typeof createDoubleTapDetector>,
  overrides: Partial<ZoomPointerEvent> = {},
): boolean {
  const event = pointer({ pointerId: nextPointerId++, ...overrides })

  detector.onPointerDown(event)

  return detector.onPointerUp(event)
}

describe('composables/image-zoom createDoubleTapDetector', () => {
  it('detects two quick taps in the same place', () => {
    const detector = createDoubleTapDetector()

    expect(tap(detector, { timeStamp: 0 })).toBe(false)
    expect(tap(detector, { timeStamp: 200 })).toBe(true)
  })

  it('detects a mouse double click', () => {
    const detector = createDoubleTapDetector()

    expect(tap(detector, { pointerType: 'mouse', timeStamp: 0 })).toBe(false)
    expect(tap(detector, { pointerType: 'mouse', timeStamp: 150 })).toBe(true)
  })

  it('ignores taps that are too far apart in time', () => {
    const detector = createDoubleTapDetector()

    tap(detector, { timeStamp: 0 })

    expect(tap(detector, { timeStamp: 400 })).toBe(false)
  })

  it('ignores taps that are too far apart in space', () => {
    const detector = createDoubleTapDetector()

    tap(detector, { timeStamp: 0 })

    expect(tap(detector, { timeStamp: 100, clientX: 160 })).toBe(false)
  })

  it('does not chain a third tap into another double tap', () => {
    const detector = createDoubleTapDetector()

    tap(detector, { timeStamp: 0 })
    tap(detector, { timeStamp: 100 })

    expect(tap(detector, { timeStamp: 200 })).toBe(false)
  })

  it('ignores taps whose pointer travelled like a pan', () => {
    const detector = createDoubleTapDetector()
    const first = pointer({ pointerId: 50 })

    detector.onPointerDown(first)
    detector.onPointerUp({ ...first, clientX: 200, timeStamp: 50 })

    expect(tap(detector, { timeStamp: 100, clientX: 200 })).toBe(false)
  })

  it('ignores a gesture that involved a second pointer', () => {
    const detector = createDoubleTapDetector()
    const first = pointer({ pointerId: 60, timeStamp: 0 })
    const second = pointer({ pointerId: 61, timeStamp: 10 })

    tap(detector, { timeStamp: 0 })
    detector.onPointerDown(first)
    detector.onPointerDown(second)

    expect(detector.onPointerUp({ ...first, timeStamp: 100 })).toBe(false)
    expect(detector.onPointerUp({ ...second, timeStamp: 110 })).toBe(false)
    expect(tap(detector, { timeStamp: 150 })).toBe(false)
  })

  it('ignores secondary mouse buttons', () => {
    const detector = createDoubleTapDetector()

    tap(detector, { pointerType: 'mouse', timeStamp: 0 })

    expect(tap(detector, {
      pointerType: 'mouse',
      button: 2,
      timeStamp: 100,
    })).toBe(false)
  })

  it('does not mix touch and mouse taps', () => {
    const detector = createDoubleTapDetector()

    tap(detector, { pointerType: 'touch', timeStamp: 0 })

    expect(tap(detector, { pointerType: 'mouse', timeStamp: 100 }))
      .toBe(false)
  })

  it('forgets a pending tap after a cancelled pointer', () => {
    const detector = createDoubleTapDetector()
    const cancelled = pointer({ pointerId: 70 })

    tap(detector, { timeStamp: 0 })
    detector.onPointerDown(cancelled)
    detector.onPointerCancel(cancelled)

    expect(tap(detector, { timeStamp: 100 })).toBe(false)
  })

  it('recovers when a mouse button is released outside the surface', () => {
    const detector = createDoubleTapDetector()

    detector.onPointerDown(pointer({ pointerId: 1, pointerType: 'mouse' }))

    expect(tap(detector, { pointerType: 'mouse', timeStamp: 0 })).toBe(false)
    expect(tap(detector, { pointerType: 'mouse', timeStamp: 100 })).toBe(true)
  })
})

describe('composables/image-zoom getWheelZoomScale', () => {
  it('zooms in on negative delta and out on positive delta', () => {
    const wheel = { deltaMode: 0, ctrlKey: false }

    expect(getWheelZoomScale(2, { ...wheel, deltaY: -100 })).toBeGreaterThan(2)
    expect(getWheelZoomScale(2, { ...wheel, deltaY: 100 })).toBeLessThan(2)
  })

  it('never goes below fit scale or above the maximum', () => {
    const wheel = { deltaMode: 0, ctrlKey: false }

    expect(getWheelZoomScale(1, { ...wheel, deltaY: 1000 })).toBe(1)
    expect(getWheelZoomScale(4.9, { ...wheel, deltaY: -5000 })).toBe(5)
  })

  it('treats line-based deltas as larger than pixel deltas', () => {
    const pixels = getWheelZoomScale(
      1,
      { deltaY: -3, deltaMode: 0, ctrlKey: false },
    )
    const lines = getWheelZoomScale(
      1,
      { deltaY: -3, deltaMode: 1, ctrlKey: false },
    )

    expect(lines).toBeGreaterThan(pixels)
  })

  it('is more sensitive for trackpad pinch (ctrl wheel)', () => {
    const plain = getWheelZoomScale(
      1,
      { deltaY: -5, deltaMode: 0, ctrlKey: false },
    )
    const pinch = getWheelZoomScale(
      1,
      { deltaY: -5, deltaMode: 0, ctrlKey: true },
    )

    expect(pinch).toBeGreaterThan(plain)
  })
})

function createEvent(
  type: string,
  properties: Record<string, unknown>,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })

  for (const [name, value] of Object.entries(properties)) {
    Object.defineProperty(event, name, { value })
  }

  return event
}

function dispatchTap(
  surface: HTMLElement,
  pointerId: number,
  timeStamp: number,
) {
  const properties = {
    pointerId,
    pointerType: 'touch',
    button: 0,
    clientX: 120,
    clientY: 80,
    timeStamp,
  }

  surface.dispatchEvent(createEvent('pointerdown', properties))
  surface.dispatchEvent(createEvent('pointerup', properties))
}

describe('composables/image-zoom useImageZoom', () => {
  const surface = document.createElement('div')
  const surfaceRef = shallowRef<HTMLElement | null>(surface)
  let zoom: ReturnType<typeof useImageZoom>

  const Host = defineComponent({
    setup() {
      zoom = useImageZoom(surfaceRef)

      return () => h('div')
    },
  })

  let addListenerSpy: ReturnType<typeof vi.spyOn>
  let removeListenerSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    surfaceRef.value = surface
    mocks.panzoom.mockClear()
    mocks.instance.destroy.mockClear()
    mocks.instance.reset.mockClear()
    mocks.instance.resetStyle.mockClear()
    mocks.instance.zoomToPoint.mockClear()
    mocks.instance.getScale.mockReset()
    mocks.instance.getScale.mockReturnValue(1)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    addListenerSpy = vi.spyOn(surface, 'addEventListener')
    removeListenerSpy = vi.spyOn(surface, 'removeEventListener')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('attaches the wheel and pointer listeners on setup', () => {
    const wrapper = mount(Host)

    zoom.setup()

    const attached = addListenerSpy.mock.calls.map(([type]) => type)

    expect(mocks.panzoom).toHaveBeenCalledTimes(1)
    expect(mocks.panzoom).toHaveBeenCalledWith(surface, expect.any(Object))
    expect(attached).toEqual([
      'wheel',
      'pointerdown',
      'pointerup',
      'pointercancel',
    ])
    expect(addListenerSpy).toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      { passive: false },
    )

    wrapper.unmount()
  })

  it('does nothing when there is no surface element', () => {
    surfaceRef.value = null

    const wrapper = mount(Host)

    zoom.setup()

    expect(mocks.panzoom).not.toHaveBeenCalled()
    expect(addListenerSpy).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('prevents the default wheel action and zooms toward the pointer', () => {
    const wrapper = mount(Host)

    zoom.setup()

    const zoomIn = createEvent('wheel', {
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: false,
      clientX: 40,
      clientY: 60,
    })

    surface.dispatchEvent(zoomIn)

    expect(zoomIn.defaultPrevented).toBe(true)
    expect(mocks.instance.zoomToPoint).toHaveBeenCalledTimes(1)

    const [zoomInScale, zoomInPoint] = mocks.instance.zoomToPoint.mock.calls[0]

    expect(zoomInScale).toBeGreaterThan(1)
    expect(zoomInPoint).toBe(zoomIn)

    mocks.instance.getScale.mockReturnValue(3)
    mocks.instance.zoomToPoint.mockClear()

    const zoomOut = createEvent('wheel', {
      deltaY: 100,
      deltaMode: 0,
      ctrlKey: false,
      clientX: 40,
      clientY: 60,
    })

    surface.dispatchEvent(zoomOut)

    expect(zoomOut.defaultPrevented).toBe(true)
    expect(mocks.instance.zoomToPoint.mock.calls[0][0]).toBeLessThan(3)

    wrapper.unmount()
  })

  it('toggles zoom on a touch double tap and back to fit on the next', () => {
    const wrapper = mount(Host)

    zoom.setup()

    dispatchTap(surface, 1, 0)

    expect(mocks.instance.zoomToPoint).not.toHaveBeenCalled()

    dispatchTap(surface, 2, 120)

    expect(mocks.instance.zoomToPoint).toHaveBeenCalledTimes(1)
    expect(mocks.instance.zoomToPoint).toHaveBeenCalledWith(
      2.5,
      expect.objectContaining({ clientX: 120, clientY: 80 }),
    )
    expect(mocks.instance.reset).not.toHaveBeenCalled()

    mocks.instance.getScale.mockReturnValue(2.5)

    dispatchTap(surface, 3, 1000)
    dispatchTap(surface, 4, 1120)

    expect(mocks.instance.zoomToPoint).toHaveBeenCalledTimes(1)
    expect(mocks.instance.reset).toHaveBeenCalledWith({ animate: true })

    wrapper.unmount()
  })

  it('removes every listener with the same handlers on destroy', () => {
    const wrapper = mount(Host)

    zoom.setup()
    zoom.destroy()

    expect(addListenerSpy).toHaveBeenCalledTimes(4)
    expect(removeListenerSpy).toHaveBeenCalledTimes(4)

    for (const [type, handler] of addListenerSpy.mock.calls) {
      expect(removeListenerSpy).toHaveBeenCalledWith(type, handler)
    }

    expect(mocks.instance.reset).toHaveBeenCalledWith({ animate: false })
    expect(mocks.instance.resetStyle).toHaveBeenCalledTimes(1)
    expect(mocks.instance.destroy).toHaveBeenCalledTimes(1)

    surface.dispatchEvent(createEvent('wheel', {
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: false,
      clientX: 0,
      clientY: 0,
    }))

    expect(mocks.instance.zoomToPoint).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('is safe to destroy twice', () => {
    const wrapper = mount(Host)

    zoom.setup()
    zoom.destroy()
    zoom.destroy()

    expect(removeListenerSpy).toHaveBeenCalledTimes(4)
    expect(mocks.instance.resetStyle).toHaveBeenCalledTimes(1)
    expect(mocks.instance.destroy).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('cleans up on unmount exactly once', () => {
    const wrapper = mount(Host)

    zoom.setup()
    wrapper.unmount()

    expect(removeListenerSpy).toHaveBeenCalledTimes(4)

    for (const [type, handler] of addListenerSpy.mock.calls) {
      expect(removeListenerSpy).toHaveBeenCalledWith(type, handler)
    }

    expect(mocks.instance.resetStyle).toHaveBeenCalledTimes(1)
    expect(mocks.instance.destroy).toHaveBeenCalledTimes(1)
  })

  it('rebuilds panzoom and listeners when setup runs again', () => {
    const wrapper = mount(Host)

    zoom.setup()
    zoom.setup()

    expect(mocks.panzoom).toHaveBeenCalledTimes(2)
    expect(mocks.instance.destroy).toHaveBeenCalledTimes(1)
    expect(removeListenerSpy).toHaveBeenCalledTimes(4)
    expect(addListenerSpy).toHaveBeenCalledTimes(8)

    wrapper.unmount()
  })
})
