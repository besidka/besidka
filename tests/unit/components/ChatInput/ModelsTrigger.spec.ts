import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ModelsTrigger from '../../../../app/components/ChatInput/ModelsTrigger.vue'

describe('ChatInput/ModelsTrigger', () => {
  it('renders the deep research badge and cost/time tooltip for a research model', async () => {
    const wrapper = await mountSuspended(ModelsTrigger, {
      props: {
        isWebSearchEnabled: false,
        isReasoningEnabled: false,
      },
    })

    const researchButton = wrapper.findAll('button').find((button) => {
      return button.attributes('aria-label') === 'Choose o4-mini Deep Research'
    })

    expect(researchButton).toBeTruthy()

    const badge = researchButton?.find('[data-tip="Deep research"]')

    expect(badge?.exists()).toBe(true)
    expect(badge?.classes()).toContain('bg-success/15')
    expect(badge?.classes()).not.toContain('bg-success-content')
    expect(researchButton?.attributes('data-tip')).toBe(
      '~$1 / task · 5–15 min',
    )
  })

  it('shows the input/output token price tip for a regular model', async () => {
    const wrapper = await mountSuspended(ModelsTrigger, {
      props: {
        isWebSearchEnabled: false,
        isReasoningEnabled: false,
      },
    })

    const regularButton = wrapper.findAll('button').find((button) => {
      return button.attributes('aria-label') === 'Choose GPT-5.4'
    })

    expect(regularButton?.attributes('data-tip')).toBe('$2.50 / $15.00')
    expect(
      regularButton?.find('[data-tip="Deep research"]').exists(),
    ).toBe(false)
  })
})
