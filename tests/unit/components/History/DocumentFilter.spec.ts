import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import HistoryDocumentFilter from '../../../../app/components/History/DocumentFilter.vue'

enableAutoUnmount(afterEach)

const OPTIONS = [
  { value: 'all', label: 'All', count: 5 },
  { value: 'pdf', label: 'PDF', count: 3 },
  { value: 'docx', label: 'Word', count: 2 },
]

function mountFilter(modelValue = 'all', options = OPTIONS) {
  return mountSuspended(HistoryDocumentFilter, {
    props: {
      options,
      modelValue,
      label: 'Filter by format',
      testIdPrefix: 'document-library-format',
    },
  })
}

describe('History/DocumentFilter', () => {
  it('renders a chip with a count badge for every option', async () => {
    const wrapper = await mountFilter()
    const group = wrapper.get('[data-testid="document-library-format-filter"]')
    const chips = group.findAll('button')

    expect(group.attributes('role')).toBe('group')
    expect(group.attributes('aria-label')).toBe('Filter by format')
    expect(chips.map(chip => chip.text())).toEqual([
      'All 5',
      'PDF 3',
      'Word 2',
    ])
    expect(wrapper.get('[data-testid="document-library-format-pdf-count"]')
      .classes()).toEqual(expect.arrayContaining(['badge', 'badge-soft']))
  })

  it('marks the applied option as pressed', async () => {
    const wrapper = await mountFilter('docx')
    const pressed = wrapper.findAll('button').map((chip) => {
      return chip.attributes('aria-pressed')
    })

    expect(pressed).toEqual(['false', 'false', 'true'])
  })

  it('matches the artifact kind filter chip style', async () => {
    const wrapper = await mountFilter('pdf')
    const [all, pdf] = wrapper.findAll('button')

    expect(all!.classes()).toEqual(expect.arrayContaining(['btn', 'btn-sm']))
    expect(all!.classes()).toContain('btn-soft')
    expect(pdf!.classes()).toContain('btn-accent')
    expect(wrapper.html()).not.toMatch(/btn-primary/)
  })

  it('emits the chosen value', async () => {
    const wrapper = await mountFilter()

    await wrapper.get('[data-testid="document-library-format-docx"]')
      .trigger('click')

    expect(wrapper.emitted('select')).toEqual([['docx']])
  })

  it('renders nothing without options', async () => {
    const wrapper = await mountFilter('all', [])

    expect(wrapper.find('[data-testid="document-library-format-filter"]')
      .exists()).toBe(false)
  })
})
