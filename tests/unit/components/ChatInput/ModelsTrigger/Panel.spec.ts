import type { GatewayId } from '#shared/types/gateways.d'
import type { Model } from '#shared/types/providers.d'
import { computed, nextTick, shallowRef } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Panel
  from '../../../../../app/components/ChatInput/ModelsTrigger/Panel.vue'

const mocks = vi.hoisted(() => ({
  getProviders: vi.fn(),
  useDevice: vi.fn(),
  useUserSetting: vi.fn(),
  useUserKeys: vi.fn(),
  useGatewayCatalog: vi.fn(),
  toggleFavoriteModel: vi.fn(),
  toggleFavoriteGatewayModel: vi.fn(),
  getFavoriteGatewayModels: vi.fn(),
  refreshGatewayCatalog: vi.fn(),
  refreshUserKeys: vi.fn(),
}))

mockNuxtImport('getProviders', () => mocks.getProviders)
mockNuxtImport('useDevice', () => mocks.useDevice)
mockNuxtImport('useUserSetting', () => mocks.useUserSetting)
mockNuxtImport('useUserKeys', () => mocks.useUserKeys)
mockNuxtImport('useGatewayCatalog', () => mocks.useGatewayCatalog)

const keyedProviderIds = shallowRef<string[]>([])

const baseModel = {
  description: 'A model',
  contextLength: 32_768,
  maxOutputTokens: 32_768,
  priceTier: '$$',
  price: {
    tokens: 1,
    input: '$0.30',
    output: '$30.00',
  },
  modalities: {
    input: ['text'],
    output: ['text'],
  },
  tools: [],
  toolCall: false,
  reasoning: false,
} as unknown as Omit<Model, 'id' | 'name'>

const googleModel = {
  ...baseModel,
  id: 'google-model',
  name: 'Google model',
} as Model

const imageModel = {
  ...baseModel,
  id: 'image-model',
  name: 'Image model',
  modalities: {
    input: ['text'],
    output: ['image'],
  },
} as Model

const openAiModel = {
  ...baseModel,
  id: 'openai-model',
  name: 'OpenAI model',
} as Model

const gatewayModel = {
  id: 'anthropic/claude-opus-5',
  name: 'Claude Opus 5',
  pricing: { input: '0.0000025', output: '0.00001' },
  toolCall: false,
}

