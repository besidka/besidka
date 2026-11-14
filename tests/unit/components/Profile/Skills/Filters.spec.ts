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
const kindOptions = [
  { value: 'all', label: 'All', count: 4 },
  { value: 'skills', label: 'Skills', count: 3 },
  { value: 'commands', label: 'Commands', count: 1 },
] as const

function mountFilters(props: Record<string, unknown> = {}) {
  return mountSuspended(SkillFilters, {
    props: {
      sourceOptions: [...sourceOptions],
      kindOptions: [...kindOptions],
      source: 'all',
      kind: 'all',
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
  it('renders box tabs for sources and filter buttons with count badges for kinds', async () => {
    const wrapper = await mountFilters()

    expect(wrapper.find(testId('skills-source-filter')).exists()).toBe(true)
    expect(wrapper.get(testId('skills-source-filter')).classes())
      .toContain('tabs-box')
    expect(wrapper.get(testId('skills-kind-skills-count')).text()).toBe('3')
    expect(wrapper.get(testId('skills-kind-all-count')).text()).toBe('4')
  })

  it('hides a row that has no options, so there are never two identical All controls', async () => {
    const wrapper = await mountFilters({ sourceOptions: [], kindOptions: [] })

    expect(wrapper.find(testId('skills-source-filter')).exists()).toBe(false)
    expect(wrapper.find(testId('skills-kind-filter')).exists()).toBe(false)
  })

  it('shows the search field only when asked to', async () => {
    expect((await mountFilters()).find(testId('skills-search')).exists())
      .toBe(false)
    expect((await mountFilters({ isSearchVisible: true }))
      .find(testId('skills-search')).exists()).toBe(true)
  })

  it('emits the chosen source and kind', async () => {
    const wrapper = await mountFilters()

    await wrapper.get(testId('skills-source-imported')).trigger('change')
    await wrapper.get(testId('skills-kind-commands')).trigger('click')

    expect(wrapper.emitted('selectSource')?.[0]).toEqual(['imported'])
    expect(wrapper.emitted('selectKind')?.[0]).toEqual(['commands'])
  })

  it('renders the slot beside the kind row', async () => {
    const wrapper = await mountSuspended(SkillFilters, {
      props: {
        sourceOptions: [],
        kindOptions: [],
        source: 'all',
        kind: 'all',
        isSearchVisible: false,
        search: '',
      },
      slots: { default: '<button data-testid="slot-new">New</button>' },
    })

    expect(wrapper.find(testId('slot-new')).exists()).toBe(true)
  })
})
