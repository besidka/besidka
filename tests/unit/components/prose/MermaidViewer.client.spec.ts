import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import MermaidViewer from '../../../../app/components/prose/MermaidViewer.client.vue'

const mocks = vi.hoisted(() => {
  const instance = {
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    reset: vi.fn(),
    destroy: vi.fn(),
    setOptions: vi.fn(),
    zoomToPoint: vi.fn(),
    pan: vi.fn(),
    getScale: vi.fn(() => 1),
    getPan: vi.fn(() => ({ x: 0, y: 0 })),
  }

  class ResizeObserverStub {
    static instances: ResizeObserverStub[] = []

    observe = vi.fn()
    disconnect = vi.fn()

    constructor(public callback: () => void) {
      ResizeObserverStub.instances.push(this)
    }
  }

  return {
    ResizeObserverStub,
    instance,
    panzoom: vi.fn(() => instance),
    renderDiagram: vi.fn(),
    runExportAction: vi.fn(),
  }
})

vi.mock('@panzoom/panzoom', () => {
  return { default: mocks.panzoom }
})

const { sanitizeDiagramSvgMock } = vi.hoisted(() => ({
  sanitizeDiagramSvgMock: vi.fn((svg: string) => svg),
}))

mockNuxtImport('sanitizeDiagramSvg', () => sanitizeDiagramSvgMock)

mockNuxtImport('useDiagramRenderer', () => {
  return () => {
    return { renderDiagram: mocks.renderDiagram }
  }
})

mockNuxtImport('useDiagramExport', () => {
  return () => {
    return { runExportAction: mocks.runExportAction }
  }
})

const SOURCE = 'flowchart LR\n  A --> B'
const SVG = '<svg id="viewer-svg" width="160" height="64"></svg>'

async function mountViewer(open: boolean = true) {
  return mountSuspended(MermaidViewer, {
    props: { open, source: SOURCE },
    global: {
      stubs: {
        teleport: true,
      },
    },
  })
}

const RESIZE_DEBOUNCE_MS = 150
const VIEWPORT_HEIGHT = 600

