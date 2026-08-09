import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { GatewayProviderGroup } from '~/types/models-picker'
import GatewayProviderStrip
  from '../../../../../app/components/ChatInput/ModelsTrigger/GatewayProviderStrip.vue'

const providers: GatewayProviderGroup[] = [
  { prefix: 'openai', count: 95 },
  { prefix: 'qwen', count: 49 },
  { prefix: 'x-ai', count: 5 },
]

function mountStrip(activeProviderPrefix: string | null = null) {
  return mountSuspended(GatewayProviderStrip, {
    props: { providers, activeProviderPrefix },
  })
}

describe('ChatInput/ModelsTrigger/GatewayProviderStrip', () => {
  it('renders one chip per underlying provider with its model count',
    async () => {
      const wrapper = await mountStrip()
      const chips = wrapper.findAll(
        '[data-testid="models-picker-gateway-provider-strip"] button',
      )

      expect(chips).toHaveLength(3)
      expect(chips[0]?.text()).toContain('openai')
      expect(chips[0]?.text()).toContain('95')
      expect(chips[2]?.text()).toContain('x-ai')
    })

  it('keeps the chip order the caller supplied', async () => {
    const wrapper = await mountStrip()
    const prefixes = wrapper
      .findAll('[data-testid="models-picker-gateway-provider-strip"] button')
      .map((chip) => {
        return chip.attributes('data-testid')
      })

    expect(prefixes).toEqual([
      'models-picker-gateway-provider-openai',
      'models-picker-gateway-provider-qwen',
      'models-picker-gateway-provider-x-ai',
    ])
  })

  it('marks only the active provider as pressed', async () => {
    const wrapper = await mountStrip('qwen')
    const active = wrapper
      .get('[data-testid="models-picker-gateway-provider-qwen"]')
    const inactive = wrapper
      .get('[data-testid="models-picker-gateway-provider-openai"]')

    expect(active.attributes('aria-pressed')).toBe('true')
    expect(active.classes()).toContain('btn-accent')
    expect(inactive.attributes('aria-pressed')).toBe('false')
    expect(inactive.classes()).toContain('btn-ghost')
  })

  it('labels a chip with what picking it does', async () => {
    const wrapper = await mountStrip()

    expect(wrapper
      .get('[data-testid="models-picker-gateway-provider-openai"]')
      .attributes('aria-label'),
    ).toBe('Show openai models only — 95 models')
  })

  it('labels the active chip as the way back out', async () => {
    const wrapper = await mountStrip('openai')

    expect(wrapper
      .get('[data-testid="models-picker-gateway-provider-openai"]')
      .attributes('aria-label'),
    ).toBe('Stop filtering by openai')
  })

  it('emits the picked prefix', async () => {
    const wrapper = await mountStrip()

    await wrapper
      .get('[data-testid="models-picker-gateway-provider-qwen"]')
      .trigger('click')

    expect(wrapper.emitted('toggleProvider')).toEqual([['qwen']])
  })

  it('scrolls horizontally without a visible scrollbar', async () => {
    const wrapper = await mountStrip()
    const track = wrapper
      .get('[data-testid="models-picker-gateway-provider-strip"] > div')

    expect(track.classes()).toContain('overflow-x-auto')
    expect(track.classes()).toContain('no-scrollbar')
  })
})
