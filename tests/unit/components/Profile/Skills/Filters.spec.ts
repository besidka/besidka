import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import SkillFilters from '../../../../../app/components/Profile/Skills/Filters.vue'

enableAutoUnmount(afterEach)

const sourceOptions = [
  { value: 'all', label: 'All sources', count: 4 },
  { value: 'created', label: 'Created', count: 3 },
  { value: 'imported', label: 'Imported', count: 1 },
] as const

function mountFilters(props: Record<string, unknown> = {}) {
  return mountSuspended(SkillFilters, {
    props: {
      sourceOptions: [...sourceOptions],
      source: 'all',
      isSearchVisible: false,
      search: '',
      ...props,
    },
  })
}

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('Profile/Skills/Filters', () => {
  it('renders box tabs for the sources and no kind filter', async () => {
    const wrapper = await mountFilters()

    expect(wrapper.find(testId('skills-source-filter')).exists()).toBe(true)
    expect(wrapper.get(testId('skills-source-filter')).classes())
      .toContain('tabs-box')
    expect(wrapper.find(testId('skills-kind-filter')).exists()).toBe(false)
    expect(wrapper.find(testId('skills-kind-all')).exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/commands/i)
  })

  it('hides the source row when it has no options', async () => {
    const wrapper = await mountFilters({ sourceOptions: [] })

    expect(wrapper.find(testId('skills-source-filter')).exists()).toBe(false)
  })

  it('shows the search field only when asked to', async () => {
    expect((await mountFilters()).find(testId('skills-search')).exists())
      .toBe(false)
    expect((await mountFilters({ isSearchVisible: true }))
      .find(testId('skills-search')).exists()).toBe(true)
  })

  it('emits the chosen source', async () => {
    const wrapper = await mountFilters()

    await wrapper.get(testId('skills-source-imported')).trigger('change')

    expect(wrapper.emitted('selectSource')?.[0]).toEqual(['imported'])
    expect(wrapper.emitted('selectKind')).toBeUndefined()
  })

  it('renders the slot', async () => {
    const wrapper = await mountSuspended(SkillFilters, {
      props: {
        sourceOptions: [],
        source: 'all',
        isSearchVisible: false,
        search: '',
      },
      slots: { default: '<button data-testid="slot-new">New</button>' },
    })

    expect(wrapper.find(testId('slot-new')).exists()).toBe(true)
  })
})
