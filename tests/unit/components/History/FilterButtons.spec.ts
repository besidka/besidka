import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import HistoryFilterButtons from '../../../../app/components/History/FilterButtons.vue'

enableAutoUnmount(afterEach)

const OPTIONS = [
  { value: 'all', label: 'All', count: 5 },
  { value: 'pdf', label: 'PDF', count: 3 },
  { value: 'docx', label: 'Word', count: 2 },
]

function mountFilter(modelValue = 'all', options = OPTIONS) {
  return mountSuspended(HistoryFilterButtons, {
    props: {
      options,
      modelValue,
      label: 'Filter by format',
      testIdPrefix: 'library-format',
    },
  })
}

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('History/FilterButtons', () => {
  it('renders a button with a count badge for every option', async () => {
    const wrapper = await mountFilter()
    const group = wrapper.get(testId('library-format-filter'))

    expect(group.attributes('role')).toBe('group')
    expect(group.attributes('aria-label')).toBe('Filter by format')
    expect(group.findAll('button').map(button => button.text())).toEqual([
      'All 5',
      'PDF 3',
      'Word 2',
    ])
  })

  it('uses daisyUI badge modifiers only', async () => {
    const wrapper = await mountFilter()
    const badge = wrapper.get(testId('library-format-pdf-count'))

    expect(badge.classes()).toEqual(
      expect.arrayContaining(['badge', 'badge-soft']),
    )
    expect(badge.classes().some(name => /^(text|bg|border)-/.test(name)))
      .toBe(false)
  })

  it('marks the applied option as pressed', async () => {
    const wrapper = await mountFilter('docx')

    expect(wrapper.get(testId('library-format-docx'))
      .attributes('aria-pressed')).toBe('true')
    expect(wrapper.get(testId('library-format-all'))
      .attributes('aria-pressed')).toBe('false')
  })

  it('emits the clicked value', async () => {
    const wrapper = await mountFilter()

    await wrapper.get(testId('library-format-docx')).trigger('click')

    expect(wrapper.emitted('select')).toEqual([['docx']])
  })

  it('renders nothing without options', async () => {
    const wrapper = await mountFilter('all', [])

    expect(wrapper.find(testId('library-format-filter')).exists())
      .toBe(false)
  })
})
