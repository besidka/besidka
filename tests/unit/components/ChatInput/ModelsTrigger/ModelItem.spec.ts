import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Model } from '#shared/types/providers.d'
import ModelItem
  from '../../../../../app/components/ChatInput/ModelsTrigger/ModelItem.vue'

const mocks = vi.hoisted(() => ({
  useDevice: vi.fn(),
}))

mockNuxtImport('useDevice', () => mocks.useDevice)

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    description: 'Flagship chat model',
    contextLength: 400_000,
    maxOutputTokens: 128_000,
    price: {
      tokens: 1_000_000,
      input: 'from $2.50',
      output: 'from $15.00',
    },
    priceTier: '$$',
    modalities: {
      input: ['text', 'image'],
      output: ['text'],
    },
    tools: [],
    toolCall: true,
    ...overrides,
  }
}

function mountModelItem(
  model: Model = createModel(),
  props: Partial<{
    providerId: string
    isSelected: boolean
    isHighlighted: boolean
    isFavorite: boolean
    isDetailOpen: boolean
    isLegacy: boolean
    isKeyMissing: boolean
    providerName: string
  }> = {},
) {
  return mountSuspended(ModelItem, {
    props: {
      model,
      providerId: 'openai',
      isSelected: false,
      isHighlighted: false,
      isFavorite: false,
      isDetailOpen: false,
      ...props,
    },
  })
}

