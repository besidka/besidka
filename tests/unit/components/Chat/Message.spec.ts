import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Message from '../../../../app/components/Chat/Message.vue'

describe('Chat/Message', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('onPointerDown', () => {
    it('emits select after 500ms long-press when anySelected is false', async () => {
      const wrapper = await mountSuspended(Message, {
        props: {
          role: 'assistant',
          messageId: 'msg-1',
          isSelected: false,
          anySelected: false,
        },
      })

      await wrapper.trigger('pointerdown', {
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      })

      expect(wrapper.emitted('select')).toBeUndefined()

      vi.advanceTimersByTime(500)

      expect(wrapper.emitted('select')).toEqual([
        ['msg-1', { x: 100, y: 100 }],
      ])
    })

    it('emits select after long-press when anySelected is true but isSelected is false', async () => {
      const wrapper = await mountSuspended(Message, {
        props: {
          role: 'assistant',
          messageId: 'msg-1',
          isSelected: false,
          anySelected: true,
        },
      })

      await wrapper.trigger('pointerdown', {
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      })

      vi.advanceTimersByTime(600)

      expect(wrapper.emitted('select')).toEqual([
        ['msg-1', { x: 100, y: 100 }],
      ])
    })

    it('does not emit select for mouse pointer type', async () => {
      const wrapper = await mountSuspended(Message, {
        props: {
          role: 'assistant',
          messageId: 'msg-1',
          isSelected: false,
          anySelected: false,
        },
      })

      await wrapper.trigger('pointerdown', {
        pointerType: 'mouse',
        clientX: 100,
        clientY: 100,
      })

      vi.advanceTimersByTime(600)

      expect(wrapper.emitted('select')).toBeUndefined()
    })

    it('cancels long-press on pointer move > 8px', async () => {
      const wrapper = await mountSuspended(Message, {
        props: {
          role: 'assistant',
          messageId: 'msg-1',
          isSelected: false,
          anySelected: false,
        },
      })

      await wrapper.trigger('pointerdown', {
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      })

      await wrapper.trigger('pointermove', {
        pointerType: 'touch',
        clientX: 115,
        clientY: 100,
      })

      vi.advanceTimersByTime(600)

      expect(wrapper.emitted('select')).toBeUndefined()
    })
  })

  describe('onContextMenu', () => {
    it('emits select on right-click with no text selection', async () => {
      vi.spyOn(window, 'getSelection').mockReturnValue({
        toString: () => '',
      } as Selection)

      const wrapper = await mountSuspended(Message, {
        props: {
          role: 'assistant',
          messageId: 'msg-1',
          isSelected: false,
          anySelected: false,
        },
      })

      await wrapper.trigger('contextmenu')

      expect(wrapper.emitted('select')).toEqual([
        ['msg-1', { x: 0, y: 0 }],
      ])
    })

    it('emits select with the exact pointer coordinates from the event', async () => {
      vi.spyOn(window, 'getSelection').mockReturnValue({
        toString: () => '',
      } as Selection)

      const wrapper = await mountSuspended(Message, {
        props: {
          role: 'assistant',
          messageId: 'msg-1',
          isSelected: false,
          anySelected: false,
        },
      })

      await wrapper.trigger('contextmenu', {
        clientX: 123,
        clientY: 456,
      })

      expect(wrapper.emitted('select')).toEqual([
        ['msg-1', { x: 123, y: 456 }],
      ])
    })

    it('does not emit select when isSelected is true', async () => {
      const wrapper = await mountSuspended(Message, {
        props: {
          role: 'assistant',
          messageId: 'msg-1',
          isSelected: true,
          anySelected: true,
        },
      })

      await wrapper.trigger('contextmenu')

      expect(wrapper.emitted('select')).toBeUndefined()
    })

    it('calls preventDefault when anySelected is true but isSelected is false', async () => {
      const wrapper = await mountSuspended(Message, {
        props: {
          role: 'assistant',
          messageId: 'msg-1',
          isSelected: false,
          anySelected: true,
        },
      })

      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

      wrapper.element.dispatchEvent(event)

      expect(preventDefaultSpy).toHaveBeenCalled()
      expect(wrapper.emitted('select')).toEqual([
        ['msg-1', { x: 0, y: 0 }],
      ])
    })

    it('does not emit select when clicking on an anchor element', async () => {
      const wrapper = await mountSuspended(Message, {
        props: {
          role: 'assistant',
          messageId: 'msg-1',
          isSelected: false,
          anySelected: false,
        },
        slots: {
          default: '<a href="#">link</a>',
        },
      })

      const anchor = wrapper.find('a')

      await anchor.trigger('contextmenu')

      expect(wrapper.emitted('select')).toBeUndefined()
    })

    it('does not emit select when text is selected', async () => {
      vi.spyOn(window, 'getSelection').mockReturnValue({
        toString: () => 'selected text',
      } as Selection)

      const wrapper = await mountSuspended(Message, {
        props: {
          role: 'assistant',
          messageId: 'msg-1',
          isSelected: false,
          anySelected: false,
        },
      })

      await wrapper.trigger('contextmenu')

      expect(wrapper.emitted('select')).toBeUndefined()
    })
  })

  describe('onCopy', () => {
    const slotHtml = '<div class="chat-markdown js-message-text">'
      + '<p class="x" style="color: red">Hello <strong>bold</strong></p>'
      + '<ul><li>one</li><li>two</li></ul></div>'
      + '<p class="outside">Outside</p>'

    async function mountWithContent() {
      return await mountSuspended(Message, {
        props: { role: 'assistant', messageId: 'msg-1' },
        slots: { default: slotHtml },
        attachTo: document.body,
      })
    }

    function selectNodeContents(node: Node) {
      const range = document.createRange()

      range.selectNodeContents(node)

      const selection = window.getSelection()!

      selection.removeAllRanges()
      selection.addRange(range)
    }

    afterEach(() => {
      window.getSelection()?.removeAllRanges()
    })

    it('writes cleaned html and plain text for a selection in message text', async () => {
      const wrapper = await mountWithContent()
      const setData = vi.fn()

      selectNodeContents(wrapper.get('.js-message-text').element)

      await wrapper.trigger('copy', { clipboardData: { setData } })

      expect(setData).toHaveBeenCalledWith(
        'text/html',
        '<meta charset="utf-8"><div style="font-size: 12px">'
        + '<div>Hello <b>bold</b></div>'
        + '<ul style="margin: 0"><li>one</li><li>two</li></ul></div>',
      )
      expect(setData).toHaveBeenCalledWith(
        'text/plain',
        'Hello bold\n\n- one\n- two',
      )
    })

    it('prevents the default copy when it handles the selection', async () => {
      const wrapper = await mountWithContent()

      selectNodeContents(wrapper.get('.js-message-text').element)

      const event = new Event('copy', { bubbles: true, cancelable: true })

      Object.defineProperty(event, 'clipboardData', {
        value: { setData: vi.fn() },
      })
      wrapper.element.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(true)
    })

    it('leaves the native copy alone for a selection outside message text', async () => {
      const wrapper = await mountWithContent()
      const setData = vi.fn()

      selectNodeContents(wrapper.get('.outside').element)

      await wrapper.trigger('copy', { clipboardData: { setData } })

      expect(setData).not.toHaveBeenCalled()
    })

    it('leaves the native copy alone when the selection spans outside message text', async () => {
      const wrapper = await mountWithContent()
      const setData = vi.fn()

      selectNodeContents(wrapper.get('.js-chat-bubble').element)

      await wrapper.trigger('copy', { clipboardData: { setData } })

      expect(setData).not.toHaveBeenCalled()
    })

    it('leaves the native copy alone for a collapsed selection', async () => {
      const wrapper = await mountWithContent()
      const setData = vi.fn()

      await wrapper.trigger('copy', { clipboardData: { setData } })

      expect(setData).not.toHaveBeenCalled()
    })

    it('does nothing when another handler already prevented the copy', async () => {
      const wrapper = await mountWithContent()
      const setData = vi.fn()

      selectNodeContents(wrapper.get('.js-message-text').element)

      const event = new Event('copy', { bubbles: true, cancelable: true })

      Object.defineProperty(event, 'clipboardData', { value: { setData } })
      event.preventDefault()
      wrapper.element.dispatchEvent(event)

      expect(setData).not.toHaveBeenCalled()
    })
  })

  describe('author avatar', () => {
    const authorImage = '/api/v1/shared/slug/avatar'

    it('renders the author image when one is provided', async () => {
      const wrapper = await mountSuspended(Message, {
        props: { role: 'user', authorName: 'Owner', authorImage },
      })

      expect(wrapper.find('img').attributes('src')).toBe(authorImage)
    })

    it('falls back to the placeholder when the image fails to load', async () => {
      const wrapper = await mountSuspended(Message, {
        props: { role: 'user', authorName: 'Owner', authorImage },
      })

      await wrapper.find('img').trigger('error')

      expect(wrapper.find('img').exists()).toBe(false)
      expect(wrapper.find('.avatar-placeholder').exists()).toBe(true)
    })

    it('tries again when the image source changes', async () => {
      const wrapper = await mountSuspended(Message, {
        props: { role: 'user', authorName: 'Owner', authorImage },
      })

      await wrapper.find('img').trigger('error')
      await wrapper.setProps({ authorImage: '/api/v1/shared/other/avatar' })

      expect(wrapper.find('img').attributes('src'))
        .toBe('/api/v1/shared/other/avatar')
    })
  })
})
