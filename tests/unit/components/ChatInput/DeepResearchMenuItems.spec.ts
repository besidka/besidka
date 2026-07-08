import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { ProviderResearchCapability } from '#shared/types/research.d'
import DeepResearchMenuItems from '../../../../app/components/ChatInput/DeepResearchMenuItems.vue'

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

describe('ChatInput/DeepResearchMenuItems', () => {
  it('renders off plus every level with cost and time estimates', async () => {
    const wrapper = await mountSuspended(DeepResearchMenuItems, {
      props: {
        researchLevel: 'off',
        capability,
      },
    })

    expect(
      wrapper.find('[data-testid="deep-research-option-off"]').exists(),
    ).toBe(true)

    const quickOption = wrapper.get(
      '[data-testid="deep-research-option-quick"]',
    )

    expect(quickOption.text()).toContain('Quick')
    expect(quickOption.text()).toContain('~$1')
    expect(quickOption.text()).toContain('5-15 min')

    const thoroughOption = wrapper.get(
      '[data-testid="deep-research-option-thorough"]',
    )

    expect(thoroughOption.text()).toContain('Thorough')
    expect(thoroughOption.text()).toContain('~$10')
  })

  it('marks the active level as selected', async () => {
    const wrapper = await mountSuspended(DeepResearchMenuItems, {
      props: {
        researchLevel: 'thorough',
        capability,
      },
    })

    expect(
      wrapper
        .get('[data-testid="deep-research-option-thorough"]')
        .classes(),
    ).toContain('bg-accent')
    expect(
      wrapper
        .get('[data-testid="deep-research-option-quick"]')
        .classes(),
    ).not.toContain('bg-accent')
  })

  it('emits select-research-level for off and for a level', async () => {
    const wrapper = await mountSuspended(DeepResearchMenuItems, {
      props: {
        researchLevel: 'off',
        capability,
      },
    })

    await wrapper
      .get('[data-testid="deep-research-option-quick"]')
      .trigger('click')

    expect(wrapper.emitted('select-research-level')).toEqual([['quick']])

    await wrapper
      .get('[data-testid="deep-research-option-off"]')
      .trigger('click')

    expect(wrapper.emitted('select-research-level')?.[1]).toEqual(['off'])
  })

  it('renders no levels when the capability is null', async () => {
    const wrapper = await mountSuspended(DeepResearchMenuItems, {
      props: {
        researchLevel: 'off',
        capability: null,
      },
    })

    expect(
      wrapper.find('[data-testid="deep-research-option-quick"]').exists(),
    ).toBe(false)
    expect(
      wrapper.find('[data-testid="deep-research-option-off"]').exists(),
    ).toBe(true)
  })
})