describe('ChatInput/ModelsTrigger/ModelItem', () => {
  beforeEach(() => {
    mocks.useDevice.mockReturnValue({
      isIos: false,
      isAndroid: false,
      isDesktop: true,
    })
  })

  it('exposes the option as a listbox option keyed by the model id', async () => {
    const wrapper = await mountModelItem()
    const option = wrapper.get('li')

    expect(option.attributes('id')).toBe('model-option-gpt-5.4')
    expect(option.attributes('role')).toBe('option')
    expect(option.attributes('aria-selected')).toBe('false')
  })

  it('marks the option as selected for the active model', async () => {
    const wrapper = await mountModelItem(createModel(), { isSelected: true })

    expect(wrapper.get('li').attributes('aria-selected')).toBe('true')
  })

  it('renders the name and price tier with a color-matched title', async () => {
    const wrapper = await mountModelItem()
    const priceTier = wrapper.get('[data-testid="model-price-tier"]')

    expect(wrapper.text()).toContain('GPT-5.4')
    expect(priceTier.text()).toContain('$$')
    expect(priceTier.classes()).toContain('badge-info')
    expect(priceTier.classes()).not.toContain('tooltip')
    expect(priceTier.classes()).not.toContain('tooltip-soft')
    expect(priceTier.classes()).not.toContain('tooltip-bottom')
    expect(priceTier.attributes('title')).toBe('from $2.50 / from $15.00')
    expect(priceTier.get('.sr-only').text()).toBe('from $2.50 / from $15.00')
  })

  it('keeps the description out of the compact row', async () => {
    const wrapper = await mountModelItem()

    expect(wrapper.text()).not.toContain('Flagship chat model')
  })

  it('never renders an inline deprecated badge', async () => {
    const wrapper = await mountModelItem(createModel({
      status: 'deprecated',
    }))

    expect(wrapper.find('[data-testid="model-deprecated-badge"]').exists())
      .toBe(false)
    expect(wrapper.get('button[aria-label="Choose GPT-5.4"]').exists())
      .toBe(true)
  })

  it('offers no selectable control for a legacy row', async () => {
    const wrapper = await mountModelItem(
      createModel({ status: 'deprecated' }),
      { isLegacy: true },
    )
    const option = wrapper.get('li')

    expect(wrapper.find('button[aria-label="Choose GPT-5.4"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="model-favorite-toggle"]').exists())
      .toBe(false)
    expect(option.attributes('aria-disabled')).toBe('true')
    expect(option.attributes('aria-selected')).toBe('false')
    expect(wrapper.text()).toContain('Deprecated, no longer selectable.')
  })

  it('keeps the info button working on a legacy row', async () => {
    const wrapper = await mountModelItem(
      createModel({ status: 'deprecated' }),
      { isLegacy: true },
    )
    const info = wrapper.get('[data-testid="model-info-trigger"]')

    await info.trigger('click')

    expect(wrapper.emitted('toggleDetail')).toHaveLength(1)
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('still marks a non-legacy row as selectable and selected', async () => {
    const wrapper = await mountModelItem(createModel(), { isSelected: true })
    const option = wrapper.get('li')

    expect(option.attributes('aria-selected')).toBe('true')
    expect(option.attributes('aria-disabled')).toBeUndefined()
  })

  it('renders no capability icons for a plain model', async () => {
    const wrapper = await mountModelItem(createModel({
      modalities: { input: ['text'], output: ['text'] },
      toolCall: false,
    }))

    expect(wrapper.find('[data-testid="model-capabilities"]').exists())
      .toBe(false)
    expect(wrapper.find('[title="Reasoning"]').exists()).toBe(false)
    expect(wrapper.find('[title="Web search"]').exists()).toBe(false)
    expect(wrapper.find('[title="Deep research"]').exists()).toBe(false)
    expect(wrapper.find(
      '[data-testid="model-image-generation-capability"]',
    ).exists()).toBe(false)
    expect(wrapper.find(
      '[data-testid="model-vision-capability"]',
    ).exists()).toBe(false)
    expect(wrapper.find(
      '[data-testid="model-tool-call-capability"]',
    ).exists()).toBe(false)
  })

  it('omits the price-tier badge when the model has no price tier', async () => {
    const wrapper = await mountModelItem(
      createModel({ priceTier: undefined }),
    )

    expect(wrapper.find('[data-testid="model-price-tier"]').exists())
      .toBe(false)
  })

  it('places the price tier as a preceding sibling of the capability '
    + 'icons, indenting only the icons on mobile', async () => {
    const model = createModel({
      tools: ['web_search'],
      reasoning: { mode: 'toggle' },
    })
    const wrapper = await mountModelItem(model)
    const priceTier = wrapper.get('[data-testid="model-price-tier"]')
    const capabilities = wrapper.get('[data-testid="model-capabilities"]')

    expect(priceTier.classes()).toContain('max-xs:ml-5')
    expect(capabilities.classes()).toContain('xs:ml-auto')
    expect(capabilities.classes()).toContain('max-xs:-ml-1')
    expect(capabilities.classes()).not.toContain('max-xs:ml-5')
    expect(priceTier.element.nextElementSibling).toBe(capabilities.element)
  })

  it('indents the capability icons on mobile when there is no price '
    + 'tier', async () => {
    const model = createModel({
      priceTier: undefined,
      tools: ['web_search'],
    })
    const wrapper = await mountModelItem(model)
    const capabilities = wrapper.get('[data-testid="model-capabilities"]')

    expect(capabilities.classes()).toContain('max-xs:ml-5')
    expect(capabilities.classes()).not.toContain('max-xs:-ml-1')
  })

  it('renders every capability icon a model declares', async () => {
    const model = createModel({
      tools: ['web_search', 'image_generation'],
      reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
      research: {
        tier: 'quick',
        assistModel: 'gpt-5.4-nano',
        costEstimate: '~$1 / task',
        timeEstimate: '5–15 min',
      },
    })
    const wrapper = await mountModelItem(model)

    expect(wrapper.find('[data-testid="model-capabilities"]').exists())
      .toBe(true)
    expect(wrapper.find('[title="Reasoning"]').exists()).toBe(true)
    expect(wrapper.find('[title="Web search"]').exists()).toBe(true)
    expect(wrapper.find('[title="Deep research"]').exists()).toBe(true)
    expect(wrapper.find(
      '[data-testid="model-image-generation-capability"]',
    ).exists()).toBe(true)
    expect(wrapper.find(
      '[data-testid="model-vision-capability"]',
    ).exists()).toBe(true)
    expect(wrapper.find(
      '[data-testid="model-tool-call-capability"]',
    ).exists()).toBe(true)
  })

  it('renders every capability chip icon at a smaller shrunk size in '
    + 'an unchanged 20px circle', async () => {
    const model = createModel({
      tools: ['web_search'],
      reasoning: { mode: 'toggle' },
    })
    const wrapper = await mountModelItem(model)
    const capabilities = wrapper.get('[data-testid="model-capabilities"]')
    const icons = capabilities.findAll('.iconify')

    expect(icons.length).toBeGreaterThan(0)

    icons.forEach((icon) => {
      expect(icon.attributes('style')).toContain('font-size: 12px')

      const chip = icon.element.parentElement

      expect(chip?.classList.contains('p-1')).toBe(true)
      expect(chip?.classList.contains('p-0.5')).toBe(false)
    })
  })

  it('never leaves a data-tip attribute behind on a fully capable row', async () => {
    const model = createModel({
      tools: ['web_search', 'image_generation'],
      reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
      research: {
        tier: 'quick',
        assistModel: 'gpt-5.4-nano',
        costEstimate: '~$1 / task',
        timeEstimate: '5–15 min',
      },
    })
    const wrapper = await mountModelItem(model)

    expect(wrapper.find('[data-tip]').exists()).toBe(false)
  })

  it('shows the tool-calling icon for a model with toolCall, styled as a '
    + 'neutral circle with a short title', async () => {
    const wrapper = await mountModelItem(createModel({ toolCall: true }))
    const toolCall = wrapper.get('[data-testid="model-tool-call-capability"]')

    expect(toolCall.classes()).toContain('bg-base-200')
    expect(toolCall.classes()).toContain('dark:bg-base-300')
    expect(toolCall.classes()).toContain('text-slate-700')
    expect(toolCall.classes()).not.toContain('capability-chip')
    expect(toolCall.attributes('title')).toBe('Tool calling')
  })

  it('hides the tool-calling icon for a model without toolCall', async () => {
    const wrapper = await mountModelItem(createModel({ toolCall: false }))

    expect(wrapper.find(
      '[data-testid="model-tool-call-capability"]',
    ).exists()).toBe(false)
  })

  it('still renders the capability group for a model whose only '
    + 'capability is tool calling', async () => {
    const wrapper = await mountModelItem(createModel({
      modalities: { input: ['text'], output: ['text'] },
      toolCall: true,
    }))

    expect(wrapper.find('[data-testid="model-capabilities"]').exists())
      .toBe(true)
    expect(wrapper.find(
      '[data-testid="model-tool-call-capability"]',
    ).exists()).toBe(true)
  })

  it('shows the vision icon for a model with image input, fully '
    + 'separate from image generation', async () => {
    const model = createModel({
      modalities: { input: ['text', 'image'], output: ['text'] },
    })
    const wrapper = await mountModelItem(model)
    const vision = wrapper.get('[data-testid="model-vision-capability"]')

    expect(vision.classes()).toContain('text-accent')
    expect(vision.attributes('title')).toBe('Vision')
    expect(wrapper.find(
      '[data-testid="model-image-generation-capability"]',
    ).exists()).toBe(false)
  })

  it('hides the vision icon for a text-only model', async () => {
    const model = createModel({
      modalities: { input: ['text'], output: ['text'] },
    })
    const wrapper = await mountModelItem(model)

    expect(wrapper.find(
      '[data-testid="model-vision-capability"]',
    ).exists()).toBe(false)
  })

  it('shows the brain icon with an always-on label for a model with '
    + 'reasoningAlwaysOn but no reasoning capability', async () => {
    const model = createModel({ reasoningAlwaysOn: true })
    const wrapper = await mountModelItem(model)

    expect(wrapper.find('[data-testid="model-capabilities"]').exists())
      .toBe(true)
    expect(wrapper.find('[title="Always-on reasoning"]').exists())
      .toBe(true)
    expect(wrapper.find('[title="Reasoning"]').exists()).toBe(false)
  })

  it('renders the image generation icon for a purpose-built image model', async () => {
    const model = createModel({
      tools: [],
      imageGeneration: { controllerModel: 'gpt-5-nano' },
    })
    const wrapper = await mountModelItem(model)

    expect(wrapper.find(
      '[data-testid="model-image-generation-capability"]',
    ).exists()).toBe(true)
  })

  it('emits select when the model button is clicked', async () => {
    const wrapper = await mountModelItem()

    await wrapper.get('button[aria-label="Choose GPT-5.4"]').trigger('click')

    expect(wrapper.emitted('select')).toHaveLength(1)
  })

  it('places the favorite toggle past the info button', async () => {
    const wrapper = await mountModelItem()
    const actions = wrapper
      .get('[data-testid="model-actions"]')
      .findAll('button')
      .map((button) => {
        return button.attributes('data-testid')
      })

    expect(actions).toEqual(['model-info-trigger', 'model-favorite-toggle'])
  })

  it('emits toggleFavorite and labels the button for adding a favorite', async () => {
    const wrapper = await mountModelItem()
    const favorite = wrapper.get('[data-testid="model-favorite-toggle"]')

    expect(favorite.attributes('aria-label'))
      .toBe('Add GPT-5.4 to favorites')
    expect(favorite.attributes('aria-pressed')).toBe('false')
    expect(favorite.attributes('title')).toBe('Add to favorites')
    expect(favorite.classes()).not.toContain('tooltip')
    expect(favorite.classes()).not.toContain('tooltip-left')

    await favorite.trigger('click')

    expect(wrapper.emitted('toggleFavorite')).toHaveLength(1)
  })

  it('labels the button for removing an existing favorite', async () => {
    const wrapper = await mountModelItem(createModel(), { isFavorite: true })
    const favorite = wrapper.get('[data-testid="model-favorite-toggle"]')

    expect(favorite.attributes('aria-label'))
      .toBe('Remove GPT-5.4 from favorites')
    expect(favorite.attributes('aria-pressed')).toBe('true')
    expect(favorite.attributes('title')).toBe('Remove from favorites')
  })

  it('omits the detail panel id while the detail panel is closed', async () => {
    const wrapper = await mountModelItem()
    const info = wrapper.get('[data-testid="model-info-trigger"]')

    expect(info.attributes('aria-label')).toBe('About GPT-5.4')
    expect(info.attributes('aria-controls')).toBeUndefined()
    expect(info.attributes('aria-describedby')).toBeUndefined()
    expect(info.attributes('aria-expanded')).toBe('false')
  })

  it('points the info button at the detail panel id while it is open', async () => {
    const wrapper = await mountModelItem(createModel(), { isDetailOpen: true })
    const info = wrapper.get('[data-testid="model-info-trigger"]')

    expect(info.attributes('aria-controls')).toBe('model-detail-gpt-5.4')
    expect(info.attributes('aria-describedby')).toBe('model-detail-gpt-5.4')
    expect(info.attributes('aria-expanded')).toBe('true')
    expect(info.classes()).toContain('btn-active')
  })

  it('ignores hover and focus and only toggles the detail on click on desktop', async () => {
    const wrapper = await mountModelItem()
    const info = wrapper.get('[data-testid="model-info-trigger"]')

    await info.trigger('mouseenter')
    await info.trigger('focus')
    await info.trigger('mouseleave')
    await info.trigger('blur')

    expect(wrapper.emitted('toggleDetail')).toBeUndefined()

    await info.trigger('click')

    expect(wrapper.emitted('toggleDetail')).toHaveLength(1)
  })

  it('ignores hover and focus and only toggles the detail on tap on touch', async () => {
    mocks.useDevice.mockReturnValue({
      isIos: true,
      isAndroid: false,
      isDesktop: false,
    })

    const wrapper = await mountModelItem()
    const info = wrapper.get('[data-testid="model-info-trigger"]')

    await info.trigger('focus')
    await info.trigger('mouseenter')

    expect(wrapper.emitted('toggleDetail')).toBeUndefined()

    await info.trigger('click')

    expect(wrapper.emitted('toggleDetail')).toHaveLength(1)
  })

  it('highlights the keyboard-focused row without the selected styling', async () => {
    const wrapper = await mountModelItem(createModel(), {
      isHighlighted: true,
    })
    const row = wrapper.get('li > div')

    expect(row.classes()).toContain('bg-base-content/10')
    expect(row.classes()).not.toContain('bg-accent/15')
  })

  it('prefers the selected styling over the highlighted styling', async () => {
    const wrapper = await mountModelItem(createModel(), {
      isSelected: true,
      isHighlighted: true,
    })
    const row = wrapper.get('li > div')

    expect(row.classes()).toContain('bg-accent/15')
    expect(row.classes()).not.toContain('bg-base-content/10')
  })

  describe('missing provider key', () => {
    it('renders the row as non-interactive and says why', async () => {
      const wrapper = await mountModelItem(createModel(), {
        isKeyMissing: true,
        providerName: 'OpenAI',
      })

      expect(wrapper.get('li').attributes('aria-disabled')).toBe('true')
      expect(wrapper.find('button[aria-label="Choose GPT-5.4"]').exists())
        .toBe(false)
      expect(wrapper.get('[data-testid="model-key-required"]').text())
        .toContain('Key required')
      expect(wrapper.get('.sr-only').text())
        .toBe('Add your OpenAI API key to use this model.')
    })

    it('does not emit a selection when the row is clicked', async () => {
      const wrapper = await mountModelItem(createModel(), {
        isKeyMissing: true,
        providerName: 'OpenAI',
      })

      await wrapper.get('li > div > div').trigger('click')

      expect(wrapper.emitted('select')).toBeUndefined()
    })

    it('drops the selected and highlighted backgrounds', async () => {
      const wrapper = await mountModelItem(createModel(), {
        isKeyMissing: true,
        isSelected: true,
        isHighlighted: true,
      })
      const row = wrapper.get('li > div')

      expect(row.classes()).not.toContain('bg-accent/15')
      expect(row.classes()).not.toContain('bg-base-content/10')
      expect(wrapper.get('li').attributes('aria-selected')).toBe('false')
    })

    it('keeps the info and favorite actions reachable', async () => {
      const wrapper = await mountModelItem(createModel(), {
        isKeyMissing: true,
      })

      await wrapper.get('[data-testid="model-info-trigger"]').trigger('click')
      await wrapper.get('[data-testid="model-favorite-toggle"]')
        .trigger('click')

      expect(wrapper.emitted('toggleDetail')).toHaveLength(1)
      expect(wrapper.emitted('toggleFavorite')).toHaveLength(1)
    })

    it('stays fully selectable when the key is present', async () => {
      const wrapper = await mountModelItem(createModel(), {
        providerName: 'OpenAI',
      })

      expect(wrapper.get('li').attributes('aria-disabled')).toBeUndefined()
      expect(wrapper.find('[data-testid="model-key-required"]').exists())
        .toBe(false)

      await wrapper.get('button[aria-label="Choose GPT-5.4"]').trigger('click')

      expect(wrapper.emitted('select')).toHaveLength(1)
    })

    describe('price-tier badge margin composition', () => {
      it('indents the price tier on mobile when the price tier is the '
        + 'first badge (key present)', async () => {
        const wrapper = await mountModelItem(createModel({ priceTier: '$$' }))
        const priceTier = wrapper.get('[data-testid="model-price-tier"]')

        expect(priceTier.classes()).toContain('max-xs:ml-5')
        expect(priceTier.classes()).toContain('badge-info')
        expect(wrapper.find('[data-testid="model-key-required"]').exists())
          .toBe(false)
      })

      it('drops the price tier indent on mobile when the key is missing, '
        + 'since the key-required badge already indents that row', async () => {
        const wrapper = await mountModelItem(createModel({ priceTier: '$$' }), {
          isKeyMissing: true,
        })
        const priceTier = wrapper.get('[data-testid="model-price-tier"]')
        const keyRequired = wrapper.get('[data-testid="model-key-required"]')

        expect(keyRequired.classes()).toContain('max-xs:ml-5')
        expect(priceTier.classes()).not.toContain('max-xs:ml-5')
        expect(priceTier.classes()).toContain('badge-info')
      })

      it('indents the key-required badge on mobile when there is no '
        + 'price tier to render', async () => {
        const wrapper = await mountModelItem(
          createModel({ priceTier: undefined }),
          { isKeyMissing: true },
        )
        const keyRequired = wrapper.get('[data-testid="model-key-required"]')

        expect(keyRequired.classes()).toContain('max-xs:ml-5')
        expect(wrapper.find('[data-testid="model-price-tier"]').exists())
          .toBe(false)
      })

      it('renders neither badge when the key is present and there is no '
        + 'price tier', async () => {
        const wrapper = await mountModelItem(
          createModel({ priceTier: undefined }),
        )

        expect(wrapper.find('[data-testid="model-key-required"]').exists())
          .toBe(false)
        expect(wrapper.find('[data-testid="model-price-tier"]').exists())
          .toBe(false)
      })
    })
  })
})
