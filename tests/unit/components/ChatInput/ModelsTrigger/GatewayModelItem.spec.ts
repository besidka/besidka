import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { GatewayModel } from '#shared/types/gateways.d'
import GatewayModelItem
  from '../../../../../app/components/ChatInput/ModelsTrigger/GatewayModelItem.vue'

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

  it('keeps the spelled-out price in the badge title only', async () => {
    const wrapper = await mountGatewayModelItem()
    const priceTier = wrapper.get('[data-testid="gateway-model-price-tier"]')

    expect(priceTier.classes()).not.toContain('tooltip')
    expect(priceTier.classes()).not.toContain('tooltip-soft')
    expect(priceTier.classes()).not.toContain('tooltip-bottom')
    expect(priceTier.attributes('title'))
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
    }))

    expect(wrapper.find('[data-testid="gateway-model-capabilities"]').exists())
      .toBe(false)
  })

  it('renders a web-search chip whose title names the resolution',
    async () => {
      const native = await mountGatewayModelItem(createModel({
        supportsWebSearch: 'native',
      }))
      const universal = await mountGatewayModelItem(createModel({
        supportsWebSearch: 'universal',
      }))

      expect(
        native.get('[data-testid="gateway-model-web-search-capability"]')
          .attributes('title'),
      ).toBe('Web search')
      expect(
        universal.get('[data-testid="gateway-model-web-search-capability"]')
          .attributes('title'),
      ).toBe('Web search (gateway-billed)')
    })

  it('renders distinctly colored chips for reasoning, image generation, '
    + 'and vision', async () => {
    const wrapper = await mountGatewayModelItem(createModel({
      supportsReasoning: true,
      supportsImageGeneration: true,
      modalities: { input: ['text', 'image'], output: ['text'] },
    }))
    const reasoning = wrapper.get(
      '[data-testid="gateway-model-reasoning-capability"]',
    )
    const imageGeneration = wrapper.get(
      '[data-testid="gateway-model-image-generation-capability"]',
    )
    const vision = wrapper.get(
      '[data-testid="gateway-model-vision-capability"]',
    )

    expect(reasoning.classes()).toContain('text-warning')
    expect(reasoning.attributes('title')).toBe('Reasoning')
    expect(imageGeneration.classes()).toContain('text-violet-700')
    expect(imageGeneration.attributes('title')).toBe('Image generation')
    expect(vision.classes()).toContain('text-accent')
    expect(vision.classes()).not.toContain('text-secondary')
    expect(vision.attributes('title')).toBe('Vision')
  })

  it('keeps image generation and vision as separate chips for a model that '
    + 'only generates images without accepting image input', async () => {
    const wrapper = await mountGatewayModelItem(createModel({
      supportsImageGeneration: true,
      modalities: { input: ['text'], output: ['text', 'image'] },
    }))

    expect(wrapper.find(
      '[data-testid="gateway-model-image-generation-capability"]',
    ).exists()).toBe(true)
    expect(wrapper.find(
      '[data-testid="gateway-model-vision-capability"]',
    ).exists()).toBe(false)
  })

  it('never earns the tool-calling wrench from the advisory supportsTools '
    + 'alone', async () => {
    const wrapper = await mountGatewayModelItem(createModel({
      supportsTools: true,
    }))

    expect(wrapper.find('[title="Tool calling"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="gateway-model-capabilities"]').exists())
      .toBe(false)
  })

  it('shows the tool-calling icon for a model with toolCall, styled as a '
    + 'neutral circle with a short title', async () => {
    const wrapper = await mountGatewayModelItem(createModel({
      toolCall: true,
    }))
    const toolCall = wrapper.get(
      '[data-testid="gateway-model-tool-call-capability"]',
    )

    expect(toolCall.classes()).toContain('bg-base-200')
    expect(toolCall.classes()).toContain('dark:bg-base-300')
    expect(toolCall.classes()).toContain('text-slate-700')
    expect(toolCall.classes()).not.toContain('capability-chip')
    expect(toolCall.attributes('title')).toBe('Tool calling')
  })

  it('hides the tool-calling icon for a model without toolCall', async () => {
    const wrapper = await mountGatewayModelItem(createModel({
      toolCall: false,
    }))

    expect(wrapper.find(
      '[data-testid="gateway-model-tool-call-capability"]',
    ).exists()).toBe(false)
  })

  it('still renders the capability group for a model whose only '
    + 'capability is tool calling', async () => {
    const wrapper = await mountGatewayModelItem(createModel({
      toolCall: true,
    }))

    expect(wrapper.find('[data-testid="gateway-model-capabilities"]').exists())
      .toBe(true)
    expect(wrapper.find(
      '[data-testid="gateway-model-tool-call-capability"]',
    ).exists()).toBe(true)
  })

  it('renders every capability chip icon at a smaller shrunk size in '
    + 'an unchanged 20px circle', async () => {
    const wrapper = await mountGatewayModelItem(createModel({
      supportsReasoning: true,
      supportsWebSearch: 'native',
      toolCall: true,
    }))
    const capabilities = wrapper.get(
      '[data-testid="gateway-model-capabilities"]',
    )
    const icons = capabilities.findAll('.iconify')

    expect(icons.length).toBeGreaterThan(0)

    icons.forEach((icon) => {
      expect(icon.attributes('style')).toContain('font-size: 12px')

      const chip = icon.element.parentElement

      expect(chip?.classList.contains('p-1')).toBe(true)
      expect(chip?.classList.contains('p-0.5')).toBe(false)
    })
  })

  it('never leaves a data-tip attribute behind on a fully capable row',
    async () => {
      const wrapper = await mountGatewayModelItem(createModel({
        supportsReasoning: true,
        supportsWebSearch: 'universal',
        supportsImageGeneration: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
        toolCall: true,
      }))

      expect(wrapper.find('[data-tip]').exists()).toBe(false)
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

  it('labels the favorite button with a native title and drops the '
    + 'tooltip', async () => {
    const wrapper = await mountGatewayModelItem()
    const favorite = wrapper.get(
      '[data-testid="gateway-model-favorite-toggle"]',
    )

    expect(favorite.attributes('aria-label'))
      .toBe('Add Claude Opus 5 to favorites')
    expect(favorite.attributes('title')).toBe('Add to favorites')
    expect(favorite.classes()).not.toContain('tooltip')
    expect(favorite.classes()).not.toContain('tooltip-left')
  })

  it('labels the button for removing an existing favorite', async () => {
    const wrapper = await mountGatewayModelItem(createModel(), {
      isFavorite: true,
    })
    const favorite = wrapper.get(
      '[data-testid="gateway-model-favorite-toggle"]',
    )

    expect(favorite.attributes('aria-label'))
      .toBe('Remove Claude Opus 5 from favorites')
    expect(favorite.attributes('title')).toBe('Remove from favorites')
  })

  it('keys the option off the gateway model id', async () => {
    const wrapper = await mountGatewayModelItem()

    expect(wrapper.get('li').attributes('id'))
      .toBe('gateway-model-option-anthropic/claude-opus-5')
  })
})
