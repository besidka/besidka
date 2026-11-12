import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import HistoryBoxTabs from '../../../../app/components/History/BoxTabs.vue'

enableAutoUnmount(afterEach)

const OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word' },
]

function mountFilter(modelValue = 'all', options = OPTIONS) {
  return mountSuspended(HistoryBoxTabs, {
    props: {
      options,
      modelValue,
      label: 'Filter by source',
      testIdPrefix: 'box-tabs',
    },
  })
}

describe('History/BoxTabs', () => {
  it('renders a file manager tab for every option', async () => {
    const wrapper = await mountFilter()
    const group = wrapper.get('[data-testid="box-tabs-filter"]')
    const tabs = group.findAll('input')

    expect(group.attributes('role')).toBe('tablist')
    expect(group.attributes('aria-label')).toBe('Filter by source')
    expect(group.classes()).toEqual(
      expect.arrayContaining(['tabs', 'tabs-box']),
    )
    expect(tabs.map(tab => tab.attributes('aria-label'))).toEqual([
      'All',
      'PDF',
      'Word',
    ])
    expect(tabs.every(tab => tab.classes().includes('tab'))).toBe(true)
    expect(tabs.every((tab) => {
      return tab.attributes('name') === 'box-tabs_tabs'
    })).toBe(true)
    expect(wrapper.html()).not.toMatch(/btn|badge/)
  })

  it('checks the applied option', async () => {
    const wrapper = await mountFilter('docx')
    const checked = wrapper.findAll('input').map((tab) => {
      return (tab.element as HTMLInputElement).checked
    })

    expect(checked).toEqual([false, false, true])
  })

  it('emits the chosen value', async () => {
    const wrapper = await mountFilter()

    await wrapper.get('[data-testid="box-tabs-docx"]')
      .trigger('change')

    expect(wrapper.emitted('select')).toEqual([['docx']])
  })

  it('does not emit when the applied option is chosen again', async () => {
    const wrapper = await mountFilter('pdf')

    await wrapper.get('[data-testid="box-tabs-pdf"]')
      .trigger('change')

    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('renders nothing without options', async () => {
    const wrapper = await mountFilter('all', [])

    expect(wrapper.find('[data-testid="box-tabs-filter"]')
      .exists()).toBe(false)
  })
})
