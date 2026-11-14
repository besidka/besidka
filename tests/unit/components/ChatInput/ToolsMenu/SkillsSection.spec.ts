import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import SkillsSection from '../../../../../app/components/ChatInput/ToolsMenu/SkillsSection.vue'
import type { ComposerSkillItem } from '../../../../../app/composables/composer-skills'

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

function items(count: number): ComposerSkillItem[] {
  return Array.from({ length: count }, (_, index) => {
    return {
      id: `skl${index}`,
      name: `skill-${index}`,
      description: `Does thing ${index}`,
      version: 1,
      mode: 'auto' as const,
    }
  })
}

function mountSection(props: {
  items: ComposerSkillItem[]
  selectedId?: string | null
}) {
  return mountSuspended(SkillsSection, {
    props: { selectedId: null, ...props },
  })
}

describe('ChatInput/ToolsMenu/SkillsSection', () => {
  it('lists each skill with its name and a one-line description', async () => {
    const wrapper = await mountSection({ items: items(3) })
    const row = wrapper.get(testId('tools-skill-skill-1'))

    expect(row.text()).toContain('skill-1')
    expect(row.text()).toContain('Does thing 1')
    expect(wrapper.find('h3').text()).toContain('Skills')
    expect(wrapper.html()).toContain('lucide:sparkles')
  })

  it('shows at most six skills, then All skills with the count', async () => {
    const wrapper = await mountSection({ items: items(9) })

    expect(wrapper.findAll('[data-testid^="tools-skill-skill-"]'))
      .toHaveLength(6)
    expect(wrapper.get(testId('tools-skills-all')).text()).toContain('All skills')
    expect(wrapper.get(testId('tools-skills-all')).text()).toContain('9 skills')
  })

  it('hides All skills when everything fits', async () => {
    const wrapper = await mountSection({ items: items(6) })

    expect(wrapper.find(testId('tools-skills-all')).exists()).toBe(false)
  })

  it('emits the chosen skill and marks the attached one', async () => {
    const list = items(2)
    const wrapper = await mountSection({ items: list, selectedId: 'skl1' })

    expect(wrapper.get(testId('tools-skill-skill-1')).attributes('aria-pressed'))
      .toBe('true')
    expect(wrapper.get(testId('tools-skill-skill-0')).attributes('aria-pressed'))
      .toBe('false')

    await wrapper.get(testId('tools-skill-skill-0')).trigger('click')

    expect(wrapper.emitted('select')).toEqual([[list[0]]])
  })

  it('always offers Manage skills and emits for All skills', async () => {
    const wrapper = await mountSection({ items: items(8) })

    await wrapper.get(testId('tools-skills-manage')).trigger('click')
    await wrapper.get(testId('tools-skills-all')).trigger('click')

    expect(wrapper.emitted('manage')).toHaveLength(1)
    expect(wrapper.emitted('open-all')).toHaveLength(1)
  })
})
