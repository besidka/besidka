import { describe, expect, it } from 'vitest'
import {
  getFocusable,
  trapTabKey,
} from '../src/runtime/utils/focus-trap'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = document.createElement('button')

  button.textContent = label
  // happy-dom: buttons have zero layout by default; override to pass
  // the visibility check in getFocusable (offsetWidth || offsetHeight).
  Object.defineProperty(button, 'offsetWidth', {
    get: () => 50,
    configurable: true,
  })
  Object.defineProperty(button, 'offsetHeight', {
    get: () => 24,
    configurable: true,
  })
  container.appendChild(button)

  return button
}

function makeTabEvent(shiftKey = false): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  })
}

// ---------------------------------------------------------------------------

describe('focus-trap utils', () => {
  describe('getFocusable()', () => {
    it('returns all focusable buttons and excludes disabled ones', () => {
      const container = document.createElement('div')

      const enabled = addButton(container, 'enabled')
      const disabled = document.createElement('button')

      disabled.disabled = true
      Object.defineProperty(disabled, 'offsetWidth', { get: () => 50 })
      container.appendChild(disabled)

      const focusable = getFocusable(container)

      expect(focusable).toContain(enabled)
      expect(focusable).not.toContain(disabled)
    })

    it('returns empty array for a container with no focusable elements', () => {
      const container = document.createElement('div')

      container.appendChild(document.createElement('p'))

      expect(getFocusable(container)).toEqual([])
    })
  })

  describe('trapTabKey()', () => {
    it('wraps focus to first element when Tab is on the last focusable', () => {
      const container = document.createElement('div')

      document.body.appendChild(container)

      const first = addButton(container, 'first')
      const last = addButton(container, 'last')

      last.focus()

      const event = makeTabEvent(false)

      trapTabKey(event, container)

      expect(document.activeElement).toBe(first)
      expect(event.defaultPrevented).toBe(true)

      document.body.removeChild(container)
    })

    it(
      'wraps focus to last element when Shift+Tab on first or container',
      () => {
        const container = document.createElement('div')

        container.setAttribute('tabindex', '-1')
        document.body.appendChild(container)

        const first = addButton(container, 'first')
        const last = addButton(container, 'last')

        // On first element
        first.focus()
        trapTabKey(makeTabEvent(true), container)
        expect(document.activeElement).toBe(last)

        // On container itself
        container.focus()
        trapTabKey(makeTabEvent(true), container)
        expect(document.activeElement).toBe(last)

        document.body.removeChild(container)
      },
    )

    it('does not wrap focus when Tab is on a non-boundary element', () => {
      const container = document.createElement('div')

      document.body.appendChild(container)

      addButton(container, 'first')
      const middle = addButton(container, 'middle')

      addButton(container, 'last')

      middle.focus()

      const forwardEvent = makeTabEvent(false)

      trapTabKey(forwardEvent, container)
      expect(forwardEvent.defaultPrevented).toBe(false)
      expect(document.activeElement).toBe(middle)

      const backwardEvent = makeTabEvent(true)

      trapTabKey(backwardEvent, container)
      expect(backwardEvent.defaultPrevented).toBe(false)
      expect(document.activeElement).toBe(middle)

      document.body.removeChild(container)
    })

    it('is a no-op for non-Tab keys', () => {
      const container = document.createElement('div')

      document.body.appendChild(container)

      addButton(container, 'first')
      const last = addButton(container, 'last')

      last.focus()

      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      })

      trapTabKey(event, container)

      expect(document.activeElement).toBe(last)
      expect(event.defaultPrevented).toBe(false)

      document.body.removeChild(container)
    })

    it('prevents default and does not throw when no focusable elements', () => {
      const container = document.createElement('div')

      document.body.appendChild(container)

      const event = makeTabEvent()

      expect(() => trapTabKey(event, container)).not.toThrow()
      expect(event.defaultPrevented).toBe(true)

      document.body.removeChild(container)
    })
  })
})
