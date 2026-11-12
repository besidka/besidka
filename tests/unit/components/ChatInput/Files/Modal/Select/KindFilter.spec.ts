import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import KindFilter from '../../../../../../../app/components/ChatInput/Files/Modal/Select/KindFilter.vue'

const KINDS = ['all', 'image', 'document'] as const

function getRadios(wrapper: Awaited<ReturnType<typeof mountSuspended>>) {
  return KINDS.map((kind) => {
    return wrapper.get<HTMLInputElement>(`[data-testid="files-kind-${kind}"]`)
  })
}

describe('ChatInput/Files/Modal/Select/KindFilter', () => {
  it('renders the three kinds as the same box tabs as the source row',
    async () => {
      const wrapper = await mountSuspended(KindFilter, {
        props: { modelValue: 'all' },
      })
      const tablist = wrapper.get('[data-testid="files-kind-filter"]')
      const radios = getRadios(wrapper)

      expect(tablist.attributes('role')).toBe('tablist')
      expect(tablist.classes()).toEqual(expect.arrayContaining([
        'tabs',
        'tabs-box',
        'max-xs:tabs-xs',
        'xs:tabs-sm',
      ]))
      expect(tablist.classes()).not.toContain('join')
      expect(radios.map(radio => radio.attributes('aria-label'))).toEqual([
        'All',
        'Images',
        'Documents',
      ])
      expect(radios.every(radio => radio.classes().includes('tab'))).toBe(true)
      expect(radios.every(radio => radio.attributes('type') === 'radio'))
        .toBe(true)
      expect(new Set(radios.map(radio => radio.attributes('name'))).size)
        .toBe(1)
    })

  it('never uses a button or a colour fill', async () => {
    const wrapper = await mountSuspended(KindFilter, {
      props: { modelValue: 'document' },
    })

    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.html()).not.toMatch(/btn-(primary|accent|secondary)/)
  })

  it('checks only the active kind', async () => {
    const wrapper = await mountSuspended(KindFilter, {
      props: { modelValue: 'image' },
    })

    expect(getRadios(wrapper).map(radio => radio.element.checked)).toEqual([
      false,
      true,
      false,
    ])
  })

  it('emits the chosen kind', async () => {
    const wrapper = await mountSuspended(KindFilter, {
      props: { modelValue: 'all' },
    })

    await wrapper.get('[data-testid="files-kind-image"]').trigger('change')
    await wrapper.get('[data-testid="files-kind-document"]')
      .trigger('change')

    expect(wrapper.emitted('update:modelValue')).toEqual([
      ['image'],
      ['document'],
    ])
  })

  it('does not emit when the active kind is chosen again', async () => {
    const wrapper = await mountSuspended(KindFilter, {
      props: { modelValue: 'document' },
    })

    await wrapper.get('[data-testid="files-kind-document"]')
      .trigger('change')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('reflects a new modelValue in the checked radio', async () => {
    const wrapper = await mountSuspended(KindFilter, {
      props: { modelValue: 'all' },
    })

    await wrapper.setProps({ modelValue: 'image' })

    expect(getRadios(wrapper).map(radio => radio.element.checked)).toEqual([
      false,
      true,
      false,
    ])
  })
})
