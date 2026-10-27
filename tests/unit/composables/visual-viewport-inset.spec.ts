import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick } from 'vue'
import {
  useVisualViewportInset,
} from '../../../app/composables/visual-viewport-inset'

type FakeViewport = EventTarget & {
  height: number
  offsetTop: number
  scale: number
}

function installViewport(height: number, offsetTop = 0): FakeViewport {
  const viewport = Object.assign(new EventTarget(), {
    height,
    offsetTop,
    scale: 1,
  })

  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: viewport,
  })

  return viewport
}

function createInset() {
  const scope = effectScope()
  const inset = scope.run(() => {
    return useVisualViewportInset()
  })

  if (!inset) {
    throw new Error('useVisualViewportInset returned nothing')
  }

  return { scope, inset }
}

describe('useVisualViewportInset', () => {
  let stopScope: (() => void) | null = null

  beforeEach(() => {
    Reflect.deleteProperty(window, 'visualViewport')
  })

  afterEach(() => {
    stopScope?.()
    stopScope = null
    Reflect.deleteProperty(window, 'visualViewport')
  })

  it('reports no inset while the visual viewport fills the window', () => {
    installViewport(window.innerHeight)

    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    expect(inset.bottomInset.value).toBe(0)
    expect(inset.isKeyboardOpen.value).toBe(false)
    expect(inset.viewportHeight.value).toBe(window.innerHeight)
  })

  it('measures the keyboard from the bottom of the visual viewport',
    async () => {
      const viewport = installViewport(window.innerHeight)
      const { scope, inset } = createInset()

      stopScope = () => scope.stop()

      viewport.height = window.innerHeight - 320
      viewport.offsetTop = 20
      viewport.dispatchEvent(new Event('resize'))
      await nextTick()

      expect(inset.bottomInset.value).toBe(300)
      expect(inset.viewportHeight.value).toBe(window.innerHeight - 320)
      expect(inset.isKeyboardOpen.value).toBe(true)
    })

  it('ignores a small toolbar-sized difference', async () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    viewport.height = window.innerHeight - 60
    viewport.dispatchEvent(new Event('scroll'))
    await nextTick()

    expect(inset.bottomInset.value).toBe(60)
    expect(inset.isKeyboardOpen.value).toBe(false)
  })

  it('lifts by the covered height below the keyboard threshold when the '
    + 'viewport is offset', async () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    viewport.height = window.innerHeight - 400
    viewport.offsetTop = 100
    viewport.dispatchEvent(new Event('scroll'))
    await nextTick()

    expect(inset.bottomInset.value).toBe(300)
    expect(inset.isKeyboardOpen.value).toBe(true)
  })

  it('does not treat a pinch-zoomed page as a keyboard', async () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    viewport.scale = 2
    viewport.height = window.innerHeight / 2
    viewport.dispatchEvent(new Event('resize'))
    await nextTick()

    expect(inset.bottomInset.value).toBe(0)
    expect(inset.isKeyboardOpen.value).toBe(false)
  })

  it('tolerates a scale of almost one', async () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    viewport.scale = 1.005
    viewport.height = window.innerHeight - 320
    viewport.dispatchEvent(new Event('resize'))
    await nextTick()

    expect(inset.bottomInset.value).toBe(320)
    expect(inset.isKeyboardOpen.value).toBe(true)
  })

  it('lifts again once the page is zoomed back out', async () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    viewport.scale = 2
    viewport.height = window.innerHeight - 320
    viewport.dispatchEvent(new Event('resize'))
    await nextTick()

    expect(inset.bottomInset.value).toBe(0)

    viewport.scale = 1
    viewport.dispatchEvent(new Event('resize'))
    await nextTick()

    expect(inset.bottomInset.value).toBe(320)
  })

  it('stops listening once its scope is disposed', async () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    scope.stop()

    viewport.height = window.innerHeight - 320
    viewport.dispatchEvent(new Event('resize'))
    viewport.dispatchEvent(new Event('scroll'))
    await nextTick()

    expect(inset.bottomInset.value).toBe(0)
    expect(inset.isKeyboardOpen.value).toBe(false)
  })

  it('falls back to the window height without a visual viewport', () => {
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    expect(inset.bottomInset.value).toBe(0)
    expect(inset.viewportHeight.value).toBe(window.innerHeight)
  })
})
