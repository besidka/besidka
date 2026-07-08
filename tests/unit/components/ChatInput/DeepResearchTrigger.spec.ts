import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import type { ProviderResearchCapability } from '#shared/types/research.d'
import DeepResearchTrigger from '../../../../app/components/ChatInput/DeepResearchTrigger.vue'

const capability: ProviderResearchCapability = {
  assistModel: 'gpt-5.4-nano',
  levels: {
    quick: {
      modelId: 'o4-mini-deep-research',
      label: 'Quick',
      costEstimate: '~$1',
      timeEstimate: '5-15 min',
    },
    thorough: {
      modelId: 'o3-deep-research',
      label: 'Thorough',
      costEstimate: '~$10',
      timeEstimate: '10-30 min',
    },
  },
}

describe('ChatInput/DeepResearchTrigger', () => {
  it('shows no active label when research is off', async () => {
    const wrapper = await mountSuspended(DeepResearchTrigger, {
      props: {
        researchLevel: 'off',
        capability,
      },
    })

    const trigger = wrapper.get('[data-testid="deep-research-trigger"]')

    expect(trigger.text()).toBe('')
  })

  it('shows the active level label', async () => {
    const wrapper = await mountSuspended(DeepResearchTrigger, {
      props: {
        researchLevel: 'quick',
        capability,
      },
    })

    expect(
      wrapper.get('[data-testid="deep-research-trigger"]').text(),
    ).toBe('Quick')
  })

  it('emits update:researchLevel when a menu option is selected', async () => {
    const wrapper = await mountSuspended(DeepResearchTrigger, {
      props: {
        researchLevel: 'off',
        capability,
      },
    })

    await nextTick()

    await wrapper
      .get('[data-testid="deep-research-option-thorough"]')
      .trigger('click')

    expect(wrapper.emitted('update:researchLevel')).toEqual([['thorough']])
  })

  it('adds the disabled styling and blocks selection while disabled', async () => {
    const wrapper = await mountSuspended(DeepResearchTrigger, {
      props: {
        researchLevel: 'off',
        capability,
        disabled: true,
      },
    })

    await nextTick()

    expect(
      wrapper.get('[data-testid="deep-research-trigger"]').classes(),
    ).toContain('btn-disabled')

    await wrapper
      .get('[data-testid="deep-research-option-quick"]')
      .trigger('click')

    expect(wrapper.emitted('update:researchLevel')).toBeUndefined()
  })
})
