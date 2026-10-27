import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import InlineButton from '../../../../../app/components/ChatInput/ToolsMenu/InlineButton.vue'

describe('ChatInput/ToolsMenu/InlineButton', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders a type=button with its slot and emits click', async () => {
    const wrapper = await mountSuspended(InlineButton, {
      slots: { default: 'Retry' },
    })
    const button = wrapper.get('button')

    expect(button.attributes('type')).toBe('button')
    expect(button.text()).toBe('Retry')
    expect(button.attributes('aria-disabled')).toBeUndefined()

    await button.trigger('click')

    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('stays inert and says so while pending', async () => {
    const wrapper = await mountSuspended(InlineButton, {
      props: { isPending: true },
      slots: { default: 'Retry' },
    })
    const button = wrapper.get('button')

    expect(button.attributes('aria-disabled')).toBe('true')
    expect(button.classes()).toContain('cursor-default')

    await button.trigger('click')

    expect(wrapper.emitted('click')).toBeUndefined()
  })

  it('looks interactive when not pending', async () => {
    const wrapper = await mountSuspended(InlineButton, {
      slots: { default: 'Retry' },
    })

    expect(wrapper.get('button').classes()).toEqual(
      expect.arrayContaining(['cursor-pointer', 'text-accent']),
    )
  })

  it('does not guard keyboard or pointer clicks behind a reveal guard',
    async () => {
      const wrapper = await mountSuspended(InlineButton, {
        slots: { default: 'Retry' },
      })
      const button = wrapper.get('button').element

      button.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        detail: 0,
      }))
      button.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        detail: 1,
      }))

      expect(wrapper.emitted('click')).toHaveLength(2)
    })

  it('moves focus to the section\'s checked radio when it unmounts while '
    + 'focused', async () => {
    const Host = defineComponent({
      props: { isButtonVisible: Boolean },
      setup(props) {
        return () => h('div', { class: 'js-tools-content' }, [
          h('section', { 'data-section': 'search' }, [
            h('input', {
              'type': 'radio',
              'name': 'provider',
              'checked': true,
              'data-testid': 'provider',
            }),
            props.isButtonVisible
              ? h(InlineButton, null, () => 'Retry')
              : null,
          ]),
        ])
      },
    })
    const wrapper = await mountSuspended(Host, {
      props: { isButtonVisible: true },
      attachTo: document.body,
    })

    wrapper.get('button').element.focus()
    await wrapper.setProps({ isButtonVisible: false })
    await nextTick()
    await nextTick()

    expect(document.activeElement)
      .toBe(wrapper.get('[data-testid="provider"]').element)
  })
})
