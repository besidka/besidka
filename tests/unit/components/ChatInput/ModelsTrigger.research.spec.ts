import { shallowRef } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import ModelsTrigger from '../../../../app/components/ChatInput/ModelsTrigger.vue'

const mocks = vi.hoisted(() => ({
  useUserSetting: vi.fn(() => ({
    favoriteModels: shallowRef<string[]>([]),
    toggleFavoriteModel: vi.fn(),
  })),
}))

mockNuxtImport('useUserSetting', () => mocks.useUserSetting)

async function openPicker() {
  const wrapper = await mountSuspended(ModelsTrigger, {
    props: {
      isWebSearchEnabled: false,
      isReasoningEnabled: false,
    },
  })

  await wrapper.get('[data-testid="current-model-trigger"]').trigger('click')

  return wrapper
}

function findModelButton(wrapper: VueWrapper, modelName: string) {
  return wrapper.findAll('button').find((button) => {
    return button.attributes('aria-label') === `Choose ${modelName}`
  })
}

describe('ChatInput/ModelsTrigger', () => {
  it('renders the deep research badge and cost/time tooltip for a research model', async () => {
    const wrapper = await openPicker()
    const researchButton = findModelButton(wrapper, 'o4-mini Deep Research')

    expect(researchButton).toBeTruthy()

    const badge = researchButton?.find('[data-tip="Deep research"]')

    expect(badge?.exists()).toBe(true)
    expect(badge?.classes()).toContain('capability-chip')
    expect(badge?.classes()).toContain('text-success')
    expect(badge?.classes()).not.toContain('bg-success/15')
    expect(badge?.classes()).not.toContain('bg-success-content')
    expect(
      researchButton
        ?.get('[data-testid="model-price-tier"]')
        .attributes('data-tip'),
    ).toBe('~$1 / task · 5–15 min')
  })

  it('shows the input/output token price tip for a regular model', async () => {
    const wrapper = await openPicker()
    const regularButton = findModelButton(wrapper, 'GPT-5.4')

    expect(
      regularButton
        ?.get('[data-testid="model-price-tier"]')
        .attributes('data-tip'),
    ).toBe('from $2.50 / from $15.00')
    expect(
      regularButton?.find('[data-tip="Deep research"]').exists(),
    ).toBe(false)
  })

  it('narrows the list to a single category through the filter dropdown', async () => {
    const wrapper = await openPicker()

    expect(findModelButton(wrapper, 'GPT-5.4')).toBeTruthy()

    await wrapper.get('[data-testid="models-picker-filter-research"]')
      .trigger('click')

    expect(findModelButton(wrapper, 'GPT-5.4')).toBeUndefined()
    expect(findModelButton(wrapper, 'o4-mini Deep Research')).toBeTruthy()
  })

  it('narrows the list to a single provider through the rail', async () => {
    const wrapper = await openPicker()

    await wrapper.get('[data-testid="models-picker-rail-openai"]')
      .trigger('click')

    expect(findModelButton(wrapper, 'GPT-5.4')).toBeTruthy()
    expect(findModelButton(wrapper, 'Nano Banana')).toBeUndefined()

    await wrapper.get('[data-testid="models-picker-rail-openai"]')
      .trigger('click')

    expect(findModelButton(wrapper, 'Nano Banana')).toBeTruthy()
  })
})
