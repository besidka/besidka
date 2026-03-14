import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensureEditableVisible,
  openDialogWithFocus,
} from '~/composables/keyboard-aware-dialog'

describe('keyboard-aware-dialog composable', () => {
  afterEach(() => {
    vi.useRealTimers()

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: undefined,
    })
  })

  it('scrolls the dialog when the focused input is under the keyboard', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        height: 420,
        offsetTop: 0,
      },
    })

    const dialog = document.createElement('dialog')
    const modalBox = document.createElement('div')
    const input = document.createElement('input')

    modalBox.className = 'modal-box'
    dialog.appendChild(modalBox)
    modalBox.appendChild(input)

    Object.defineProperty(modalBox, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    })

    input.scrollIntoView = vi.fn()
    input.getBoundingClientRect = vi.fn(() => ({
      bottom: 470,
      top: 430,
    } as DOMRect))

    const didScroll = ensureEditableVisible(dialog, input)

    expect(didScroll).toBe(true)
    expect(modalBox.scrollTop).toBe(62)
    expect(input.scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      behavior: 'instant',
    })
  })

  it('opens the dialog and focuses the input before selecting text', async () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        addEventListener: (_: string, callback: () => void) => {
          setTimeout(callback, 0)
        },
        height: 600,
        offsetTop: 0,
        removeEventListener: vi.fn(),
      },
    })

    const dialog = {
      showModal: vi.fn(),
      querySelector: vi.fn(() => null),
    } as unknown as HTMLDialogElement
    const input = document.createElement('input')

    input.focus = vi.fn()
    input.select = vi.fn()
    input.scrollIntoView = vi.fn()
    input.getBoundingClientRect = vi.fn(() => ({
      bottom: 150,
      top: 100,
    } as DOMRect))

    const promise = openDialogWithFocus(dialog, input, {
      selectText: true,
    })

    await promise

    expect(dialog.showModal).toHaveBeenCalledTimes(1)
    expect(input.focus).toHaveBeenCalledTimes(1)
    expect(input.select).toHaveBeenCalledTimes(1)
  })
})
