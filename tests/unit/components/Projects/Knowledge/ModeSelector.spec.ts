import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { KnowledgeMode } from '../../../../../shared/types/project-knowledge.d'
import ModeSelector from '../../../../../app/components/Projects/Knowledge/ModeSelector.vue'

enableAutoUnmount(afterEach)

async function mountSelector(
  modelValue: KnowledgeMode = 'auto',
  disabled: boolean = false,
) {
  return await mountSuspended(ModeSelector, {
    props: { modelValue, disabled },
  })
}

describe('Projects/Knowledge/ModeSelector', () => {
  it('renders a labelled radio group with the three modes', async () => {
    const wrapper = await mountSelector()
    const fieldset = wrapper.get('[data-testid="knowledge-mode"]')

    expect(fieldset.element.tagName).toBe('FIELDSET')
    expect(fieldset.get('legend').text()).toBe(
      'How Besidka uses the knowledge',
    )

    const radios = wrapper.findAll('input[type="radio"]')

    expect(radios).toHaveLength(3)
    expect(new Set(radios.map(radio => radio.attributes('name'))).size)
      .toBe(1)
    expect(wrapper.text()).toContain('Auto')
    expect(wrapper.text()).toContain('Always include everything')
    expect(wrapper.text()).toContain('Always search')
  })

  it('explains the cost consequence of each mode', async () => {
    const wrapper = await mountSelector()

    expect(wrapper.text()).toContain('you pay for all of it on each message')
    expect(wrapper.text()).toContain('The cheapest per message')
    expect(wrapper.text()).toContain('fits the model\'s budget')
  })

  it('wraps every radio in a label so the option text names it', async () => {
    const wrapper = await mountSelector()

    for (const radio of wrapper.findAll('input[type="radio"]')) {
      expect(radio.element.closest('label')).not.toBeNull()
    }
  })

  it('checks the radio that matches the value', async () => {
    const wrapper = await mountSelector('search')

    expect(wrapper.get<HTMLInputElement>('[data-testid="knowledge-mode-search"]')
      .element.checked).toBe(true)
    expect(wrapper.get<HTMLInputElement>('[data-testid="knowledge-mode-auto"]')
      .element.checked).toBe(false)
  })

  it('emits the chosen mode', async () => {
    const wrapper = await mountSelector('auto')

    await wrapper.get('[data-testid="knowledge-mode-full"]').setValue(true)

    expect(wrapper.emitted('select')).toEqual([['full']])
  })

  it('uses rounded-box options, never a pill radius', async () => {
    const wrapper = await mountSelector()
    const group = wrapper.get('[data-testid="knowledge-mode"] > div')

    expect(group.classes()).toContain('rounded-box')
    expect(wrapper.html()).not.toContain('rounded-full')
  })

  it('disables every radio while disabled', async () => {
    const wrapper = await mountSelector('auto', true)

    for (const radio of wrapper.findAll('input[type="radio"]')) {
      expect(radio.attributes('disabled')).toBeDefined()
    }
  })
})
