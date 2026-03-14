import { describe, expect, it } from 'vitest'
import {
  buildDeviceKeyboardPayload,
  isEditableElement,
} from '~/composables/device-keyboard'

describe('device-keyboard composable', () => {
  it('detects an open keyboard for editable inputs', () => {
    const input = document.createElement('input')

    const payload = buildDeviceKeyboardPayload({
      activeElement: input,
      focusedElementRect: {
        top: 120,
        bottom: 164,
      },
      layoutViewportHeight: 844,
      visualViewport: {
        height: 430,
        offsetTop: 0,
      },
    })

    expect(payload.isOpen).toBe(true)
    expect(payload.keyboardHeight).toBe(414)
    expect(payload.focusedElementBottom).toBe(164)
  })

  it('keeps keyboard closed for non-editable elements', () => {
    const button = document.createElement('button')

    const payload = buildDeviceKeyboardPayload({
      activeElement: button,
      layoutViewportHeight: 844,
      visualViewport: {
        height: 430,
        offsetTop: 0,
      },
    })

    expect(payload.isOpen).toBe(false)
    expect(payload.keyboardHeight).toBe(414)
  })

  it('recognizes editable content elements', () => {
    const editable = document.createElement('div')

    editable.contentEditable = 'true'

    expect(isEditableElement(editable)).toBe(true)
    expect(isEditableElement(document.createElement('input'))).toBe(true)
    expect(isEditableElement(document.createElement('button'))).toBe(false)
  })
})
