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

  it('renders the name and price tier with a color-matched tooltip', async () => {
    const wrapper = await mountModelItem()
    const priceTier = wrapper.get('[data-testid="model-price-tier"]')

    expect(wrapper.text()).toContain('GPT-5.4')
    expect(priceTier.text()).toContain('$$')
    expect(priceTier.classes()).toContain('badge-info')
    expect(priceTier.classes()).toContain('tooltip')
    expect(priceTier.classes()).toContain('tooltip-soft')
    expect(priceTier.classes()).toContain('tooltip-bottom')
    expect(priceTier.attributes('data-tip')).toBe('from $2.50 / from $15.00')
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
    const wrapper = await mountModelItem()

    expect(wrapper.find('[data-testid="model-capabilities"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-tip="Reasoning"]').exists()).toBe(false)
    expect(wrapper.find('[data-tip="Web search"]').exists()).toBe(false)
    expect(wrapper.find('[data-tip="Deep research"]').exists()).toBe(false)
    expect(wrapper.find(
      '[data-testid="model-image-generation-capability"]',
    ).exists()).toBe(false)
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
    expect(wrapper.find('[data-tip="Reasoning"]').exists()).toBe(true)
    expect(wrapper.find('[data-tip="Web search"]').exists()).toBe(true)
    expect(wrapper.find('[data-tip="Deep research"]').exists()).toBe(true)
    expect(wrapper.find(
      '[data-testid="model-image-generation-capability"]',
    ).exists()).toBe(true)
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
    expect(favorite.attributes('data-tip')).toBe('Add to favorites')
    expect(favorite.classes()).toContain('tooltip')
    expect(favorite.classes()).toContain('tooltip-left')
    expect(favorite.classes()).not.toContain('tooltip-soft')
    expect(favorite.classes()).not.toContain('tooltip-success')
    expect(favorite.classes()).not.toContain('tooltip-info')
    expect(favorite.classes()).not.toContain('tooltip-warning')
    expect(favorite.classes()).not.toContain('tooltip-error')

    await favorite.trigger('click')

    expect(wrapper.emitted('toggleFavorite')).toHaveLength(1)
  })

  it('labels the button for removing an existing favorite', async () => {
    const wrapper = await mountModelItem(createModel(), { isFavorite: true })
    const favorite = wrapper.get('[data-testid="model-favorite-toggle"]')

    expect(favorite.attributes('aria-label'))
      .toBe('Remove GPT-5.4 from favorites')
    expect(favorite.attributes('aria-pressed')).toBe('true')
    expect(favorite.attributes('data-tip')).toBe('Remove from favorites')
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
})
