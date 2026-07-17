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

describe('Chat/ContextMenu.client', () => {
  let anchorEl: HTMLDivElement
  let bubbleEl: HTMLDivElement
  let outsideEl: HTMLDivElement
  let originalOffsetHeight: PropertyDescriptor | undefined

  beforeEach(() => {
    vi.useFakeTimers()

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

  it('does not emit close when the quick tap happens on the bubble', async () => {
    const wrapper = await mountSuspended(ContextMenu, {
      props: {
        messageId: 'msg-1',
        anchorEl,
      },
      attachTo: document.body,
    })

    bubbleEl.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
    }))
    vi.advanceTimersByTime(100)
    bubbleEl.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
    }))

    expect(wrapper.emitted('close')).toBeUndefined()
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

  describe('positioning', () => {
    let originalInnerHeight: number
    let originalOffsetWidth: PropertyDescriptor | undefined

    beforeEach(() => {
      originalInnerHeight = window.innerHeight

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
      expect(style).toContain('right: 56px')
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
      expect(style).toContain('right: 56px')
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
      expect(style).toContain('right: 56px')
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

      expect(style).toContain('right: 56px')
      expect(style).not.toContain('left:')
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
})
