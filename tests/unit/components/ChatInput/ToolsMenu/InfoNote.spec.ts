import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import InfoNote from '../../../../../app/components/ChatInput/ToolsMenu/InfoNote.vue'

describe('ChatInput/ToolsMenu/InfoNote', () => {
  it('renders the slot in the shared gray note style', async () => {
    const wrapper = await mountSuspended(InfoNote, {
      slots: { default: 'Explains the setting.' },
    })

    expect(wrapper.element.tagName).toBe('P')
    expect(wrapper.text()).toBe('Explains the setting.')
    expect(wrapper.classes()).toEqual(expect.arrayContaining([
      'rounded-box',
      'bg-base-200',
      'text-xs',
      'px-2',
      'py-1.5',
    ]))
  })

  it('merges the spacing classes of the caller', async () => {
    const wrapper = await mountSuspended(InfoNote, {
      attrs: { class: 'mx-2 mt-1 mb-2', id: 'note' },
    })

    expect(wrapper.classes()).toEqual(expect.arrayContaining([
      'bg-base-200',
      'mx-2',
      'mt-1',
      'mb-2',
    ]))
    expect(wrapper.attributes('id')).toBe('note')
  })
})
