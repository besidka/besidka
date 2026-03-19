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

      expect(wrapper.emitted('select')).toEqual([['msg-1']])
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

      expect(wrapper.emitted('select')).toEqual([['msg-1']])
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

      expect(wrapper.emitted('select')).toEqual([['msg-1']])
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
      expect(wrapper.emitted('select')).toEqual([['msg-1']])
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
})
