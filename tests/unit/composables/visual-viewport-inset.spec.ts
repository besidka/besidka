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

const MEASURED_STATES = [
  {
    name: 'Safari after a real tap',
    innerHeight: 714,
    height: 384,
    offsetTop: 0,
    scrollY: 0,
    inset: 330,
  },
  {
    name: 'standalone with the layout viewport kept',
    innerHeight: 812,
    height: 416,
    offsetTop: 0,
    scrollY: 0,
    inset: 396,
  },
  {
    name: 'standalone with the layout viewport shrunk by iOS',
    innerHeight: 416,
    height: 416,
    offsetTop: 396,
    scrollY: 396,
    inset: 0,
  },
  {
    name: 'standalone after toggling the soft keyboard with a hardware one',
    innerHeight: 620,
    height: 416,
    offsetTop: 192,
    scrollY: 192,
    inset: 204,
  },
  {
    name: 'Safari after a real tap into the search popup input',
    innerHeight: 627,
    height: 384,
    offsetTop: 87,
    scrollY: 87,
    inset: 243,
  },
] as const

function mockWindowMetrics(innerHeight: number, scrollY: number) {
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: innerHeight,
  })
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    value: scrollY,
  })
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
  const originalInnerHeight = Object.getOwnPropertyDescriptor(
    window,
    'innerHeight',
  )
  const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY')

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
    restoreWindowMetrics()
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  function restoreWindowMetrics() {
    if (originalInnerHeight) {
      Object.defineProperty(window, 'innerHeight', originalInnerHeight)
    }

    if (originalScrollY) {
      Object.defineProperty(window, 'scrollY', originalScrollY)
    } else {
      Reflect.deleteProperty(window, 'scrollY')
    }
  }

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

  it.each(MEASURED_STATES)(
    'measures $inset px for $name',
    (state) => {
      mockWindowMetrics(state.innerHeight, state.scrollY)

      const viewport = installViewport(state.innerHeight)
      const { scope, inset } = createInset()

      stopScope = () => scope.stop()

      focusTextarea()
      viewport.height = state.height
      viewport.offsetTop = state.offsetTop
      viewport.dispatchEvent(new Event('resize'))
      nextFrame()

      expect(inset.bottomInset.value).toBe(state.inset)
      expect(inset.isKeyboardOpen.value).toBe(state.inset >= 120)
    },
  )

  it('never adds height for a scrolled window without a visual pan', () => {
    mockWindowMetrics(714, 300)

    const viewport = installViewport(714)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    focusTextarea()
    viewport.height = 384
    viewport.offsetTop = 0
    viewport.dispatchEvent(new Event('resize'))
    nextFrame()

    expect(inset.bottomInset.value).toBe(330)
  })

  it('treats a negative scrollY from overscroll as no scroll', () => {
    mockWindowMetrics(714, -40)

    const viewport = installViewport(714)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    focusTextarea()
    viewport.height = 384
    viewport.offsetTop = 0
    viewport.dispatchEvent(new Event('resize'))
    nextFrame()

    expect(inset.bottomInset.value).toBe(330)
  })

  it('still counts a true visual viewport pan with no window scroll', () => {
    mockWindowMetrics(714, 0)

    const viewport = installViewport(714)
    const { scope, inset } = createInset()

    stopScope = () => scope.stop()

    focusTextarea()
    viewport.height = 384
    viewport.offsetTop = 87
    viewport.dispatchEvent(new Event('resize'))
    nextFrame()

    expect(inset.bottomInset.value).toBe(243)
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
