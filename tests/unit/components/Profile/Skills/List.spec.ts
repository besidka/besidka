import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import SkillList from '../../../../../app/components/Profile/Skills/List.vue'
import { createSkillSummary } from '../../../../setup/helpers/skills-ui'

enableAutoUnmount(afterEach)

function mountList(props: Record<string, unknown> = {}) {
  return mountSuspended(SkillList, {
    props: {
      skills: [],
      hasLoaded: true,
      ...props,
    },
  })
}

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('Profile/Skills/List', () => {
  it('renders a row for every skill', async () => {
    const wrapper = await mountList({
      skills: [
        createSkillSummary({ id: 'a', name: 'alpha' }),
        createSkillSummary({ id: 'b', name: 'beta' }),
      ],
    })

    expect(wrapper.findAll(testId('skill-row'))).toHaveLength(2)
    expect(wrapper.find(testId('skills-empty')).exists()).toBe(false)
  })

  it('marks the open skill as selected', async () => {
    const wrapper = await mountList({
      skills: [
        createSkillSummary({ id: 'a', name: 'alpha' }),
        createSkillSummary({ id: 'b', name: 'beta' }),
      ],
      selectedId: 'b',
    })
    const rows = wrapper.findAll(testId('skill-row'))

    expect(rows[0]!.classes()).not.toContain('bg-base-200')
    expect(rows[1]!.classes()).toContain('bg-base-200')
  })

  it('forwards the Edit action of a row', async () => {
    const skill = createSkillSummary({ id: 'a', name: 'alpha' })
    const wrapper = await mountList({ skills: [skill] })

    await wrapper.get(testId('skill-action-edit')).trigger('click')

    expect(wrapper.emitted('edit')).toEqual([[skill]])
  })

  it('shows the empty state with the New menu', async () => {
    const wrapper = await mountList()

    expect(wrapper.get(testId('skills-empty')).text()).toContain(
      'No skills yet. Create one, start from a template, or import a .zip or a GitHub link.',
    )
    expect(wrapper.find(testId('skills-new-trigger')).exists()).toBe(true)
  })

  it('forwards the chosen New action from the empty state', async () => {
    const wrapper = await mountList()

    await wrapper.get(testId('skills-new-upload')).trigger('click')

    expect(wrapper.emitted('new')?.[0]).toEqual(['upload'])
  })

  it('shows the no-results state and clears the filters', async () => {
    const wrapper = await mountList({ isFiltered: true })

    expect(wrapper.find(testId('skills-empty')).exists()).toBe(false)

    await wrapper.get(testId('skills-clear')).trigger('click')

    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('shows delayed skeleton rows while loading', async () => {
    const wrapper = await mountList({
      hasLoaded: false,
      isSkeletonVisible: true,
    })

    expect(wrapper.find(testId('skills-skeleton')).exists()).toBe(true)
    expect(wrapper.find(testId('skills-empty')).exists()).toBe(false)
  })

  it('shows nothing before the first load and without a skeleton', async () => {
    const wrapper = await mountList({ hasLoaded: false })

    expect(wrapper.find(testId('skills-skeleton')).exists()).toBe(false)
    expect(wrapper.find(testId('skills-empty')).exists()).toBe(false)
  })

  it('shows an error alert with Retry', async () => {
    const wrapper = await mountList({
      hasLoaded: false,
      hasError: true,
      errorMessage: 'Network down',
    })

    expect(wrapper.get(testId('skills-error')).text()).toContain('Network down')
    expect(wrapper.get(testId('skills-error')).classes())
      .toContain('alert-error')

    await wrapper.get(testId('skills-retry')).trigger('click')

    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('hides the GitHub item in the empty-state menu without the import flag', async () => {
    const without = await mountList()
    const withFlag = await mountList({ canImportFromUrl: true })

    expect(without.find(testId('skills-new-github')).exists()).toBe(false)
    expect(withFlag.find(testId('skills-new-github')).exists()).toBe(true)
  })
})
