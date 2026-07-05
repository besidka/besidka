import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import DeepResearchTrigger from '../../../../app/components/ChatInput/DeepResearchTrigger.vue'

describe('ChatInput/DeepResearchTrigger', () => {
  it('renders as an inactive circle button when research is off', async () => {
    const wrapper = await mountSuspended(DeepResearchTrigger, {
      props: { researchDepth: 'off' },
    })

    const trigger = wrapper.find('[data-testid="deep-research-trigger"]')

    expect(trigger.classes()).toContain('btn-circle')
    expect(trigger.attributes('title')).toBe('Deep research: off')
    expect(trigger.text()).toBe('')
  })

  it('renders the active depth label when a depth is selected', async () => {
    const wrapper = await mountSuspended(DeepResearchTrigger, {
      props: { researchDepth: 'thorough' },
    })

    const trigger = wrapper.find('[data-testid="deep-research-trigger"]')

    expect(trigger.classes()).not.toContain('btn-circle')
    expect(trigger.classes()).toContain('btn-active')
    expect(trigger.text()).toContain('thorough')
  })

  it('emits update:researchDepth when a menu item is selected', async () => {
    const wrapper = await mountSuspended(DeepResearchTrigger, {
      props: { researchDepth: 'off' },
    })

    const buttons = wrapper.findAll('button')
    const standardButton = buttons.find((button) => {
      return button.text() === 'Standard'
    })

    await standardButton?.trigger('click')

    expect(wrapper.emitted('update:researchDepth')).toEqual([['standard']])
  })
})
