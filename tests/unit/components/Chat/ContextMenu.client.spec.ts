import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageMenuInfo } from '#shared/utils/message-metadata'
import { markdownToPlainText } from '#shared/utils/markdown-plain'
import ContextMenu from '../../../../app/components/Chat/ContextMenu.client.vue'
import * as messagesComposable from '../../../../app/composables/messages'

enableAutoUnmount(afterEach)

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

// happy-dom reports `isTrusted` as undefined on constructed events rather
// than the spec's `false`, so a plain dispatch already reads as "untrusted"
// by ContextMenu's own check. Tests simulating a real user click need to
// mark the event trusted explicitly to exercise the swallow-and-resolve
// path; tests simulating a third-party library's synthetic click (e.g.
// web-haptics' debug toggle) can dispatch a plain click as-is.
function dispatchTrustedClick(target: EventTarget) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })

  Object.defineProperty(event, 'isTrusted', {
    value: true,
    configurable: true,
  })
  target.dispatchEvent(event)
}

describe('Chat/ContextMenu.client', () => {
  let anchorEl: HTMLDivElement
  let bubbleEl: HTMLDivElement
  let outsideEl: HTMLDivElement
  let originalOffsetHeight: PropertyDescriptor | undefined

  beforeEach(() => {
    vi.useFakeTimers()

    useState<number>('image-preview-guard-count', () => 0).value = 0

    anchorEl = document.createElement('div')
    outsideEl = document.createElement('div')

    bubbleEl = document.createElement('div')

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
    vi.runOnlyPendingTimers()
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

  it('emits close on a quick tap on the bubble when nothing is selected', async () => {
    const wrapper = await mountSuspended(ContextMenu, {
      props: {
        messageId: 'msg-1',
        anchorEl,
      },
      attachTo: document.body,
    })

    bubbleEl.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: 100,
      clientY: 100,
    }))
    vi.advanceTimersByTime(100)
    bubbleEl.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      clientX: 100,
      clientY: 100,
    }))

    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it('does not emit close when a tap on the bubble moves past the threshold', async () => {
    const wrapper = await mountSuspended(ContextMenu, {
      props: {
        messageId: 'msg-1',
        anchorEl,
      },
      attachTo: document.body,
    })

    bubbleEl.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: 100,
      clientY: 100,
    }))
    vi.advanceTimersByTime(100)
    bubbleEl.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      clientX: 120,
      clientY: 100,
    }))

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('does not emit close when the tap results in a text selection', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
    } as Selection)

    const wrapper = await mountSuspended(ContextMenu, {
      props: {
        messageId: 'msg-1',
        anchorEl,
      },
      attachTo: document.body,
    })

    bubbleEl.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: 100,
      clientY: 100,
    }))
    vi.advanceTimersByTime(100)
    bubbleEl.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      clientX: 100,
      clientY: 100,
    }))

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('emits close on a quick tap outside the bubble even with an unrelated selection present', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
    } as Selection)

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

  it('emits close when the quick tap happens on the anchor row outside the bubble', async () => {
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

    expect(wrapper.emitted('close')).toEqual([[]])
  })

  describe('swallowed click after dismiss', () => {
    let underlyingButton: HTMLButtonElement
    let onUnderlyingClick: ReturnType<typeof vi.fn>

    beforeEach(() => {
      underlyingButton = document.createElement('button')
      onUnderlyingClick = vi.fn()

      underlyingButton.addEventListener('click', onUnderlyingClick)
      document.body.appendChild(underlyingButton)
    })

    afterEach(() => {
      underlyingButton.remove()
    })

    it('swallows a synthetic click that arrives after the dismiss tap, even past the old 100ms window', async () => {
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

      vi.advanceTimersByTime(150)
      dispatchTrustedClick(underlyingButton)

      expect(onUnderlyingClick).not.toHaveBeenCalled()
    })

    it('does not swallow a click that follows a genuinely new pointerdown', async () => {
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

      underlyingButton.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
      }))
      dispatchTrustedClick(underlyingButton)

      expect(onUnderlyingClick).toHaveBeenCalledTimes(1)
    })

    it('cancels a still-pending swallow before installing a new one', async () => {
      const addSpy = vi.spyOn(document, 'addEventListener')
      const removeSpy = vi.spyOn(document, 'removeEventListener')

      function countClickCaptureCalls(spy: typeof addSpy) {
        return spy.mock.calls.filter(([type, , options]) => {
          return type === 'click'
            && typeof options === 'object'
            && (options as AddEventListenerOptions).capture === true
        }).length
      }

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
      vi.advanceTimersByTime(50)
      outsideEl.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
      }))
      outsideEl.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
      }))

      expect(wrapper.emitted('close')).toEqual([[], []])

      dispatchTrustedClick(underlyingButton)

      expect(onUnderlyingClick).not.toHaveBeenCalled()
      expect(countClickCaptureCalls(removeSpy)).toBe(
        countClickCaptureCalls(addSpy),
      )
    })

    it('ignores an untrusted synthetic click and still swallows the real trailing click that follows it', async () => {
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

      // A third-party library (e.g. web-haptics' debug-mode toggle) can
      // dispatch an untrusted click at any time, unrelated to this dismiss
      // gesture. It must not consume the one-shot swallow meant for the
      // real trailing click.
      const unrelatedTarget = document.createElement('label')

      document.body.appendChild(unrelatedTarget)
      unrelatedTarget.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }))

      dispatchTrustedClick(underlyingButton)

      expect(onUnderlyingClick).not.toHaveBeenCalled()

      unrelatedTarget.remove()
    })
  })

  describe('positioning', () => {
    let originalInnerHeight: number
    let originalInnerWidth: number
    let originalOffsetWidth: PropertyDescriptor | undefined

    beforeEach(() => {
      originalInnerHeight = window.innerHeight
      originalInnerWidth = window.innerWidth

      originalOffsetWidth = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        'offsetWidth',
      )
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get() {
          return 256
        },
      })
    })

    afterEach(() => {
      window.innerHeight = originalInnerHeight
      window.innerWidth = originalInnerWidth

      if (originalOffsetWidth) {
        Object.defineProperty(
          HTMLElement.prototype,
          'offsetWidth',
          originalOffsetWidth,
        )
      } else {
        delete (HTMLElement.prototype as Partial<HTMLElement>).offsetWidth
      }
    })

    function setAnchorRect(rect: Partial<DOMRect>) {
      anchorEl.getBoundingClientRect = vi.fn(() => ({
        x: 0,
        y: 0,
        width: 320,
        height: 80,
        top: 0,
        right: 320,
        bottom: 80,
        left: 0,
        toJSON: () => ({}),
        ...rect,
      } as DOMRect))
    }

    function setBubbleRect(rect: Partial<DOMRect>) {
      bubbleEl.getBoundingClientRect = vi.fn(() => ({
        x: 24,
        y: 16,
        width: 240,
        height: 48,
        top: 16,
        right: 264,
        bottom: 64,
        left: 24,
        toJSON: () => ({}),
        ...rect,
      } as DOMRect))
    }

    it('anchors below the bubble when there is enough space below', async () => {
      window.innerHeight = 800

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
        },
        attachTo: document.body,
      })

      const style = wrapper.find('ul').attributes('style')

      expect(style).toContain('top: 68px')
      expect(style).toContain('right: 48px')
    })

    it('anchors above the bubble when space below is insufficient but space above fits', async () => {
      setAnchorRect({ bottom: 200 })
      setBubbleRect({ top: 120, bottom: 180 })
      window.innerHeight = 200

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
        },
        attachTo: document.body,
      })

      const style = wrapper.find('ul').attributes('style')

      expect(style).toContain('bottom: 84px')
      expect(style).toContain('right: 48px')
      expect(style).not.toContain('top:')
    })

    it('anchors near the pointer when neither side fits', async () => {
      setBubbleRect({ top: -50, bottom: 700 })
      window.innerHeight = 600

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          pointer: { x: 100, y: 300 },
        },
        attachTo: document.body,
      })

      const style = wrapper.find('ul').attributes('style')

      expect(style).toContain('top: 304px')
      expect(style).toContain('right: 48px')
    })

    it('clamps the pointer-anchored position near the bottom of the viewport', async () => {
      setBubbleRect({ top: -50, bottom: 700 })
      window.innerHeight = 600

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          pointer: { x: 100, y: 590 },
        },
        attachTo: document.body,
      })

      const style = wrapper.find('ul').attributes('style')

      expect(style).toContain('top: 536px')
    })

    it('anchors to the bottom edge when neither side fits and there is no pointer', async () => {
      setBubbleRect({ top: -50, bottom: 700 })
      window.innerHeight = 600

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
        },
        attachTo: document.body,
      })

      const style = wrapper.find('ul').attributes('style')

      expect(style).toContain('top: 536px')
    })

    it('clamps to the top edge and caps max-height when the menu is taller than the viewport', async () => {
      window.innerHeight = 60

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
        },
        attachTo: document.body,
      })

      const style = wrapper.find('ul').attributes('style')

      expect(style).toContain('top: 16px')
      expect(style).toContain('max-height: 28px')
    })

    it('falls back to right alignment when the bubble is narrower than the menu', async () => {
      setBubbleRect({ top: -50, bottom: 700 })
      window.innerHeight = 600

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          pointer: { x: 100, y: 300 },
        },
        attachTo: document.body,
      })

      const style = wrapper.find('ul').attributes('style')

      // anchorRect.right (320) - bubbleRect.right (264) = 56 unclamped, but
      // that would leave the menu's left edge only 8px from anchorRect's own
      // left edge (320 - 56 - 256 menu width = 8px), less than the 16px
      // edgeMargin every other side of this menu respects. 48px is the
      // clamped value that restores the 16px margin.
      expect(style).toContain('right: 48px')
      expect(style).not.toContain('left:')
    })

    it('clamps right alignment so a narrow bubble near the left edge does not push the menu off-screen', async () => {
      window.innerWidth = 390
      setAnchorRect({ left: 0, right: 390, width: 390 })
      setBubbleRect({ left: 16, right: 150, width: 134, top: -50, bottom: 700 })
      window.innerHeight = 600

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
        },
        attachTo: document.body,
      })

      const style = wrapper.find('ul').attributes('style')
      const rightMatch = style?.match(/right: (-?\d+(?:\.\d+)?)px/)

      expect(rightMatch).not.toBeNull()

      const right = Number(rightMatch?.[1])
      const menuLeftEdge = 390 - right - 256

      expect(menuLeftEdge).toBeGreaterThanOrEqual(16)
    })

    it('follows the pointer horizontally when the bubble is wide enough', async () => {
      setBubbleRect({ top: -50, bottom: 700, left: 0, right: 400 })
      window.innerHeight = 600

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          pointer: { x: 100, y: 300 },
        },
        attachTo: document.body,
      })

      const style = wrapper.find('ul').attributes('style')

      expect(style).toContain('left: 100px')
      expect(style).not.toContain('right:')
    })

    it('clamps the pointer near the bubble\'s right edge', async () => {
      setBubbleRect({ top: -50, bottom: 700, left: 0, right: 400 })
      window.innerHeight = 600

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          pointer: { x: 390, y: 300 },
        },
        attachTo: document.body,
      })

      const style = wrapper.find('ul').attributes('style')

      expect(style).toContain('left: 144px')
    })

    it('clamps the pointer left of the bubble', async () => {
      setBubbleRect({ top: -50, bottom: 700, left: 0, right: 400 })
      window.innerHeight = 600

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          pointer: { x: -50, y: 300 },
        },
        attachTo: document.body,
      })

      const style = wrapper.find('ul').attributes('style')

      expect(style).toContain('left: 0px')
    })
  })

  describe('text selection fade', () => {
    it('fades out and hides the menu while text is being selected', async () => {
      vi.spyOn(window, 'getSelection').mockReturnValue({
        isCollapsed: false,
      } as Selection)

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
        },
        attachTo: document.body,
      })

      document.dispatchEvent(new Event('selectionchange'))
      await wrapper.vm.$nextTick()

      const classes = wrapper.find('ul').classes()

      expect(classes).toContain('opacity-0')
      expect(classes).toContain('invisible')
      expect(classes).not.toContain('opacity-25')
      expect(classes).not.toContain('pointer-events-none')
    })

    it('restores full opacity once the selection is cleared', async () => {
      vi.spyOn(window, 'getSelection').mockReturnValue({
        isCollapsed: false,
      } as Selection)

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
        },
        attachTo: document.body,
      })

      document.dispatchEvent(new Event('selectionchange'))
      await wrapper.vm.$nextTick()

      vi.spyOn(window, 'getSelection').mockReturnValue({
        isCollapsed: true,
      } as Selection)

      document.dispatchEvent(new Event('selectionchange'))
      await wrapper.vm.$nextTick()

      const classes = wrapper.find('ul').classes()

      expect(classes).not.toContain('opacity-0')
      expect(classes).not.toContain('invisible')
      expect(classes).not.toContain('opacity-25')
      expect(classes).not.toContain('pointer-events-none')
    })
  })

  describe('branch gating', () => {
    it('hides the branch button and divider when showBranch is false', async () => {
      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          showBranch: false,
        },
        attachTo: document.body,
      })

      expect(wrapper.text()).not.toContain('Branch chat from here')
      expect(wrapper.find('hr').exists()).toBe(false)
    })

    it('shows the branch button when showBranch is omitted', async () => {
      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
        },
        attachTo: document.body,
      })

      expect(wrapper.text()).toContain('Branch chat from here')
    })

    it('renders info rows without the divider when showBranch is false', async () => {
      const info: MessageMenuInfo = {
        role: 'assistant',
        createdAt: '2026-01-15T10:30:00.000Z',
        model: 'gpt-5.4',
      }

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          info,
          showBranch: false,
        },
        attachTo: document.body,
      })

      expect(
        wrapper.find('[data-testid="message-menu-info"]').exists(),
      ).toBe(true)
      expect(wrapper.find('hr').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Branch chat from here')
    })
  })

  describe('usage info rendering', () => {
    it('renders assistant usage info with model, tools, and costs', async () => {
      const info: MessageMenuInfo = {
        role: 'assistant',
        createdAt: '2026-01-15T10:30:00.000Z',
        model: 'gpt-5.4',
        usedTools: ['web_search', 'image_generation'],
        reasoning: 'medium',
        tokens: 1180,
        reasoningTokens: 320,
        cost: 0.0047,
        costToMessage: 0.0131,
        chatTotalCost: 0.0178,
      }

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          info,
        },
        attachTo: document.body,
      })

      expect(
        wrapper.find('[data-testid="message-menu-model"]').text(),
      ).toContain('GPT-5.4')
      expect(
        wrapper.find('[data-testid="message-menu-tools"]').text(),
      ).toContain('Web search')
      expect(
        wrapper.find('[data-testid="message-menu-tools"]').text(),
      ).toContain('Image generation')
      expect(
        wrapper.find('[data-testid="message-menu-reasoning"]').text(),
      ).toContain('medium')
      expect(
        wrapper.find('[data-testid="message-menu-reasoning"]').text(),
      ).toContain('320 tokens')
      expect(
        wrapper.find('[data-testid="message-menu-tokens"]').text(),
      ).toContain('Tokens (output)')
      expect(
        wrapper.find('[data-testid="message-menu-tokens"]').text(),
      ).toContain('1,180')
      expect(
        wrapper.find('[data-testid="message-menu-cost-current"]').text(),
      ).toContain('$0.0047')
      expect(
        wrapper.find('[data-testid="message-menu-cost-to-message"]').text(),
      ).toContain('$0.0131')
      expect(
        wrapper.find('[data-testid="message-menu-cost-chat-total"]').text(),
      ).toContain('$0.0178')
      expect(
        wrapper.find('[data-testid="message-menu-datetime"]').exists(),
      ).toBe(true)
    })

    it('shows the raw model id as a tooltip on the display name', async () => {
      const info: MessageMenuInfo = {
        role: 'assistant',
        createdAt: '2026-01-15T10:30:00.000Z',
        model: 'gpt-5.4',
      }

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          info,
        },
        attachTo: document.body,
      })

      const modelRow = wrapper.get('[data-testid="message-menu-model"]')

      expect(modelRow.text()).toContain('GPT-5.4')
      expect(modelRow.get('span[title]').attributes('title')).toBe(
        'gpt-5.4',
      )
    })

    it('falls back to the raw id for an unknown model', async () => {
      const info: MessageMenuInfo = {
        role: 'assistant',
        createdAt: '2026-01-15T10:30:00.000Z',
        model: 'totally-unknown-model-id',
      }

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          info,
        },
        attachTo: document.body,
      })

      expect(
        wrapper.find('[data-testid="message-menu-model"]').text(),
      ).toContain('totally-unknown-model-id')
    })

    it('renders user usage info without model or tools', async () => {
      const info: MessageMenuInfo = {
        role: 'user',
        createdAt: '2026-01-15T10:30:00.000Z',
        tokens: 5240,
        cost: 0.0131,
        costToMessage: 0.0131,
        chatTotalCost: 0.0308,
      }

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          info,
        },
        attachTo: document.body,
      })

      expect(
        wrapper.find('[data-testid="message-menu-tokens"]').text(),
      ).toContain('Tokens (input)')
      expect(
        wrapper.find('[data-testid="message-menu-tokens"]').text(),
      ).toContain('5,240')
      expect(
        wrapper.find('[data-testid="message-menu-cost-current"]').text(),
      ).toContain('$0.0131')
      expect(
        wrapper.find('[data-testid="message-menu-cost-to-message"]').text(),
      ).toContain('$0.0131')
      expect(
        wrapper.find('[data-testid="message-menu-cost-chat-total"]').text(),
      ).toContain('$0.0308')
      expect(
        wrapper.find('[data-testid="message-menu-model"]').exists(),
      ).toBe(false)
      expect(
        wrapper.find('[data-testid="message-menu-tools"]').exists(),
      ).toBe(false)
    })

    it('renders no info block when info is omitted', async () => {
      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
        },
        attachTo: document.body,
      })

      expect(
        wrapper.find('[data-testid="message-menu-info"]').exists(),
      ).toBe(false)
      expect(wrapper.text()).toContain('Branch chat from here')
    })

    it('hides tokens and cost rows when they are unavailable', async () => {
      const info: MessageMenuInfo = {
        role: 'assistant',
        createdAt: '2026-01-15T10:30:00.000Z',
        usedTools: ['web_search'],
        tokens: undefined,
        cost: undefined,
      }

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          info,
        },
        attachTo: document.body,
      })

      expect(
        wrapper.find('[data-testid="message-menu-tokens"]').exists(),
      ).toBe(false)
      expect(
        wrapper.find('[data-testid="message-menu-cost-current"]').exists(),
      ).toBe(false)
      expect(
        wrapper.find('[data-testid="message-menu-cost-to-message"]')
          .exists(),
      ).toBe(false)
      expect(
        wrapper.find('[data-testid="message-menu-cost-chat-total"]')
          .exists(),
      ).toBe(false)
      expect(
        wrapper.find('[data-testid="message-menu-datetime"]').exists(),
      ).toBe(true)
      expect(
        wrapper.find('[data-testid="message-menu-tools"]').text(),
      ).toContain('Web search')
    })

    it('shows only the cost sub-rows that have a value', async () => {
      const info: MessageMenuInfo = {
        role: 'assistant',
        createdAt: '2026-01-15T10:30:00.000Z',
        cost: undefined,
        costToMessage: 0.02,
        chatTotalCost: undefined,
      }

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          info,
        },
        attachTo: document.body,
      })

      expect(
        wrapper.find('[data-testid="message-menu-cost-current"]').exists(),
      ).toBe(false)
      expect(
        wrapper.find('[data-testid="message-menu-cost-to-message"]').text(),
      ).toContain('$0.02')
      expect(
        wrapper.find('[data-testid="message-menu-cost-chat-total"]')
          .exists(),
      ).toBe(false)
    })
  })

  describe('deep research tool label', () => {
    it('shows the deep research label and telescope icon', async () => {
      const info: MessageMenuInfo = {
        role: 'assistant',
        createdAt: '2026-01-15T10:30:00.000Z',
        usedTools: ['deep_research'],
      }

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          info,
        },
        attachTo: document.body,
      })

      const toolsRow = wrapper.get('[data-testid="message-menu-tools"]')

      expect(toolsRow.text()).toContain('Deep research')
      expect(toolsRow.get('.iconify').classes()).toContain(
        'i-lucide:telescope',
      )
    })

    it('shows the globe icon for web_search', async () => {
      const info: MessageMenuInfo = {
        role: 'assistant',
        createdAt: '2026-01-15T10:30:00.000Z',
        usedTools: ['web_search'],
      }

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          info,
        },
        attachTo: document.body,
      })

      const toolsRow = wrapper.get('[data-testid="message-menu-tools"]')

      expect(toolsRow.text()).toContain('Web search')
      expect(toolsRow.get('.iconify').classes()).toContain('i-lucide:globe')
    })
  })

  describe('copy actions', () => {
    let originalExecCommand: typeof document.execCommand

    beforeEach(() => {
      Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: true,
      })
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          write: vi.fn().mockResolvedValue(undefined),
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      })
      vi.stubGlobal('ClipboardItem', class {
        items: Record<string, Blob>

        constructor(items: Record<string, Blob>) {
          this.items = items
        }
      })
      originalExecCommand = document.execCommand
      document.execCommand = vi.fn().mockReturnValue(false)
    })

    afterEach(() => {
      document.execCommand = originalExecCommand
      vi.unstubAllGlobals()
    })

    function findCopyButton(wrapper: VueWrapper) {
      return wrapper.find('[data-testid="message-menu-copy"]')
    }

    function findCopyMarkdownButton(wrapper: VueWrapper) {
      return wrapper.find('[data-testid="message-menu-copy-markdown"]')
    }

    it('hides the copy items when copyText is absent', async () => {
      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
        },
        attachTo: document.body,
      })

      expect(findCopyButton(wrapper).exists()).toBe(false)
      expect(findCopyMarkdownButton(wrapper).exists()).toBe(false)
    })

    it('shows the copy items when copyText is provided', async () => {
      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          copyText: '# Hello',
        },
        attachTo: document.body,
      })

      expect(findCopyButton(wrapper).exists()).toBe(true)
      expect(findCopyMarkdownButton(wrapper).exists()).toBe(true)
    })

    it('copies rich content and reverts the Copied! state after 2s', async () => {
      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          copyText: '# Hello',
        },
        attachTo: document.body,
      })

      await findCopyButton(wrapper).trigger('click')
      await flushPromises()

      expect(navigator.clipboard.write).toHaveBeenCalledTimes(1)
      expect(findCopyButton(wrapper).text()).toContain('Copied!')

      vi.advanceTimersByTime(2000)
      await wrapper.vm.$nextTick()

      expect(findCopyButton(wrapper).text()).toBe('Copy')
    })

    it('writes the plain-text flavor as transformed markdown', async () => {
      const copyText = '# Hello\n\nThis is **bold** text.'

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          copyText,
        },
        attachTo: document.body,
      })

      await findCopyButton(wrapper).trigger('click')
      await flushPromises()

      const [items] = vi.mocked(navigator.clipboard.write).mock.calls[0]
      const [item] = items as unknown as { items: Record<string, Blob> }[]
      const plainText = await item.items['text/plain'].text()

      expect(plainText).toBe(markdownToPlainText(copyText))
      expect(plainText).toBe('Hello\n\nThis is bold text.')
    })

    it('copies markdown content and reverts the Copied! state after 2s', async () => {
      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          copyText: '# Hello',
        },
        attachTo: document.body,
      })

      await findCopyMarkdownButton(wrapper).trigger('click')
      await flushPromises()

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('# Hello')
      expect(findCopyMarkdownButton(wrapper).text()).toContain('Copied!')

      vi.advanceTimersByTime(2000)
      await wrapper.vm.$nextTick()

      expect(findCopyMarkdownButton(wrapper).text())
        .toContain('Copy as Markdown')
    })

    it('shows an error message when every copy fallback fails', async () => {
      const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

      vi.mocked(navigator.clipboard.write).mockRejectedValue(
        new Error('denied'),
      )
      vi.mocked(navigator.clipboard.writeText).mockRejectedValue(
        new Error('denied'),
      )

      const wrapper = await mountSuspended(ContextMenu, {
        props: {
          messageId: 'm1',
          anchorEl,
          copyText: '# Hello',
        },
        attachTo: document.body,
      })

      await findCopyButton(wrapper).trigger('click')
      await flushPromises()

      expect(useErrorMessage).toHaveBeenCalledWith('Failed to copy message')
    })
  })

  describe('image preview guard', () => {
    function guardCount() {
      return useState<number>('image-preview-guard-count', () => 0)
    }

    it('activates the guard while mounted', async () => {
      await mountSuspended(ContextMenu, {
        props: { messageId: 'msg-1', anchorEl },
        attachTo: document.body,
      })

      expect(guardCount().value).toBe(1)
    })

    it('releases the guard on unmount when no swallow is pending', async () => {
      const wrapper = await mountSuspended(ContextMenu, {
        props: { messageId: 'msg-1', anchorEl },
        attachTo: document.body,
      })

      wrapper.unmount()

      expect(guardCount().value).toBe(0)
    })

    it('keeps the guard active across unmount while a click is being swallowed, releasing it once the click resolves', async () => {
      const wrapper = await mountSuspended(ContextMenu, {
        props: { messageId: 'msg-1', anchorEl },
        attachTo: document.body,
      })

      outsideEl.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
      }))
      vi.advanceTimersByTime(100)
      outsideEl.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
      }))

      wrapper.unmount()

      expect(guardCount().value).toBe(1)

      dispatchTrustedClick(outsideEl)

      expect(guardCount().value).toBe(0)
    })

    it('keeps the guard active across unmount until the backstop elapses', async () => {
      const wrapper = await mountSuspended(ContextMenu, {
        props: { messageId: 'msg-1', anchorEl },
        attachTo: document.body,
      })

      outsideEl.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
      }))
      vi.advanceTimersByTime(100)
      outsideEl.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
      }))

      wrapper.unmount()

      expect(guardCount().value).toBe(1)

      vi.advanceTimersByTime(501)

      expect(guardCount().value).toBe(0)
    })

    it('releases the guard synchronously on a fresh pointerdown so a legitimate click right after is not wrongly suppressed', async () => {
      const wrapper = await mountSuspended(ContextMenu, {
        props: { messageId: 'msg-1', anchorEl },
        attachTo: document.body,
      })

      outsideEl.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
      }))
      vi.advanceTimersByTime(100)
      outsideEl.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
      }))

      wrapper.unmount()

      expect(guardCount().value).toBe(1)

      const freshTarget = document.createElement('button')

      document.body.appendChild(freshTarget)

      freshTarget.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
      }))

      expect(guardCount().value).toBe(0)

      dispatchTrustedClick(freshTarget)

      expect(guardCount().value).toBe(0)

      freshTarget.remove()
    })

    it('keeps the guard active across an overlapping reselection until both the old and new instance release it', async () => {
      const wrapperA = await mountSuspended(ContextMenu, {
        props: { messageId: 'msg-a', anchorEl },
        attachTo: document.body,
      })

      outsideEl.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
      }))
      vi.advanceTimersByTime(100)
      outsideEl.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
      }))

      wrapperA.unmount()

      expect(guardCount().value).toBe(1)

      const anchorElB = document.createElement('div')
      const bubbleElB = document.createElement('div')

      bubbleElB.className = 'js-chat-bubble'
      anchorElB.appendChild(bubbleElB)
      document.body.appendChild(anchorElB)
      vi.spyOn(anchorElB, 'getBoundingClientRect')
        .mockReturnValue(anchorEl.getBoundingClientRect())
      vi.spyOn(bubbleElB, 'getBoundingClientRect')
        .mockReturnValue(bubbleEl.getBoundingClientRect())

      const wrapperB = await mountSuspended(ContextMenu, {
        props: { messageId: 'msg-b', anchorEl: anchorElB },
        attachTo: document.body,
      })

      expect(guardCount().value).toBe(2)

      dispatchTrustedClick(outsideEl)

      expect(guardCount().value).toBe(1)

      wrapperB.unmount()

      expect(guardCount().value).toBe(0)

      anchorElB.remove()
    })

    it('does not double-release the guard when a swallow resolves while still mounted and the instance unmounts afterward', async () => {
      const wrapperA = await mountSuspended(ContextMenu, {
        props: { messageId: 'msg-a', anchorEl },
        attachTo: document.body,
      })

      outsideEl.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
      }))
      vi.advanceTimersByTime(100)
      outsideEl.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
      }))

      const anchorElB = document.createElement('div')
      const bubbleElB = document.createElement('div')

      bubbleElB.className = 'js-chat-bubble'
      anchorElB.appendChild(bubbleElB)
      document.body.appendChild(anchorElB)
      vi.spyOn(anchorElB, 'getBoundingClientRect')
        .mockReturnValue(anchorEl.getBoundingClientRect())
      vi.spyOn(bubbleElB, 'getBoundingClientRect')
        .mockReturnValue(bubbleEl.getBoundingClientRect())

      const wrapperB = await mountSuspended(ContextMenu, {
        props: { messageId: 'msg-b', anchorEl: anchorElB },
        attachTo: document.body,
      })

      expect(guardCount().value).toBe(2)

      // Resolve A's swallow (its own click-capture cleanup releases the
      // guard) while A is STILL mounted, then unmount A afterward. A's
      // onUnmounted must not release a second time on top of the swallow's
      // own release — otherwise this drops to 0 and wrongly cancels B's
      // still-active suppression.
      dispatchTrustedClick(outsideEl)

      expect(guardCount().value).toBe(1)

      wrapperA.unmount()

      expect(guardCount().value).toBe(1)

      wrapperB.unmount()

      expect(guardCount().value).toBe(0)

      anchorElB.remove()
    })
  })
})