describe('prose/MermaidViewer.client.vue', () => {
  let originalClientWidth: PropertyDescriptor | undefined
  let viewportWidth: number
  let originalClientHeight: PropertyDescriptor | undefined

  beforeEach(() => {
    viewportWidth = 840
    mocks.ResizeObserverStub.instances = []
    vi.stubGlobal('ResizeObserver', mocks.ResizeObserverStub)
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function () {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function () {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
    originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientWidth',
    )
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => viewportWidth,
    })
    originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientHeight',
    )
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => VIEWPORT_HEIGHT,
    })
    mocks.renderDiagram.mockReset()
    mocks.renderDiagram.mockResolvedValue({ svg: SVG })
    mocks.panzoom.mockClear()

    for (const method of Object.values(mocks.instance)) {
      method.mockClear()
    }

    mocks.instance.getScale.mockReturnValue(1)
    mocks.instance.getPan.mockReturnValue({ x: 0, y: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()

    if (originalClientWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        'clientWidth',
        originalClientWidth,
      )
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
    }

    if (originalClientHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'clientHeight',
        originalClientHeight,
      )
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
    }
  })

  it('opens the dialog and renders the diagram at the body width',
    async () => {
      const wrapper = await mountViewer()

      await vi.waitFor(() => {
        expect(wrapper.find('#viewer-svg').exists()).toBe(true)
      })

      expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
      expect(wrapper.get('[data-testid="mermaid-viewer"]')
        .attributes('aria-modal')).toBe('true')
      expect(mocks.renderDiagram).toHaveBeenCalledWith(SOURCE, {
        idPrefix: expect.stringContaining('mermaid-viewer-'),
        maxWidth: 840,
      })
    })

  it('renders only the sanitized svg', async () => {
    sanitizeDiagramSvgMock.mockReturnValueOnce(
      '<svg id="viewer-clean" width="160" height="64"></svg>',
    )

    const wrapper = await mountViewer()

    await vi.waitFor(() => {
      expect(wrapper.find('#viewer-clean').exists()).toBe(true)
    })

    expect(sanitizeDiagramSvgMock).toHaveBeenCalledWith(SVG)
    expect(wrapper.find('#viewer-svg').exists()).toBe(false)
  })

  it('does not render while closed and renders once opened', async () => {
    const wrapper = await mountViewer(false)

    await flushPromises()

    expect(mocks.renderDiagram).not.toHaveBeenCalled()

    await wrapper.setProps({ open: true })

    await vi.waitFor(() => {
      expect(wrapper.find('#viewer-svg').exists()).toBe(true)
    })

    expect(mocks.renderDiagram).toHaveBeenCalledTimes(1)
  })

  it('themes the body with the pele theme class', async () => {
    const wrapper = await mountViewer()

    await vi.waitFor(() => {
      expect(wrapper.find('#viewer-svg').exists()).toBe(true)
    })

    expect(wrapper.get('[data-testid="mermaid-viewer-body"]').classes())
      .toContain('pele-theme')
  })

  it('initializes panzoom on the wrapper with a non-passive wheel listener',
    async () => {
      const wrapper = await mountViewer()

      await vi.waitFor(() => {
        expect(mocks.panzoom).toHaveBeenCalledTimes(1)
      })

      const [target, options] = mocks.panzoom.mock.calls[0] as unknown as [
        HTMLElement,
        Record<string, unknown>,
      ]

      expect(target)
        .toBe(wrapper.get('[data-testid="mermaid-viewer-target"]').element)
      expect(target.querySelector('#viewer-svg')).not.toBeNull()
      expect(options).toMatchObject({
        canvas: true,
        minScale: 0.2,
        maxScale: 8,
        touchAction: 'none',
      })
      expect(mocks.instance.reset).toHaveBeenCalledWith({ animate: false })
      expect(wrapper.get('[data-testid="mermaid-viewer-viewport"]').classes())
        .toContain('touch-none')
    })

  it('wires the zoom controls to panzoom', async () => {
    const wrapper = await mountViewer()

    await vi.waitFor(() => {
      expect(mocks.panzoom).toHaveBeenCalledTimes(1)
    })

    await wrapper.get('[data-testid="mermaid-zoom-in"]').trigger('click')

    expect(mocks.instance.zoomIn).toHaveBeenCalledTimes(1)

    await wrapper.get('[data-testid="mermaid-zoom-out"]').trigger('click')

    expect(mocks.instance.zoomOut).toHaveBeenCalledTimes(1)

    mocks.instance.reset.mockClear()

    await wrapper.get('[data-testid="mermaid-zoom-reset"]').trigger('click')

    expect(mocks.instance.reset).toHaveBeenCalledTimes(1)
    expect(mocks.instance.reset).toHaveBeenCalledWith({ animate: false })
  })

  it('renders three labelled zoom buttons with left tooltips', async () => {
    const wrapper = await mountViewer()

    await vi.waitFor(() => {
      expect(mocks.panzoom).toHaveBeenCalledTimes(1)
    })

    const buttons = wrapper.findAll('.join-vertical button')

    expect(buttons).toHaveLength(3)

    const expectations = [
      { testId: 'mermaid-zoom-in', label: 'Zoom in', icon: 'lucide:plus' },
      { testId: 'mermaid-zoom-out', label: 'Zoom out', icon: 'lucide:minus' },
      {
        testId: 'mermaid-zoom-reset',
        label: 'Fit to screen',
        icon: 'lucide:locate-fixed',
      },
    ]

    expectations.forEach((expectation, index) => {
      const button = buttons[index]!

      expect(button.attributes('data-testid')).toBe(expectation.testId)
      expect(button.attributes('aria-label')).toBe(expectation.label)
      expect(button.attributes('data-tip')).toBe(expectation.label)
      expect(button.classes()).toEqual(expect.arrayContaining([
        'btn',
        'btn-sm',
        'btn-square',
        'join-item',
        'tooltip',
        'tooltip-left',
      ]))
      expect(button.classes()).not.toContain('hitslop')
      expect(button.html()).toContain(expectation.icon)
    })
  })

  describe('wheel and gestures', () => {
    async function mountReadyViewer() {
      const wrapper = await mountViewer()

      await vi.waitFor(() => {
        expect(mocks.panzoom).toHaveBeenCalledTimes(1)
      })

      const viewport = wrapper.get('[data-testid="mermaid-viewer-viewport"]')

      return { wrapper, viewport }
    }

    function createWheelEvent(init: WheelEventInit): WheelEvent {
      const event = new WheelEvent('wheel', {
        cancelable: true,
        bubbles: true,
        ...init,
      })

      Object.defineProperties(event, {
        ctrlKey: { value: init.ctrlKey ?? false },
        clientX: { value: 300 },
        clientY: { value: 200 },
      })

      return event
    }

    it('zooms around the pointer by the size of a trackpad pinch delta',
      async () => {
        const { viewport } = await mountReadyViewer()
        const pinch = createWheelEvent({ deltaY: -10, ctrlKey: true })

        viewport.element.dispatchEvent(pinch)

        expect(mocks.instance.zoomToPoint).toHaveBeenCalledTimes(1)

        const [scale, point, options] = mocks.instance.zoomToPoint.mock
          .calls[0] as unknown as [number, WheelEvent, object]

        expect(scale).toBeCloseTo(Math.exp(0.1), 5)
        expect(point).toBe(pinch)
        expect(options).toEqual({ animate: false })
        expect(mocks.instance.pan).not.toHaveBeenCalled()
        expect(pinch.defaultPrevented).toBe(true)
      })

    it('zooms out for a positive pinch delta and scales from the zoom',
      async () => {
        const { viewport } = await mountReadyViewer()

        mocks.instance.getScale.mockReturnValue(2)
        viewport.element.dispatchEvent(
          createWheelEvent({ deltaY: 5, ctrlKey: true }),
        )

        const [scale] = mocks.instance.zoomToPoint.mock
          .calls[0] as unknown as [number]

        expect(scale).toBeCloseTo(2 * Math.exp(-0.05), 5)
      })

    it('pans with a two-finger swipe instead of zooming', async () => {
      const { viewport } = await mountReadyViewer()
      const swipe = createWheelEvent({ deltaX: 20, deltaY: 40 })

      mocks.instance.getScale.mockReturnValue(2)
      mocks.instance.getPan.mockReturnValue({ x: 210, y: 150 })
      viewport.element.dispatchEvent(swipe)

      expect(mocks.instance.zoomToPoint).not.toHaveBeenCalled()
      expect(mocks.instance.pan).toHaveBeenCalledWith(
        200,
        130,
        { animate: false },
      )
      expect(swipe.defaultPrevented).toBe(true)
    })

    it('keeps a swiped diagram within reach of the viewport', async () => {
      const { viewport } = await mountReadyViewer()

      mocks.instance.getScale.mockReturnValue(1)
      mocks.instance.getPan.mockReturnValue({ x: 420, y: 300 })
      viewport.element.dispatchEvent(createWheelEvent({ deltaX: -5000 }))

      expect(mocks.instance.pan).toHaveBeenCalledWith(
        420 + 372,
        300,
        { animate: false },
      )
    })

    it('zooms one fixed step per mouse wheel notch', async () => {
      const { viewport } = await mountReadyViewer()

      viewport.element.dispatchEvent(
        createWheelEvent({ deltaY: -3, deltaMode: 1 }),
      )
      viewport.element.dispatchEvent(
        createWheelEvent({ deltaY: 3, deltaMode: 1 }),
      )

      const scales = mocks.instance.zoomToPoint.mock.calls.map((call) => {
        return call[0] as number
      })

      expect(scales[0]).toBeCloseTo(Math.exp(0.1), 5)
      expect(scales[1]).toBeCloseTo(Math.exp(-0.1), 5)
      expect(mocks.instance.pan).not.toHaveBeenCalled()
    })

    it('zooms around the pointer for a Safari trackpad pinch', async () => {
      const { viewport } = await mountReadyViewer()
      const start = new Event('gesturestart', { cancelable: true })
      const firstChange = Object.assign(
        new Event('gesturechange', { cancelable: true }),
        { scale: 1.1, clientX: 40, clientY: 50 },
      )
      const secondChange = Object.assign(
        new Event('gesturechange', { cancelable: true }),
        { scale: 1.21, clientX: 40, clientY: 50 },
      )

      mocks.instance.getScale.mockReturnValue(1)
      viewport.element.dispatchEvent(start)
      viewport.element.dispatchEvent(firstChange)
      mocks.instance.getScale.mockReturnValue(1.1)
      viewport.element.dispatchEvent(secondChange)

      const scales = mocks.instance.zoomToPoint.mock.calls.map((call) => {
        return call[0] as number
      })

      expect(scales[0]).toBeCloseTo(1.1, 5)
      expect(scales[1]).toBeCloseTo(1.21, 5)
      expect(mocks.instance.zoomToPoint.mock.calls[0]?.[1]).toBe(firstChange)
      expect(start.defaultPrevented).toBe(true)
      expect(firstChange.defaultPrevented).toBe(true)
    })

    it('anchors the diagram to the viewport corner for pointer zoom',
      async () => {
        const { wrapper } = await mountReadyViewer()
        const viewport = wrapper.get('[data-testid="mermaid-viewer-viewport"]')
        const target = wrapper.get('[data-testid="mermaid-viewer-target"]')

        expect(viewport.classes()).not.toContain('flex')
        expect(target.classes()).toEqual(expect.arrayContaining([
          'absolute',
          'left-0',
          'top-0',
        ]))
      })

    it('centres the fitted diagram with the start pan', async () => {
      await mountReadyViewer()

      expect(mocks.instance.setOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          startX: viewportWidth / 2,
          startY: VIEWPORT_HEIGHT / 2,
        }),
      )
    })
  })

  it('destroys panzoom and restores focus when the dialog closes',
    async () => {
      const trigger = document.createElement('button')

      document.body.append(trigger)
      trigger.focus()

      const wrapper = await mountViewer(false)

      await wrapper.setProps({ open: true })

      await vi.waitFor(() => {
        expect(mocks.panzoom).toHaveBeenCalledTimes(1)
      })

      const viewport = wrapper.get('[data-testid="mermaid-viewer-viewport"]')

      await wrapper.setProps({ open: false })
      await flushPromises()

      expect(mocks.instance.destroy).toHaveBeenCalledTimes(1)
      expect(wrapper.emitted('update:open')).toBeUndefined()
      expect(document.activeElement).toBe(trigger)

      viewport.element.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -10,
        ctrlKey: true,
        cancelable: true,
      }))

      expect(mocks.instance.zoomToPoint).not.toHaveBeenCalled()

      trigger.remove()
    })

  it('reports a native close back through v-model', async () => {
    const wrapper = await mountViewer()

    await vi.waitFor(() => {
      expect(mocks.panzoom).toHaveBeenCalledTimes(1)
    })

    wrapper.get('[data-testid="mermaid-viewer"]')
      .element.dispatchEvent(new Event('close'))
    await flushPromises()

    expect(wrapper.emitted('update:open')).toEqual([[false]])
    expect(mocks.instance.destroy).toHaveBeenCalledTimes(1)
  })

  it('destroys panzoom when unmounted while open', async () => {
    const wrapper = await mountViewer()

    await vi.waitFor(() => {
      expect(mocks.panzoom).toHaveBeenCalledTimes(1)
    })

    wrapper.unmount()

    expect(mocks.instance.destroy).toHaveBeenCalled()
  })

  it('shows the render error and skips panzoom when rendering fails',
    async () => {
      mocks.renderDiagram.mockResolvedValue({
        error: { message: 'Bad syntax' },
      })

      const wrapper = await mountViewer()

      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="mermaid-viewer-error"]').exists())
          .toBe(true)
      })

      expect(wrapper.get('[data-testid="mermaid-viewer-error"]').text())
        .toBe('Bad syntax')
      expect(mocks.panzoom).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="mermaid-zoom-in"]').exists())
        .toBe(false)
    })

  it('offers the download and copy menus built from the viewer svg',
    async () => {
      const wrapper = await mountViewer()

      await vi.waitFor(() => {
        expect(mocks.panzoom).toHaveBeenCalledTimes(1)
      })

      expect(wrapper.find('[data-testid="mermaid-export"]').exists())
        .toBe(false)
      expect(wrapper.get('[data-testid="mermaid-download"]').text())
        .toContain('Download')
      expect(wrapper.get('[data-testid="mermaid-copy"]').text())
        .toContain('Copy')

      const themeElement = wrapper.get('[data-testid="mermaid-viewer-body"]')
        .element

      for (const action of [
        'download-svg',
        'download-png',
        'download-drawio',
        'copy-source',
        'copy-markdown',
        'copy-svg',
        'copy-drawio',
      ]) {
        await wrapper.get(`[data-testid="mermaid-export-${action}"]`)
          .trigger('click')

        expect(mocks.runExportAction).toHaveBeenLastCalledWith(action, {
          source: SOURCE,
          svg: SVG,
          themeElement,
        })
      }
    })

  it('restores focus only after the next render so a hidden trigger is visible',
    async () => {
      const trigger = document.createElement('button')

      document.body.append(trigger)
      trigger.focus()

      const focusSpy = vi.spyOn(trigger, 'focus')
      const wrapper = await mountViewer(false)

      await wrapper.setProps({ open: true })

      await vi.waitFor(() => {
        expect(mocks.panzoom).toHaveBeenCalledTimes(1)
      })

      focusSpy.mockClear()
      wrapper.get('[data-testid="mermaid-viewer"]')
        .element.dispatchEvent(new Event('close'))

      expect(focusSpy).not.toHaveBeenCalled()

      await nextTick()

      expect(focusSpy).toHaveBeenCalledTimes(1)

      trigger.remove()
    })

  describe('viewport resize', () => {
    async function mountReadyViewer() {
      const wrapper = await mountViewer()

      await vi.waitFor(() => {
        expect(mocks.panzoom).toHaveBeenCalledTimes(1)
      })

      const observer = mocks.ResizeObserverStub.instances[0]!

      mocks.instance.reset.mockClear()
      vi.useFakeTimers()

      return { wrapper, observer }
    }

    it('observes the viewport once panzoom is ready', async () => {
      const { wrapper, observer } = await mountReadyViewer()

      expect(mocks.ResizeObserverStub.instances).toHaveLength(1)
      expect(observer.observe).toHaveBeenCalledWith(
        wrapper.get('[data-testid="mermaid-viewer-viewport"]').element,
      )
    })

    it('refits after a debounced resize while the user has not zoomed',
      async () => {
        const { observer } = await mountReadyViewer()

        viewportWidth = 600
        observer.callback()
        observer.callback()

        expect(mocks.instance.reset).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS)

        expect(mocks.instance.reset).toHaveBeenCalledTimes(1)
        expect(mocks.instance.reset).toHaveBeenCalledWith({ animate: false })
        expect(mocks.instance.pan).not.toHaveBeenCalled()
      })

    it('ignores a resize that leaves the viewport size unchanged',
      async () => {
        const { observer } = await mountReadyViewer()

        observer.callback()
        await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS)

        expect(mocks.instance.reset).not.toHaveBeenCalled()
        expect(mocks.instance.pan).not.toHaveBeenCalled()
      })

    it('keeps the user zoom and only clamps the pan after a resize',
      async () => {
        const { observer } = await mountReadyViewer()

        mocks.instance.getScale.mockReturnValue(3)
        mocks.instance.getPan.mockReturnValue({ x: 5140, y: 100 })
        viewportWidth = 600
        observer.callback()
        await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS)

        expect(mocks.instance.reset).not.toHaveBeenCalled()
        expect(mocks.instance.pan).toHaveBeenCalledTimes(1)
        expect(mocks.instance.pan).toHaveBeenCalledWith(
          184,
          100,
          { animate: false },
        )
      })

    it('keeps the view offset from the centre when the viewport shrinks',
      async () => {
        const { observer } = await mountReadyViewer()

        mocks.instance.getScale.mockReturnValue(3)
        mocks.instance.getPan.mockReturnValue({ x: 150, y: 100 })
        viewportWidth = 600
        observer.callback()
        await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS)

        expect(mocks.instance.reset).not.toHaveBeenCalled()
        expect(mocks.instance.pan).toHaveBeenCalledWith(
          110,
          100,
          { animate: false },
        )
      })

    it('disconnects the observer when the dialog closes', async () => {
      const { wrapper, observer } = await mountReadyViewer()

      vi.useRealTimers()
      await wrapper.setProps({ open: false })
      await flushPromises()

      expect(observer.disconnect).toHaveBeenCalledTimes(1)
    })

    it('disconnects the observer when unmounted and ignores late callbacks',
      async () => {
        const { wrapper, observer } = await mountReadyViewer()

        viewportWidth = 600
        observer.callback()
        wrapper.unmount()
        await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS)

        expect(observer.disconnect).toHaveBeenCalled()
        expect(mocks.instance.reset).not.toHaveBeenCalled()
      })
  })
})
