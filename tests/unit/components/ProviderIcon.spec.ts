import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ProviderIcon from '../../../app/components/ProviderIcon.vue'
import { providerMeta } from '#shared/utils/provider-meta'

const expectedIconNames: Record<string, string> = {
  google: 'simple-icons:googlegemini',
  openai: 'simple-icons:openai',
  anthropic: 'simple-icons:anthropic',
  xai: 'logos:grok-icon',
  deepseek: 'simple-icons:deepseek',
  moonshotai: 'simple-icons:moonshotai',
  qwen: 'simple-icons:qwen',
}

async function getIconName(providerId: string): Promise<string | undefined> {
  const wrapper = await mountSuspended(ProviderIcon, {
    props: { providerId },
  })
  const icon = wrapper.findComponent({ name: 'NuxtIcon' })

  return icon.exists() ? (icon.props('name') as string) : undefined
}

describe('ProviderIcon', () => {
  it('renders the expected brand icon for every known provider id',
    async () => {
      for (const [providerId, iconName] of Object.entries(expectedIconNames)) {
        expect(await getIconName(providerId)).toBe(iconName)
      }
    })

  it('renders a single-color simple-icons glyph for every provider except '
    + 'xai, which has no monochrome Grok mark in any collection', () => {
    const nonSimpleIcons = Object.entries(expectedIconNames).filter(
      ([, iconName]) => {
        return !iconName.startsWith('simple-icons:')
      },
    )

    expect(nonSimpleIcons).toEqual([['xai', 'logos:grok-icon']])
  })

  it('falls back to a two-letter badge from the raw id for an unmapped '
    + 'provider with no label prop', async () => {
    const wrapper = await mountSuspended(ProviderIcon, {
      props: { providerId: 'nousresearch' },
    })

    expect(wrapper.findComponent({ name: 'NuxtIcon' }).exists()).toBe(false)
    const badge = wrapper.get('span')

    expect(badge.text()).toBe('no')
    expect(badge.classes()).toContain('uppercase')
  })

  it('prefers an explicit label prop over provider-meta or the raw id',
    async () => {
      const wrapper = await mountSuspended(ProviderIcon, {
        props: { providerId: 'nousresearch', label: 'Nous Research' },
      })

      expect(wrapper.get('span').text()).toBe('No')
    })

  it('leaves a Cloudflare vendor with no verified brand icon on the badge '
    + 'rather than borrowing a wrong logo', async () => {
    const wrapper = await mountSuspended(ProviderIcon, {
      props: { providerId: 'black-forest-labs' },
    })

    expect(wrapper.findComponent({ name: 'NuxtIcon' }).exists()).toBe(false)
    expect(wrapper.get('span').text()).toBe('bl')
  })

  it('resolves a real icon for every provider in providerMeta, '
    + 'so a newly added one cannot silently fall through to the badge',
  async () => {
    for (const providerId of Object.keys(providerMeta)) {
      expect(await getIconName(providerId)).toBeTruthy()
    }
  })
})
