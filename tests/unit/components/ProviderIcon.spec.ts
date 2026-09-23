import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ProviderIcon from '../../../app/components/ProviderIcon.vue'
import { providerMeta } from '#shared/utils/provider-meta'

const expectedIconNames: Record<string, string> = {
  google: 'simple-icons:googlegemini',
  openai: 'simple-icons:openai',
  anthropic: 'simple-icons:anthropic',
  xai: 'bxl:grok',
  deepseek: 'simple-icons:deepseek',
  moonshotai: 'simple-icons:moonshotai',
  qwen: 'simple-icons:qwen',
  brave: 'simple-icons:brave',
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

  it('renders a simple-icons glyph for every provider except xai, which has '
    + 'no Grok entry in that collection', () => {
    const nonSimpleIcons = Object.entries(expectedIconNames).filter(
      ([, iconName]) => {
        return !iconName.startsWith('simple-icons:')
      },
    )

    expect(nonSimpleIcons).toEqual([['xai', 'bxl:grok']])
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

  it('resolves a real icon for every provider- and gateway-kind entry in '
    + 'providerMeta, so a newly added one cannot silently fall through to '
    + 'the badge',
  async () => {
    const iconBackedIds = Object.values(providerMeta).filter((meta) => {
      return meta.kind === 'provider' || meta.kind === 'gateway'
    }).map(meta => meta.id)

    for (const providerId of iconBackedIds) {
      expect(await getIconName(providerId)).toBeTruthy()
    }
  })

  it('resolves the three gateway vendor icons directly, in the order the '
    + 'keys page and picker rail render them', async () => {
    expect(await getIconName('cloudflare')).toBe('simple-icons:cloudflare')
    expect(await getIconName('openrouter')).toBe('simple-icons:openrouter')
    expect(await getIconName('vercel')).toBe('simple-icons:vercel')
  })

  it('resolves every gateway-vendor prefix icon added for the model picker '
    + 'rail', async () => {
    const gatewayVendorIcons: Record<string, string> = {
      bytedance: 'simple-icons:bytedance',
      deepgram: 'simple-icons:deepgram',
      huggingface: 'simple-icons:huggingface',
      ibm: 'simple-icons:ibm',
      meta: 'simple-icons:meta',
      microsoft: 'simple-icons:microsoft',
      mistral: 'simple-icons:mistralai',
      nvidia: 'simple-icons:nvidia',
      pipecat: 'simple-icons:pipecat',
      zhipu: 'thesvg:zhipu',
    }

    for (const [providerId, iconName] of Object.entries(gatewayVendorIcons)) {
      expect(await getIconName(providerId)).toBe(iconName)
    }
  })

  it('resolves the OpenRouter and Cloudflare vendor-prefix overrides to '
    + 'their real icon key', async () => {
    expect(await getIconName('x-ai')).toBe('bxl:grok')
    expect(await getIconName('z-ai')).toBe('thesvg:zhipu')
    expect(await getIconName('~anthropic')).toBe('simple-icons:anthropic')
    expect(await getIconName('~deepseek')).toBe('simple-icons:deepseek')
    expect(await getIconName('~google')).toBe('simple-icons:googlegemini')
    expect(await getIconName('~moonshotai')).toBe('simple-icons:moonshotai')
    expect(await getIconName('~openai')).toBe('simple-icons:openai')
    expect(await getIconName('~x-ai')).toBe('bxl:grok')
    expect(await getIconName('deepseek-ai')).toBe('simple-icons:deepseek')
    expect(await getIconName('facebook')).toBe('simple-icons:meta')
    expect(await getIconName('meta-llama')).toBe('simple-icons:meta')
    expect(await getIconName('mistralai')).toBe('simple-icons:mistralai')
    expect(await getIconName('ibm-granite')).toBe('simple-icons:ibm')
    expect(await getIconName('pipecat-ai')).toBe('simple-icons:pipecat')
    expect(await getIconName('zai-org')).toBe('thesvg:zhipu')
  })

  it('resolves a real icon for the brave search provider, and leaves exa '
    + 'on the badge fallback since it has no verified brand icon yet',
  async () => {
    expect(await getIconName('brave')).toBe('simple-icons:brave')

    const wrapper = await mountSuspended(ProviderIcon, {
      props: { providerId: 'exa' },
    })

    expect(wrapper.findComponent({ name: 'NuxtIcon' }).exists()).toBe(false)
    expect(wrapper.get('span').text()).toBe('Ex')
  })
})