function mountPanel(props: Partial<{
  isOpen: boolean
  selectedModelId: string | null
  selectedGatewayId: GatewayId | null
  filterModel: (model: Model) => boolean
  recommendedModelIds: string[]
  recommendedFilter: boolean
  layout: 'popover' | 'sheet'
}> = {}) {
  return mountSuspended(Panel, {
    attachTo: document.body,
    props: {
      isOpen: true,
      selectedModelId: 'google-model',
      selectedGatewayId: null,
      ...props,
    },
    global: {
      stubs: {
        NuxtLink: {
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  })
}

describe('ChatInput/ModelsTrigger/Panel', () => {
  beforeEach(() => {
    keyedProviderIds.value = ['google', 'vercel']

    mocks.getProviders.mockReturnValue({
      providers: [
        {
          id: 'google',
          name: 'Google AI Studio',
          models: [googleModel, imageModel],
        },
        { id: 'openai', name: 'OpenAI', models: [openAiModel] },
      ],
    })
    mocks.useDevice.mockReturnValue({
      isIos: false,
      isAndroid: false,
      isDesktop: true,
    })
    mocks.getFavoriteGatewayModels.mockReturnValue([])
    mocks.useUserSetting.mockReturnValue({
      favoriteModels: shallowRef<string[]>([]),
      favoriteGatewayModels: shallowRef({}),
      getFavoriteGatewayModels: mocks.getFavoriteGatewayModels,
      toggleFavoriteModel: mocks.toggleFavoriteModel,
      toggleFavoriteGatewayModel: mocks.toggleFavoriteGatewayModel,
    })
    mocks.useUserKeys.mockReturnValue({
      pending: shallowRef(false),
      error: shallowRef(null),
      hasKey: vi.fn(),
      hasKeyForProvider: (providerOrGatewayId: string) => {
        return keyedProviderIds.value.includes(providerOrGatewayId)
      },
      hasAnyKey: computed(() => keyedProviderIds.value.length > 0),
      refresh: mocks.refreshUserKeys,
    })
    mocks.useGatewayCatalog.mockReturnValue({
      models: shallowRef([gatewayModel]),
      pending: shallowRef(false),
      error: shallowRef(null),
      refresh: mocks.refreshGatewayCatalog,
    })
  })

  it('emits a provider selection when a keyed row is clicked', async () => {
    const wrapper = await mountPanel()

    await wrapper.get('button[aria-label="Choose Image model"]')
      .trigger('click')

    expect(wrapper.emitted('select')).toEqual([[{
      modelId: 'image-model',
      gatewayId: null,
    }]])

    wrapper.unmount()
  })

  it('emits a gateway selection when a gateway model is clicked', async () => {
    const wrapper = await mountPanel({
      selectedModelId: 'anthropic/claude-opus-5',
      selectedGatewayId: 'vercel',
    })

    expect(wrapper.get('[data-testid="models-picker-gateway-banner"]').text())
      .toContain('Vercel AI Gateway')

    await wrapper.get('button[aria-label="Choose Claude Opus 5"]')
      .trigger('click')

    expect(wrapper.emitted('select')).toEqual([[{
      modelId: 'anthropic/claude-opus-5',
      gatewayId: 'vercel',
    }]])

    wrapper.unmount()
  })

  it('never emits a selection for a keyless provider row', async () => {
    const wrapper = await mountPanel()

    await wrapper.get('#model-option-openai-model div').trigger('click')

    expect(wrapper.emitted('select')).toBeUndefined()

    wrapper.unmount()
  })

  it('hides the curated models the caller filter rejects', async () => {
    const wrapper = await mountPanel({
      filterModel: (model) => {
        return !model.modalities.output.includes('image')
      },
    })

    expect(wrapper.find('#model-option-image-model').exists()).toBe(false)
    expect(wrapper.find('#model-option-google-model').exists()).toBe(true)

    wrapper.unmount()
  })

  it('badges only the recommended rows', async () => {
    const wrapper = await mountPanel({
      recommendedModelIds: ['image-model'],
    })
    const badges = wrapper.findAll('[data-testid="model-recommended"]')

    expect(badges).toHaveLength(1)
    expect(
      wrapper.get('#model-option-image-model')
        .find('[data-testid="model-recommended"]')
        .exists(),
    ).toBe(true)

    wrapper.unmount()
  })

  describe('recommendedFilter', () => {
    const recommendedProps = {
      recommendedFilter: true,
      recommendedModelIds: ['google-model'],
    }

    it('keeps the filter dropdown and no toggle by default', async () => {
      const wrapper = await mountPanel()

      expect(wrapper.find('[data-testid="models-picker-filter-trigger"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="memory-picker-filter-all"]').exists())
        .toBe(false)

      wrapper.unmount()
    })

    it('swaps the dropdown for an All and Recommended toggle', async () => {
      const wrapper = await mountPanel(recommendedProps)

      expect(wrapper.find('[data-testid="models-picker-filter-trigger"]').exists())
        .toBe(false)
      expect(wrapper.get('[data-testid="memory-picker-filter-all"]')
        .attributes('aria-pressed')).toBe('true')
      expect(wrapper.get('[data-testid="memory-picker-filter-recommended"]')
        .attributes('aria-pressed')).toBe('false')

      wrapper.unmount()
    })

    it('narrows to the recommended ids and All restores', async () => {
      const wrapper = await mountPanel(recommendedProps)

      await wrapper.get('[data-testid="memory-picker-filter-recommended"]')
        .trigger('click')

      expect(wrapper.find('#model-option-google-model').exists()).toBe(true)
      expect(wrapper.find('#model-option-image-model').exists()).toBe(false)
      expect(wrapper.find('#model-option-openai-model').exists()).toBe(false)
      expect(wrapper.get('[data-testid="memory-picker-filter-recommended"]')
        .attributes('aria-pressed')).toBe('true')

      await wrapper.get('[data-testid="memory-picker-filter-all"]')
        .trigger('click')

      expect(wrapper.find('#model-option-image-model').exists()).toBe(true)
      expect(wrapper.find('#model-option-openai-model').exists()).toBe(true)

      wrapper.unmount()
    })

    it('resets to All when the panel is prepared to open again', async () => {
      const wrapper = await mountPanel(recommendedProps)

      await wrapper.get('[data-testid="memory-picker-filter-recommended"]')
        .trigger('click')
      await (wrapper.vm as unknown as {
        prepareOpen: () => Promise<void>
      }).prepareOpen()

      expect(wrapper.get('[data-testid="memory-picker-filter-all"]')
        .attributes('aria-pressed')).toBe('true')
      expect(wrapper.find('#model-option-image-model').exists()).toBe(true)

      wrapper.unmount()
    })

    describe('in a gateway view', () => {
      const gatewayProps = {
        ...recommendedProps,
        selectedModelId: 'anthropic/claude-haiku-5.5',
        selectedGatewayId: 'openrouter' as GatewayId,
      }
      const gatewayCatalog = [
        { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5' },
        { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5' },
        { id: 'google/gemini-3.1-flash-lite', name: 'Gemini Flash Lite' },
        { id: 'openai/gpt-6-luna-mini', name: 'GPT-6 Luna Mini' },
      ]

      beforeEach(() => {
        keyedProviderIds.value = ['google', 'openrouter']
        mocks.getProviders.mockReturnValue({
          providers: [
            {
              id: 'anthropic',
              name: 'Anthropic',
              models: [{
                ...baseModel,
                id: 'claude-haiku-5-5',
                name: 'Claude Haiku 5.5',
              }],
            },
            {
              id: 'google',
              name: 'Google AI Studio',
              models: [{
                ...baseModel,
                id: 'gemini-3.1-flash-lite',
                name: 'Gemini Flash Lite',
              }],
            },
            {
              id: 'openai',
              name: 'OpenAI',
              models: [{
                ...baseModel,
                id: 'gpt-6-luna',
                name: 'GPT-6 Luna',
              }],
            },
          ],
        })
        mocks.useGatewayCatalog.mockReturnValue({
          models: shallowRef(gatewayCatalog),
          pending: shallowRef(false),
          error: shallowRef(null),
          refresh: mocks.refreshGatewayCatalog,
        })
      })

      function mountGatewayPanel(
        props: Parameters<typeof mountPanel>[0] = {},
      ) {
        return mountPanel({
          ...gatewayProps,
          recommendedModelIds: ['claude-haiku-5-5', 'gemini-3.1-flash-lite'],
          ...props,
        })
      }

      it('shows the toggle in place of the dropdown', async () => {
        const wrapper = await mountGatewayPanel()

        expect(wrapper.find('[data-testid="models-picker-gateway-banner"]')
          .exists()).toBe(true)
        expect(wrapper.get('[data-testid="memory-picker-filter-all"]')
          .attributes('aria-pressed')).toBe('true')
        expect(wrapper.get('[data-testid="memory-picker-filter-recommended"]')
          .attributes('aria-pressed')).toBe('false')
        expect(wrapper.find('[data-testid="models-picker-filter-trigger"]')
          .exists()).toBe(false)
        expect(wrapper.findAll('button[aria-label^="Choose "]'))
          .toHaveLength(4)

        wrapper.unmount()
      })

      it('badges only the gateway models mapped to a recommended model', async () => {
        const wrapper = await mountGatewayPanel()
        const badged = wrapper
          .findAll('[data-testid="gateway-model-recommended"]')

        expect(badged).toHaveLength(2)
        expect(
          wrapper.get('#gateway-model-option-anthropic\\/claude-haiku-5\\.5')
            .find('[data-testid="gateway-model-recommended"]')
            .exists(),
        ).toBe(true)
        expect(
          wrapper.get('#gateway-model-option-openai\\/gpt-6-luna-mini')
            .find('[data-testid="gateway-model-recommended"]')
            .exists(),
        ).toBe(false)

        wrapper.unmount()
      })

      it('narrows the gateway list to recommended models and All restores', async () => {
        const wrapper = await mountGatewayPanel()

        await wrapper.get('[data-testid="memory-picker-filter-recommended"]')
          .trigger('click')

        expect(wrapper.get('[data-testid="memory-picker-filter-recommended"]')
          .attributes('aria-pressed')).toBe('true')
        expect(wrapper.findAll('button[aria-label^="Choose "]')
          .map((button) => {
            return button.attributes('aria-label')
          }).sort()).toEqual([
          'Choose Claude Haiku 5.5',
          'Choose Gemini Flash Lite',
        ])

        await wrapper.get('[data-testid="memory-picker-filter-all"]')
          .trigger('click')

        expect(wrapper.findAll('button[aria-label^="Choose "]'))
          .toHaveLength(4)

        wrapper.unmount()
      })

      it('shrinks the provider groups with the Recommended filter', async () => {
        const wrapper = await mountGatewayPanel()

        expect(wrapper.find(
          '[data-testid="models-picker-gateway-provider-openai"]',
        ).exists()).toBe(true)

        await wrapper.get('[data-testid="memory-picker-filter-recommended"]')
          .trigger('click')

        expect(wrapper.find(
          '[data-testid="models-picker-gateway-provider-anthropic"]',
        ).exists()).toBe(true)
        expect(wrapper.find(
          '[data-testid="models-picker-gateway-provider-google"]',
        ).exists()).toBe(true)
        expect(wrapper.find(
          '[data-testid="models-picker-gateway-provider-openai"]',
        ).exists()).toBe(false)

        wrapper.unmount()
      })

      it('badges nothing and keeps the dropdown without the memory props', async () => {
        const wrapper = await mountPanel({
          selectedModelId: 'anthropic/claude-haiku-5.5',
          selectedGatewayId: 'openrouter',
        })

        expect(wrapper.find('[data-testid="gateway-model-recommended"]')
          .exists()).toBe(false)
        expect(wrapper.find('[data-testid="memory-picker-filter-all"]')
          .exists()).toBe(false)
        expect(wrapper.find('[data-testid="models-picker-filter-trigger"]')
          .exists()).toBe(true)

        wrapper.unmount()
      })

      it('resets the Recommended filter when switching away and back', async () => {
        const wrapper = await mountGatewayPanel()

        await wrapper.get('[data-testid="memory-picker-filter-recommended"]')
          .trigger('click')
        await wrapper.get('[data-testid="models-picker-gateway-exit"]')
          .trigger('click')

        expect(wrapper.get('[data-testid="memory-picker-filter-all"]')
          .attributes('aria-pressed')).toBe('true')

        wrapper.unmount()
      })
    })
  })

  it('emits close with focus restore on Escape', async () => {
    const wrapper = await mountPanel()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(wrapper.emitted('close')).toEqual([[{ restoreFocus: true }]])

    wrapper.unmount()
  })

  it('ignores Escape while closed', async () => {
    const wrapper = await mountPanel({ isOpen: false })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(wrapper.emitted('close')).toBeUndefined()

    wrapper.unmount()
  })

  it('marks the selected provider row as selected', async () => {
    const wrapper = await mountPanel({ selectedModelId: 'image-model' })

    expect(wrapper.get('#model-option-image-model')
      .attributes('aria-selected')).toBe('true')
    expect(wrapper.get('#model-option-google-model')
      .attributes('aria-selected')).toBe('false')

    wrapper.unmount()
  })

  describe('sheet layout', () => {
    it('drops the popover chrome and lets the sheet own the height',
      async () => {
        const wrapper = await mountPanel({ layout: 'sheet' })
        const root = wrapper.get('div')

        expect(root.classes()).toEqual(
          expect.arrayContaining(['flex-1', 'min-h-0']),
        )
        expect(root.classes()).not.toContain('max-h-[60dvh]')
        expect(root.classes()).not.toContain('shadow-xl')
        expect(wrapper.get('[data-testid="models-picker-results"]').classes())
          .toEqual(expect.arrayContaining(['overscroll-contain', 'min-h-0']))

        wrapper.unmount()
      })

    it('keeps the popover chrome by default', async () => {
      const wrapper = await mountPanel()

      expect(wrapper.get('div').classes()).toEqual(
        expect.arrayContaining(['max-h-[60dvh]', 'shadow-xl']),
      )
      expect(wrapper.find('details.dropdown').exists()).toBe(true)
      expect(wrapper.find('[data-testid="models-picker-filter-section"]')
        .exists()).toBe(false)

      wrapper.unmount()
    })

    it('swaps the filter dropdown for an inline section', async () => {
      const wrapper = await mountPanel({ layout: 'sheet' })
      const toggle = wrapper.get(
        '[data-testid="models-picker-filter-trigger"]',
      )

      expect(wrapper.find('details.dropdown').exists()).toBe(false)
      expect(toggle.element.tagName).toBe('BUTTON')

      await toggle.trigger('click')
      await wrapper.get('[data-testid="models-picker-filter-chat"]')
        .trigger('click')

      expect(toggle.attributes('aria-controls')).toBe(
        wrapper.get('[data-testid="models-picker-filter-section"]')
          .attributes('id'),
      )
      expect(toggle.classes()).toContain('text-accent')
      expect(wrapper.find('[data-testid="models-picker-empty"]').exists())
        .toBe(false)

      wrapper.unmount()
    })

    it('keeps the memory picker Recommended toggle in place of filters',
      async () => {
        const wrapper = await mountPanel({
          layout: 'sheet',
          recommendedFilter: true,
          recommendedModelIds: ['google-model'],
        })

        expect(wrapper.find('[data-testid="models-picker-filter-trigger"]')
          .exists()).toBe(false)
        expect(wrapper.find('[data-testid="memory-picker-filter-all"]')
          .exists()).toBe(true)

        wrapper.unmount()
      })

    it('shows the keyboard highlight only while the search has focus',
      async () => {
        const wrapper = await mountPanel({ layout: 'sheet' })
        const search = wrapper.get('[data-testid="models-picker-search"]')

        expect(wrapper.find('#model-option-image-model > div')
          .classes()).not.toContain('bg-base-content/10')

        search.element.dispatchEvent(new FocusEvent('focusin', {
          bubbles: true,
        }))
        await search.setValue('image')

        expect(wrapper.find('#model-option-image-model > div')
          .classes()).toContain('bg-base-content/10')

        search.element.dispatchEvent(new FocusEvent('focusout', {
          bubbles: true,
        }))
        await nextTick()

        expect(wrapper.find('#model-option-image-model > div')
          .classes()).not.toContain('bg-base-content/10')

        wrapper.unmount()
      })

    it('leaves Escape to its host dialog', async () => {
      const wrapper = await mountPanel({ layout: 'sheet' })

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

      expect(wrapper.emitted('close')).toBeUndefined()

      wrapper.unmount()
    })

    it('unwinds the detail, filters and search one Escape at a time',
      async () => {
        const wrapper = await mountPanel({ layout: 'sheet' })
        const panel = wrapper.vm as unknown as { handleEscape: () => boolean }

        await wrapper.get('[data-testid="models-picker-search"]')
          .setValue('google')
        await wrapper.get('[data-testid="models-picker-filter-trigger"]')
          .trigger('click')
        await wrapper.get('[data-testid="model-info-trigger"]')
          .trigger('click')

        expect(wrapper.find('[data-testid="model-detail-panel"]').exists())
          .toBe(true)

        expect(panel.handleEscape()).toBe(true)
        await nextTick()
        expect(wrapper.find('[data-testid="model-detail-panel"]').exists())
          .toBe(false)

        expect(panel.handleEscape()).toBe(true)
        await nextTick()
        expect(wrapper.find('[data-testid="models-picker-filter-section"]')
          .exists()).toBe(false)

        expect(panel.handleEscape()).toBe(true)
        await nextTick()
        expect(wrapper.get<HTMLInputElement>(
          '[data-testid="models-picker-search"]',
        ).element.value).toBe('')

        expect(panel.handleEscape()).toBe(false)

        wrapper.unmount()
      })
  })
})
