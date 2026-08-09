import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayModel } from '#shared/types/gateways.d'
import GatewayModelItem
  from '../../../../../app/components/ChatInput/ModelsTrigger/GatewayModelItem.vue'

const mocks = vi.hoisted(() => ({
  useDevice: vi.fn(),
}))

mockNuxtImport('useDevice', () => mocks.useDevice)

function createModel(overrides: Partial<GatewayModel> = {}): GatewayModel {
  return {
    id: 'anthropic/claude-opus-5',
    name: 'Claude Opus 5',
    pricing: { input: '0.0000025', output: '0.00001' },
    ...overrides,
  }
}

function mountGatewayModelItem(
  model: GatewayModel = createModel(),
  props: Partial<{
    isSelected: boolean
    isHighlighted: boolean
    isFavorite: boolean
    isDetailOpen: boolean
  }> = {},
) {
  return mountSuspended(GatewayModelItem, {
    props: {
      model,
      isSelected: false,
      isHighlighted: false,
      isFavorite: false,
      isDetailOpen: false,
      ...props,
    },
  })
}

describe('ChatInput/ModelsTrigger/GatewayModelItem', () => {
  beforeEach(() => {
    mocks.useDevice.mockReturnValue({
      isIos: false,
      isAndroid: false,
      isDesktop: true,
    })
  })

  it('shows a price tier badge instead of a raw per-token price', async () => {
    const wrapper = await mountGatewayModelItem()
    const priceTier = wrapper.get('[data-testid="gateway-model-price-tier"]')

    expect(priceTier.text()).toContain('$$$')
    expect(priceTier.classes()).toContain('badge-warning')
    expect(wrapper.find('[data-testid="gateway-model-price"]').exists())
      .toBe(false)
    expect(priceTier.element.childNodes[0]?.textContent?.trim())
      .toBe('$$$')
  })

  it('keeps the spelled-out price in the badge tooltip only', async () => {
    const wrapper = await mountGatewayModelItem()
    const priceTier = wrapper.get('[data-testid="gateway-model-price-tier"]')

    expect(priceTier.attributes('data-tip'))
      .toBe('$2.50 in / $10.00 out per 1M tokens')
    expect(priceTier.get('.sr-only').text())
      .toBe('$2.50 in / $10.00 out per 1M tokens')
  })

  it('omits the price badge entirely when pricing is unknown', async () => {
    const wrapper = await mountGatewayModelItem(
      createModel({ pricing: undefined }),
    )

    expect(wrapper.find('[data-testid="gateway-model-price-tier"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="gateway-model-free"]').exists())
      .toBe(false)
  })

  it('replaces the tier badge with a green free badge at zero cost', async () => {
    const wrapper = await mountGatewayModelItem(createModel({
      pricing: { input: '0', output: '0' },
    }))
    const free = wrapper.get('[data-testid="gateway-model-free"]')

    expect(free.text()).toContain('Free')
    expect(free.classes()).toContain('badge-success')
    expect(wrapper.find('[data-testid="gateway-model-price-tier"]').exists())
      .toBe(false)
  })

  it('keeps charging for output out of the free badge', async () => {
    const wrapper = await mountGatewayModelItem(createModel({
      pricing: { input: '0', output: '0.00001' },
    }))

    expect(wrapper.find('[data-testid="gateway-model-free"]').exists())
      .toBe(false)
    expect(wrapper.get('[data-testid="gateway-model-price-tier"]').text())
      .toContain('$')
  })

  it('renders no capability chips for an unannotated model', async () => {
    const wrapper = await mountGatewayModelItem()

    expect(wrapper.find('[data-testid="gateway-model-capabilities"]').exists())
      .toBe(false)
  })

  it('never treats an unreported capability as present', async () => {
    const wrapper = await mountGatewayModelItem(createModel({
      supportsReasoning: undefined,
      supportsWebSearch: undefined,
    }))

    expect(wrapper.find(
      '[data-testid="gateway-model-reasoning-capability"]',
    ).exists()).toBe(false)
    expect(wrapper.find(
      '[data-testid="gateway-model-web-search-capability"]',
    ).exists()).toBe(false)
  })

  it('never renders a chip for a capability reported as absent', async () => {
    const wrapper = await mountGatewayModelItem(createModel({
      supportsReasoning: false,
      supportsWebSearch: false,
    }))

    expect(wrapper.find('[data-testid="gateway-model-capabilities"]').exists())
      .toBe(false)
  })

  it('renders distinctly colored chips for confirmed capabilities', async () => {
    const wrapper = await mountGatewayModelItem(createModel({
      supportsReasoning: true,
      supportsWebSearch: true,
      modalities: { input: ['text', 'image'], output: ['text'] },
    }))
    const reasoning = wrapper.get(
      '[data-testid="gateway-model-reasoning-capability"]',
    )
    const webSearch = wrapper.get(
      '[data-testid="gateway-model-web-search-capability"]',
    )
    const imageInput = wrapper.get(
      '[data-testid="gateway-model-image-input-capability"]',
    )

    expect(reasoning.classes()).toContain('text-warning')
    expect(reasoning.attributes('data-tip')).toBe('Reasoning')
    expect(webSearch.classes()).toContain('text-info')
    expect(webSearch.attributes('data-tip')).toBe('Web search')
    expect(imageInput.classes()).toContain('text-violet-700')
    expect(imageInput.attributes('data-tip')).toBe('Image input')
  })

  it('drops the near-universal tool-calling wrench from the row', async () => {
    const wrapper = await mountGatewayModelItem(createModel({
      supportsTools: true,
    }))

    expect(wrapper.find('[data-tip="Tool calling"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="gateway-model-capabilities"]').exists())
      .toBe(false)
  })

  it('indents the capability chips on mobile only without a price badge',
    async () => {
      const withPrice = await mountGatewayModelItem(createModel({
        supportsReasoning: true,
      }))
      const withoutPrice = await mountGatewayModelItem(createModel({
        pricing: undefined,
        supportsReasoning: true,
      }))
      const pricedChips = withPrice
        .get('[data-testid="gateway-model-capabilities"]')
      const unpricedChips = withoutPrice
        .get('[data-testid="gateway-model-capabilities"]')

      expect(pricedChips.classes()).toContain('max-xs:-ml-1')
      expect(pricedChips.classes()).not.toContain('max-xs:ml-5')
      expect(unpricedChips.classes()).toContain('max-xs:ml-5')
      expect(unpricedChips.classes()).not.toContain('max-xs:-ml-1')
    })

  it('emits select, favorite and detail from the row controls', async () => {
    const wrapper = await mountGatewayModelItem()

    await wrapper.get('button[aria-label="Choose Claude Opus 5"]')
      .trigger('click')
    await wrapper.get('[data-testid="gateway-model-favorite-toggle"]')
      .trigger('click')
    await wrapper.get('[data-testid="gateway-model-info-trigger"]')
      .trigger('click')

    expect(wrapper.emitted('select')).toHaveLength(1)
    expect(wrapper.emitted('toggleFavorite')).toHaveLength(1)
    expect(wrapper.emitted('toggleDetail')).toHaveLength(1)
  })

  it('keys the option off the gateway model id', async () => {
    const wrapper = await mountGatewayModelItem()

    expect(wrapper.get('li').attributes('id'))
      .toBe('gateway-model-option-anthropic/claude-opus-5')
  })
})
