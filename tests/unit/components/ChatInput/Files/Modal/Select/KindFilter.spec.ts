import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import KindFilter from '../../../../../../../app/components/ChatInput/Files/Modal/Select/KindFilter.vue'

describe('ChatInput/Files/Modal/Select/KindFilter', () => {
  it('renders the three kinds as a pressed-state button group', async () => {
    const wrapper = await mountSuspended(KindFilter, {
      props: { modelValue: 'all' },
    })
    const group = wrapper.get('[data-testid="files-kind-filter"]')
    const buttons = ['all', 'image', 'document'].map((kind) => {
      return wrapper.get(`[data-testid="files-kind-${kind}"]`)
    })

    expect(group.classes()).toContain('join')
    expect(group.attributes('role')).toBe('group')
    expect(buttons.map(button => button.text())).toEqual([
      'All',
      'Images',
      'Documents',
    ])
    expect(buttons.every(button => button.classes().includes('btn'))).toBe(true)
    expect(buttons.every((button) => {
      return button.classes().includes('join-item')
    })).toBe(true)
    expect(buttons.map(button => button.attributes('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
    ])
    expect(buttons[0]!.classes()).toContain('btn-active')
    expect(buttons[1]!.classes()).not.toContain('btn-active')
  })

  it('emits the chosen kind', async () => {
    const wrapper = await mountSuspended(KindFilter, {
      props: { modelValue: 'all' },
    })

    await wrapper.get('[data-testid="files-kind-image"]').trigger('click')
    await wrapper.get('[data-testid="files-kind-document"]')
      .trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([
      ['image'],
      ['document'],
    ])
  })

  it('does not emit when the active kind is clicked again', async () => {
    const wrapper = await mountSuspended(KindFilter, {
      props: { modelValue: 'document' },
    })

    await wrapper.get('[data-testid="files-kind-document"]')
      .trigger('click')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('reflects a new modelValue in the pressed state', async () => {
    const wrapper = await mountSuspended(KindFilter, {
      props: { modelValue: 'all' },
    })

    await wrapper.setProps({ modelValue: 'image' })

    expect(
      wrapper.get('[data-testid="files-kind-image"]')
        .attributes('aria-pressed'),
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="files-kind-all"]')
        .attributes('aria-pressed'),
    ).toBe('false')
  })
})
