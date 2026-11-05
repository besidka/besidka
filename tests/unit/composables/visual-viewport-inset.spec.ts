import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import {
  useVisualViewportInset,
} from '../../../app/composables/visual-viewport-inset'

type FakeViewport = EventTarget & {
  height: number
  offsetTop: number
  scale: number
}

const LAST_SETTLE_DELAY_MS = 800
const KEYBOARD_HEIGHT = 320

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

function appendField<K extends 'textarea' | 'input' | 'div'>(
  tagName: K,
  setup: (element: HTMLElementTagNameMap[K]) => void = () => {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName)

  setup(element)
  document.body.appendChild(element)

  return element
}

function focusTextarea(): HTMLTextAreaElement {
  const textarea = appendField('textarea')

  textarea.focus()

  return textarea
}

function nextFrame() {
  vi.advanceTimersToNextFrame()
}

function settle() {
  vi.advanceTimersByTime(LAST_SETTLE_DELAY_MS)
  vi.advanceTimersToNextFrame()
}

describe('useVisualViewportInset', () => {
  let stopScope: (() => void) | null = null

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    })
    Reflect.deleteProperty(window, 'visualViewport')
  })

  afterEach(() => {
    stopScope?.()
    stopScope = null
    Reflect.deleteProperty(window, 'visualViewport')
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('reports no inset while the visual viewport fills the window', () => {
    installViewport(window.innerHeight)

    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    expect(inset.bottomInset.value).toBe(0)
    expect(inset.isKeyboardOpen.value).toBe(false)
    expect(inset.viewportHeight.value).toBe(window.innerHeight)
  })

  it('measures the keyboard from the bottom of the visual viewport', () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    focusTextarea()
    viewport.height = window.innerHeight - KEYBOARD_HEIGHT
    viewport.offsetTop = 20
    viewport.dispatchEvent(new Event('resize'))
    nextFrame()

    expect(inset.bottomInset.value).toBe(300)
    expect(inset.viewportHeight.value)
      .toBe(window.innerHeight - KEYBOARD_HEIGHT)
    expect(inset.isKeyboardOpen.value).toBe(true)
  })

  it('batches several events into one reading per frame', () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    focusTextarea()
    viewport.height = window.innerHeight - KEYBOARD_HEIGHT
    viewport.dispatchEvent(new Event('resize'))
    viewport.dispatchEvent(new Event('scroll'))
    viewport.dispatchEvent(new Event('scroll'))

    expect(inset.bottomInset.value).toBe(0)

    nextFrame()

    expect(inset.bottomInset.value).toBe(KEYBOARD_HEIGHT)
  })

  it('corrects a stale offsetTop on a later settle reading '
    + '(WebKit bug 237851)', () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    focusTextarea()
    viewport.height = window.innerHeight - KEYBOARD_HEIGHT
    viewport.offsetTop = 0
    viewport.dispatchEvent(new Event('resize'))
    nextFrame()

    expect(inset.bottomInset.value).toBe(KEYBOARD_HEIGHT)

    viewport.offsetTop = 140
    vi.advanceTimersByTime(150)
    nextFrame()

    expect(inset.bottomInset.value).toBe(KEYBOARD_HEIGHT - 140)
    expect(inset.isKeyboardOpen.value).toBe(true)
  })

  it('picks up a keyboard that opens after focus without any viewport '
    + 'event', () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    focusTextarea()
    nextFrame()

    expect(inset.bottomInset.value).toBe(0)

    viewport.height = window.innerHeight - KEYBOARD_HEIGHT
    vi.advanceTimersByTime(300)
    nextFrame()

    expect(inset.bottomInset.value).toBe(KEYBOARD_HEIGHT)
  })

  it('stops re-reading once the settle schedule has run out', () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    focusTextarea()
    settle()

    viewport.height = window.innerHeight - KEYBOARD_HEIGHT
    vi.advanceTimersByTime(LAST_SETTLE_DELAY_MS)
    nextFrame()

    expect(inset.bottomInset.value).toBe(0)
  })

  it('reports no inset without a focused text field', () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    viewport.height = window.innerHeight - KEYBOARD_HEIGHT
    viewport.dispatchEvent(new Event('resize'))
    settle()

    expect(inset.bottomInset.value).toBe(0)
    expect(inset.isKeyboardOpen.value).toBe(false)
    expect(inset.viewportHeight.value)
      .toBe(window.innerHeight - KEYBOARD_HEIGHT)
  })

  it('drops the inset once the text field loses focus, even when the '
    + 'viewport values stay off', () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    const textarea = focusTextarea()

    viewport.height = window.innerHeight - KEYBOARD_HEIGHT
    viewport.dispatchEvent(new Event('resize'))
    nextFrame()

    expect(inset.isKeyboardOpen.value).toBe(true)

    textarea.blur()
    nextFrame()

    expect(inset.bottomInset.value).toBe(0)
    expect(inset.isKeyboardOpen.value).toBe(false)
  })

  it('treats text inputs and editable content as text entry', () => {
    installViewport(window.innerHeight - KEYBOARD_HEIGHT)

    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    appendField('input', (input) => {
      input.type = 'search'
    }).focus()
    nextFrame()

    expect(inset.bottomInset.value).toBe(KEYBOARD_HEIGHT)

    appendField('div', (div) => {
      div.contentEditable = 'true'
      div.tabIndex = 0
      Object.defineProperty(div, 'isContentEditable', { value: true })
    }).focus()
    nextFrame()

    expect(inset.bottomInset.value).toBe(KEYBOARD_HEIGHT)

    appendField('input', (input) => {
      input.type = 'checkbox'
    }).focus()
    nextFrame()

    expect(inset.bottomInset.value).toBe(0)

    appendField('textarea', (textarea) => {
      textarea.readOnly = true
    }).focus()
    nextFrame()

    expect(inset.bottomInset.value).toBe(0)
  })

  it('ignores a small toolbar-sized difference', () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    focusTextarea()
    viewport.height = window.innerHeight - 60
    viewport.dispatchEvent(new Event('scroll'))
    nextFrame()

    expect(inset.bottomInset.value).toBe(60)
    expect(inset.isKeyboardOpen.value).toBe(false)
  })

  it('lifts by the covered height when the viewport is offset', () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    focusTextarea()
    viewport.height = window.innerHeight - 400
    viewport.offsetTop = 100
    viewport.dispatchEvent(new Event('scroll'))
    nextFrame()

    expect(inset.bottomInset.value).toBe(300)
    expect(inset.isKeyboardOpen.value).toBe(true)
  })

  it('does not treat a pinch-zoomed page as a keyboard', () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    focusTextarea()
    viewport.scale = 2
    viewport.height = window.innerHeight / 2
    viewport.dispatchEvent(new Event('resize'))
    settle()

    expect(inset.bottomInset.value).toBe(0)
    expect(inset.isKeyboardOpen.value).toBe(false)
  })

  it('tolerates a scale of almost one', () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    focusTextarea()
    viewport.scale = 1.005
    viewport.height = window.innerHeight - KEYBOARD_HEIGHT
    viewport.dispatchEvent(new Event('resize'))
    nextFrame()

    expect(inset.bottomInset.value).toBe(KEYBOARD_HEIGHT)
    expect(inset.isKeyboardOpen.value).toBe(true)
  })

  it('lifts again once the page is zoomed back out', () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    focusTextarea()
    viewport.scale = 2
    viewport.height = window.innerHeight - KEYBOARD_HEIGHT
    viewport.dispatchEvent(new Event('resize'))
    nextFrame()

    expect(inset.bottomInset.value).toBe(0)

    viewport.scale = 1
    viewport.dispatchEvent(new Event('resize'))
    nextFrame()

    expect(inset.bottomInset.value).toBe(KEYBOARD_HEIGHT)
  })

  it('shares one instance between consumers', () => {
    const viewport = installViewport(window.innerHeight)
    const first = createInset()
    const second = createInset()

    stopScope = () => {
      first.scope.stop()
      second.scope.stop()
    }

    expect(second.inset.bottomInset).toBe(first.inset.bottomInset)
    expect(second.inset.isKeyboardOpen).toBe(first.inset.isKeyboardOpen)

    focusTextarea()
    viewport.height = window.innerHeight - KEYBOARD_HEIGHT
    viewport.dispatchEvent(new Event('resize'))
    nextFrame()

    first.scope.stop()

    expect(second.inset.bottomInset.value).toBe(KEYBOARD_HEIGHT)

    viewport.height = window.innerHeight - 400
    viewport.dispatchEvent(new Event('resize'))
    nextFrame()

    expect(second.inset.bottomInset.value).toBe(400)
  })

  it('stops listening and cancels pending readings once its scope is '
    + 'disposed', () => {
    const viewport = installViewport(window.innerHeight)
    const { scope, inset } = createInset()

    focusTextarea()
    viewport.height = window.innerHeight - KEYBOARD_HEIGHT
    viewport.dispatchEvent(new Event('resize'))

    scope.stop()

    viewport.dispatchEvent(new Event('resize'))
    viewport.dispatchEvent(new Event('scroll'))
    settle()

    expect(inset.bottomInset.value).toBe(0)
    expect(inset.isKeyboardOpen.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('falls back to the window height without a visual viewport', () => {
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    expect(inset.bottomInset.value).toBe(0)
    expect(inset.viewportHeight.value).toBe(window.innerHeight)
  })
})
