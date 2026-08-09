import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { GatewayId } from '#shared/types/gateways.d'
import GatewayRail
  from '../../../../../app/components/ChatInput/ModelsTrigger/GatewayRail.vue'

const gateways: Array<{ id: GatewayId, label: string }> = [
  { id: 'vercel', label: 'Vercel AI Gateway' },
  { id: 'openrouter', label: 'OpenRouter' },
]

function mountRail(
  props: Partial<{
    gateways: Array<{ id: GatewayId, label: string }>
    activeGatewayId: GatewayId | null
    isPending: boolean
  }> = {},
) {
  return mountSuspended(GatewayRail, {
    props: {
      gateways,
      activeGatewayId: null,
      isPending: false,
      ...props,
    },
  })
}

describe('ChatInput/ModelsTrigger/GatewayRail', () => {
  it('renders one labelled button per gateway', async () => {
    const wrapper = await mountRail()
    const vercel = wrapper.get('[data-testid="models-picker-gateway-vercel"]')
    const openrouter = wrapper.get(
      '[data-testid="models-picker-gateway-openrouter"]',
    )

    expect(vercel.text()).toContain('Vercel AI Gateway')
    expect(vercel.attributes('aria-label'))
      .toBe('Browse Vercel AI Gateway models')
    expect(vercel.attributes('aria-pressed')).toBe('false')
    expect(openrouter.text()).toContain('OpenRouter')
  })

  it('renders only the gateways it is given', async () => {
    const wrapper = await mountRail({
      gateways: [{ id: 'vercel', label: 'Vercel AI Gateway' }],
    })

    expect(wrapper.find('[data-testid="models-picker-gateway-openrouter"]')
      .exists()).toBe(false)
    expect(wrapper.find('[data-testid="models-picker-gateway-cloudflare"]')
      .exists()).toBe(false)
  })

  it('emits toggleGateway with the clicked gateway id', async () => {
    const wrapper = await mountRail()

    await wrapper.get('[data-testid="models-picker-gateway-openrouter"]')
      .trigger('click')

    expect(wrapper.emitted('toggleGateway')).toEqual([['openrouter']])
  })

  it('marks the active gateway with a solid fill, unlike the provider rail', async () => {
    const wrapper = await mountRail({ activeGatewayId: 'vercel' })
    const vercel = wrapper.get('[data-testid="models-picker-gateway-vercel"]')
    const openrouter = wrapper.get(
      '[data-testid="models-picker-gateway-openrouter"]',
    )

    expect(vercel.attributes('aria-pressed')).toBe('true')
    expect(vercel.classes()).toContain('btn-accent')
    expect(vercel.classes()).not.toContain('btn-ghost')
    expect(openrouter.attributes('aria-pressed')).toBe('false')
    expect(openrouter.classes()).toContain('btn-ghost')
    expect(openrouter.classes()).not.toContain('btn-accent')
  })

  it('offers leaving gateway mode through the active button', async () => {
    const wrapper = await mountRail({ activeGatewayId: 'vercel' })

    expect(
      wrapper.get('[data-testid="models-picker-gateway-vercel"]')
        .attributes('aria-label'),
    ).toBe('Leave Vercel AI Gateway and show provider models')
  })

  it('shows a spinner only on the gateway whose catalog is loading', async () => {
    const wrapper = await mountRail({
      activeGatewayId: 'vercel',
      isPending: true,
    })

    expect(
      wrapper.get('[data-testid="models-picker-gateway-vercel"]')
        .find('[data-testid="models-picker-gateway-pending"]').exists(),
    ).toBe(true)
    expect(
      wrapper.get('[data-testid="models-picker-gateway-openrouter"]')
        .find('[data-testid="models-picker-gateway-pending"]').exists(),
    ).toBe(false)
  })

  it('hides the spinner when no catalog is loading', async () => {
    const wrapper = await mountRail({ activeGatewayId: 'vercel' })

    expect(wrapper.find('[data-testid="models-picker-gateway-pending"]')
      .exists()).toBe(false)
  })

  it('renders brand marks for the known gateways', async () => {
    const wrapper = await mountRail()

    expect(
      wrapper.get('[data-testid="models-picker-gateway-vercel"]').find('svg')
        .exists(),
    ).toBe(true)
    expect(
      wrapper.get('[data-testid="models-picker-gateway-openrouter"]')
        .find('svg').exists(),
    ).toBe(true)
  })
})
