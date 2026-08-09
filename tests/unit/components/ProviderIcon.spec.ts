import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ProviderIcon from '../../../app/components/ProviderIcon.vue'

const knownProviderIds = [
  'google',
  'openai',
  'anthropic',
  'xai',
  'deepseek',
  'moonshotai',
  'vercel',
  'openrouter',
  'cloudflare',
]

describe('ProviderIcon', () => {
  it('renders a brand svg for every known provider id', async () => {
    for (const providerId of knownProviderIds) {
      const wrapper = await mountSuspended(ProviderIcon, {
        props: { providerId },
      })

      expect(wrapper.find('svg').exists()).toBe(true)
      expect(wrapper.find('span').exists()).toBe(false)
    }
  })

  it('falls back to a two-letter badge from provider-meta for an '
    + 'unrecognized id with no label prop', async () => {
    const wrapper = await mountSuspended(ProviderIcon, {
      props: { providerId: 'mistral' },
    })

    expect(wrapper.find('svg').exists()).toBe(false)
    const badge = wrapper.get('span')

    expect(badge.text()).toBe('mi')
    expect(badge.classes()).toContain('uppercase')
  })

  it('falls back to a two-letter badge for qwen, which has no brand icon '
    + 'asset yet', async () => {
    const wrapper = await mountSuspended(ProviderIcon, {
      props: { providerId: 'qwen' },
    })

    expect(wrapper.find('svg').exists()).toBe(false)
    const badge = wrapper.get('span')

    expect(badge.text()).toBe('Qw')
  })

  it('prefers an explicit label prop over provider-meta or the raw id',
    async () => {
      const wrapper = await mountSuspended(ProviderIcon, {
        props: { providerId: 'mistral', label: 'Mistral' },
      })

      const badge = wrapper.get('span')

      expect(badge.text()).toBe('Mi')
    })

  it('renders the xai icon for the OpenRouter vendor slug "x-ai"',
    async () => {
      const wrapper = await mountSuspended(ProviderIcon, {
        props: { providerId: 'x-ai' },
      })

      expect(wrapper.find('svg').exists()).toBe(true)
      expect(wrapper.find('span').exists()).toBe(false)
    })

  it('renders the matching icon for every tilde-prefixed "latest" alias',
    async () => {
      const tildeAliasProviderIds = [
        '~anthropic',
        '~deepseek',
        '~google',
        '~moonshotai',
        '~openai',
        '~x-ai',
      ]

      for (const providerId of tildeAliasProviderIds) {
        const wrapper = await mountSuspended(ProviderIcon, {
          props: { providerId },
        })

        expect(wrapper.find('svg').exists()).toBe(true)
        expect(wrapper.find('span').exists()).toBe(false)
      }
    })
})
