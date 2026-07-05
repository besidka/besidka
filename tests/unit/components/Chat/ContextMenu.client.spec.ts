import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageMenuInfo } from '#shared/utils/message-metadata'
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

  describe('usage info rendering', () => {
    it('renders assistant usage info with model, tools, and costs', async () => {
      const info: MessageMenuInfo = {
        role: 'assistant',
        createdAt: '2026-01-15T10:30:00.000Z',
        model: 'gpt-5.4',
        usedTools: ['web_search'],
        tokens: 1180,
        reasoningTokens: 320,
        cost: 0.0047,
        turnTotalCost: 0.0178,
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
      ).toContain('gpt-5.4')
      expect(
        wrapper.find('[data-testid="message-menu-tools"]').text(),
      ).toContain('Web search')
      expect(
        wrapper.find('[data-testid="message-menu-tokens"]').text(),
      ).toContain('1,180 output')
      expect(
        wrapper.find('[data-testid="message-menu-tokens"]').text(),
      ).toContain('320 reasoning')
      expect(
        wrapper.find('[data-testid="message-menu-cost"]').text(),
      ).toContain('$0.0047')
      expect(
        wrapper.find('[data-testid="message-menu-turn-total"]').text(),
      ).toContain('$0.0178')
      expect(
        wrapper.find('[data-testid="message-menu-datetime"]').exists(),
      ).toBe(true)
    })

    it('renders user usage info without model, tools, or turn total', async () => {
      const info: MessageMenuInfo = {
        role: 'user',
        createdAt: '2026-01-15T10:30:00.000Z',
        tokens: 5240,
        cost: 0.0131,
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
      ).toContain('5,240 input')
      expect(
        wrapper.find('[data-testid="message-menu-cost"]').text(),
      ).toContain('$0.0131')
      expect(
        wrapper.find('[data-testid="message-menu-model"]').exists(),
      ).toBe(false)
      expect(
        wrapper.find('[data-testid="message-menu-tools"]').exists(),
      ).toBe(false)
      expect(
        wrapper.find('[data-testid="message-menu-turn-total"]').exists(),
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
      expect(wrapper.text()).toContain('New chat from here')
    })
  })
})
