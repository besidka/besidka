import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ContextMenu from '../../../../app/components/Chat/ContextMenu.client.vue'

describe('Chat/ContextMenu.client', () => {
  let anchorEl: HTMLDivElement
  let outsideEl: HTMLDivElement
  let originalOffsetHeight: PropertyDescriptor | undefined

  beforeEach(() => {
    vi.useFakeTimers()

    anchorEl = document.createElement('div')
    outsideEl = document.createElement('div')

    const bubbleEl = document.createElement('div')

    bubbleEl.className = 'js-chat-bubble'
    anchorEl.appendChild(bubbleEl)
    document.body.appendChild(anchorEl)
    document.body.appendChild(outsideEl)

    vi.spyOn(anchorEl, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 320,
      height: 80,
      top: 0,
      right: 320,
      bottom: 80,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)
    vi.spyOn(bubbleEl, 'getBoundingClientRect').mockReturnValue({
      x: 24,
      y: 16,
      width: 240,
      height: 48,
      top: 16,
      right: 264,
      bottom: 64,
      left: 24,
      toJSON: () => ({}),
    } as DOMRect)

    originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight',
    )
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return 48
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    anchorEl.remove()
    outsideEl.remove()

    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'offsetHeight',
        originalOffsetHeight,
      )
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).offsetHeight
    }
  })

  it('emits close on a quick tap outside the menu and anchor', async () => {
    const wrapper = await mountSuspended(ContextMenu, {
      props: {
        messageId: 'msg-1',
        anchorEl,
      },
      attachTo: document.body,
    })

    outsideEl.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
    }))
    vi.advanceTimersByTime(100)
    outsideEl.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
    }))

    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it('does not emit close after a long press outside the menu', async () => {
    const wrapper = await mountSuspended(ContextMenu, {
      props: {
        messageId: 'msg-1',
        anchorEl,
      },
      attachTo: document.body,
    })

    outsideEl.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
    }))
    vi.advanceTimersByTime(400)
    outsideEl.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
    }))

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('does not emit close when the quick tap happens on the anchor', async () => {
    const wrapper = await mountSuspended(ContextMenu, {
      props: {
        messageId: 'msg-1',
        anchorEl,
      },
      attachTo: document.body,
    })

    anchorEl.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
    }))
    vi.advanceTimersByTime(100)
    anchorEl.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
    }))

    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
