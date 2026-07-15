import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { ModelResearchConfig } from '#shared/types/research.d'
import DeepResearchTrigger from '../../../../app/components/ChatInput/DeepResearchTrigger.vue'

const research: ModelResearchConfig = {
  tier: 'quick',
  assistModel: 'gpt-5.4-nano',
  costEstimate: '~$1 / task',
  timeEstimate: '5–15 min',
  maxToolCalls: 30,
}

describe('ChatInput/DeepResearchTrigger', () => {
  it('shows the deep research indicator with the cost and time estimate', async () => {
    const wrapper = await mountSuspended(DeepResearchTrigger, {
      props: {
        research,
      },
    })

    const trigger = wrapper.get('[data-testid="deep-research-trigger"]')

    expect(trigger.text()).toContain('Deep research')
    expect(trigger.attributes('data-tip')).toBe('~$1 / task · 5–15 min')
  })

  it('is not toggleable — no click emits, no dropdown', async () => {
    const wrapper = await mountSuspended(DeepResearchTrigger, {
      props: {
        research,
      },
    })

    expect(wrapper.find('details').exists()).toBe(false)
    expect(wrapper.find('.dropdown-content').exists()).toBe(false)
  })

  it('adds the disabled styling while a research job is active', async () => {
    const wrapper = await mountSuspended(DeepResearchTrigger, {
      props: {
        research,
        disabled: true,
      },
    })

    expect(
      wrapper.get('[data-testid="deep-research-trigger"]').classes(),
    ).toContain('btn-disabled')
  })

  it('does not add the disabled styling when no job is active', async () => {
    const wrapper = await mountSuspended(DeepResearchTrigger, {
      props: {
        research,
        disabled: false,
      },
    })

    expect(
      wrapper.get('[data-testid="deep-research-trigger"]').classes(),
    ).not.toContain('btn-disabled')
  })
})
