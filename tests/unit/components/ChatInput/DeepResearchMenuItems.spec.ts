import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import DeepResearchMenuItems from '../../../../app/components/ChatInput/DeepResearchMenuItems.vue'

describe('ChatInput/DeepResearchMenuItems', () => {
  it('renders an entry for off and each research depth', async () => {
    const wrapper = await mountSuspended(DeepResearchMenuItems, {
      props: { researchDepth: 'off' },
    })

    const buttonLabels = wrapper.findAll('button').map((button) => {
      return button.text()
    })

    expect(buttonLabels).toEqual(['Off', 'Quick', 'Standard', 'Thorough'])
  })

  it('emits select-research-depth with the clicked depth', async () => {
    const wrapper = await mountSuspended(DeepResearchMenuItems, {
      props: { researchDepth: 'off' },
    })

    const buttons = wrapper.findAll('button')
    const thoroughButton = buttons.find((button) => {
      return button.text() === 'Thorough'
    })

    await thoroughButton?.trigger('click')

    expect(wrapper.emitted('select-research-depth')).toEqual([['thorough']])
  })

  it('highlights the currently selected depth', async () => {
    const wrapper = await mountSuspended(DeepResearchMenuItems, {
      props: { researchDepth: 'standard' },
    })

    const buttons = wrapper.findAll('button')
    const standardButton = buttons.find((button) => {
      return button.text() === 'Standard'
    })
    const quickButton = buttons.find((button) => {
      return button.text() === 'Quick'
    })

    expect(standardButton?.classes()).toContain('bg-accent')
    expect(quickButton?.classes()).not.toContain('bg-accent')
  })
})
