import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import PresetCard from '../../../../../app/components/Profile/Connectors/PresetCard.vue'
import { CONNECTOR_PRESETS } from '../../../../../config/connectors-catalog'

enableAutoUnmount(afterEach)

const linear = CONNECTOR_PRESETS.find(preset => preset.id === 'linear')!

function mountCard(props: Partial<{ isAdded: boolean, isBusy: boolean }> = {}) {
  return mountSuspended(PresetCard, {
    props: { preset: linear, isAdded: false, isBusy: false, ...props },
  })
}

describe('Profile/Connectors/PresetCard', () => {
  it('shows the name, the auth kinds and a brand mark, and emits Add', async () => {
    const wrapper = await mountCard()

    expect(wrapper.text()).toContain('Linear')
    expect(wrapper.text()).toContain('Sign in or API key or token')
    expect(wrapper.find('[data-testid="connector-avatar-brand"]').exists())
      .toBe(true)

    await wrapper.find('[data-testid="connector-preset-add-linear"]')
      .trigger('click')

    expect(wrapper.emitted('add')?.[0]).toEqual(['linear'])
  })

  it('says Added and disables the button for an existing connector', async () => {
    const wrapper = await mountCard({ isAdded: true })
    const button = wrapper.find('[data-testid="connector-preset-add-linear"]')

    expect(button.text()).toBe('Added')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('disables the button while another add is running', async () => {
    const wrapper = await mountCard({ isBusy: true })

    expect(wrapper.find('[data-testid="connector-preset-add-linear"]')
      .attributes('disabled')).toBeDefined()
  })
})
