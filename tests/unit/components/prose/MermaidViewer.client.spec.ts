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
    zoomWithWheel: vi.fn(),
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

describe('prose/MermaidViewer.client.vue', () => {
  let originalClientWidth: PropertyDescriptor | undefined
  let viewportWidth: number

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

    expect(mocks.instance.reset).toHaveBeenCalledWith({ animate: true })
    expect(wrapper.get('[data-testid="mermaid-zoom-in"]')
      .attributes('aria-label')).toBe('Zoom in')
    expect(wrapper.get('[data-testid="mermaid-zoom-out"]')
      .attributes('aria-label')).toBe('Zoom out')
    expect(wrapper.get('[data-testid="mermaid-zoom-reset"]')
      .attributes('aria-label')).toBe('Fit diagram to screen')
  })

  it('zooms with a plain wheel and prevents page scrolling', async () => {
    const wrapper = await mountViewer()

    await vi.waitFor(() => {
      expect(mocks.panzoom).toHaveBeenCalledTimes(1)
    })

    const viewport = wrapper.get('[data-testid="mermaid-viewer-viewport"]')
    const wheelEvent = new WheelEvent('wheel', {
      deltaY: -100,
      cancelable: true,
      bubbles: true,
    })

    viewport.element.dispatchEvent(wheelEvent)

    expect(mocks.instance.zoomWithWheel).toHaveBeenCalledWith(wheelEvent)
    expect(wheelEvent.defaultPrevented).toBe(true)
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
        deltaY: -100,
        cancelable: true,
      }))

      expect(mocks.instance.zoomWithWheel).not.toHaveBeenCalled()

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
        mocks.instance.getPan.mockReturnValue({ x: 5000, y: 0 })
        viewportWidth = 600
        observer.callback()
        await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS)

        expect(mocks.instance.reset).not.toHaveBeenCalled()
        expect(mocks.instance.pan).toHaveBeenCalledTimes(1)
        expect(mocks.instance.pan).toHaveBeenCalledWith(
          84,
          0,
          { animate: false },
        )
      })

    it('does not move the pan when it is already within bounds', async () => {
      const { observer } = await mountReadyViewer()

      mocks.instance.getScale.mockReturnValue(3)
      mocks.instance.getPan.mockReturnValue({ x: 10, y: 0 })
      viewportWidth = 600
      observer.callback()
      await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS)

      expect(mocks.instance.reset).not.toHaveBeenCalled()
      expect(mocks.instance.pan).not.toHaveBeenCalled()
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
