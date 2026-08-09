import type { ModelSelection } from '#shared/types/model-selection.d'
import { computed, shallowRef } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModelsTrigger from '../../../../app/components/ChatInput/ModelsTrigger.vue'

const mocks = vi.hoisted(() => ({
  getModel: vi.fn(),
  getModelName: vi.fn(),
  getProviders: vi.fn(),
  onClickOutside: vi.fn(),
  useDevice: vi.fn(),
  useUserModel: vi.fn(),
  useUserSetting: vi.fn(),
  useGatewayCatalog: vi.fn(),
  toggleFavoriteModel: vi.fn(),
  toggleFavoriteGatewayModel: vi.fn(),
  getFavoriteGatewayModels: vi.fn(),
  refreshGatewayCatalog: vi.fn(),
}))

mockNuxtImport('getModel', () => mocks.getModel)
mockNuxtImport('getModelName', () => mocks.getModelName)
mockNuxtImport('getProviders', () => mocks.getProviders)
mockNuxtImport('onClickOutside', () => mocks.onClickOutside)
mockNuxtImport('useDevice', () => mocks.useDevice)
mockNuxtImport('useUserModel', () => mocks.useUserModel)
mockNuxtImport('useUserSetting', () => mocks.useUserSetting)
mockNuxtImport('useGatewayCatalog', () => mocks.useGatewayCatalog)

/**
 * Mirrors the real composable's writable-computed bridge so assertions can
 * keep reading `userModel` as a plain string while the component writes
 * through the richer `selection`.
 */
function createSelectionMock(modelId: string) {
  const selection = shallowRef<ModelSelection>({
    source: 'provider',
    modelId,
  })
  const userModel = computed<string>({
    get() {
      return selection.value.modelId
    },
    set(value) {
      selection.value = { source: 'provider', modelId: value }
    },
  })

  return { selection, userModel }
}

const imageModel = {
  id: 'image-model',
  name: 'Image model',
  description: 'Creates images',
  contextLength: 32_768,
  maxOutputTokens: 32_768,
  priceTier: '$$',
  price: {
    tokens: 1,
    input: '$0.30',
    output: '$30.00',
    display: '$0.039 / image',
  },
  modalities: {
    input: ['text'],
    output: ['image'],
  },
  tools: ['image_generation'],
  reasoning: false,
}

const legacyModel = {
  ...imageModel,
  id: 'legacy-model',
  name: 'Legacy model',
  description: 'Retired upstream',
  tools: [],
  status: 'deprecated',
}

const secondModel = {
  ...imageModel,
  id: 'second-model',
  name: 'Second model',
  description: 'Also selectable',
}

function useLegacyCatalog() {
  mocks.getProviders.mockReturnValue({
    providers: [{
      id: 'google',
      name: 'Google AI Studio',
      models: [imageModel, secondModel, legacyModel],
    }],
  })
}

function mountPicker() {
  return mountSuspended(ModelsTrigger, {
    props: {
      isWebSearchEnabled: false,
      isImageGenerationEnabled: true,
      isReasoningEnabled: false,
    },
    global: {
      stubs: {
        ClientOnly: {
          template: '<slot />',
        },
      },
    },
  })
}

describe('ChatInput/ModelsTrigger', () => {
  beforeEach(() => {
    mocks.getModel.mockReturnValue({
      provider: { id: 'google' },
    })
    mocks.getModelName.mockReturnValue('Image model')
    mocks.getProviders.mockReturnValue({
      providers: [{
        id: 'google',
        name: 'Google AI Studio',
        models: [imageModel],
      }],
    })
    mocks.useDevice.mockReturnValue({
      isIos: false,
      isAndroid: false,
      isDesktop: true,
    })
    mocks.useUserModel.mockReturnValue(createSelectionMock('image-model'))
    mocks.getFavoriteGatewayModels.mockReturnValue([])
    mocks.useUserSetting.mockReturnValue({
      favoriteModels: shallowRef<string[]>([]),
      favoriteGatewayModels: shallowRef({}),
      getFavoriteGatewayModels: mocks.getFavoriteGatewayModels,
      toggleFavoriteModel: mocks.toggleFavoriteModel,
      toggleFavoriteGatewayModel: mocks.toggleFavoriteGatewayModel,
    })
    mocks.useGatewayCatalog.mockReturnValue({
      models: shallowRef([]),
      pending: shallowRef(false),
      error: shallowRef(null),
      refresh: mocks.refreshGatewayCatalog,
    })
  })

  it('keeps image capability in the list but not the selected model trigger', async () => {
    const wrapper = await mountPicker()
    const selectedModel = wrapper.get(
      '[data-testid="current-model-trigger"]',
    )

    expect(selectedModel.text()).toContain('Image model')
    expect(selectedModel.find(
      '[data-testid="model-image-generation-capability"]',
    ).exists()).toBe(false)
    expect(wrapper.find('[data-testid="models-picker-panel"]').exists())
      .toBe(false)

    await selectedModel.trigger('click')

    expect(wrapper.find('[data-testid="models-picker-panel"]').exists())
      .toBe(true)
    expect(wrapper.findAll(
      '[data-testid="model-image-generation-capability"]',
    )).toHaveLength(1)
  })

  it('shows only the image generation icon for a purpose-built image model', async () => {
    mocks.getProviders.mockReturnValue({
      providers: [{
        id: 'google',
        name: 'Google AI Studio',
        models: [{
          ...imageModel,
          tools: [],
          imageGeneration: {
            controllerModel: 'controller-model',
          },
        }],
      }],
    })

    const wrapper = await mountPicker()

    await wrapper.get('[data-testid="current-model-trigger"]').trigger('click')

    const modelButton = wrapper.get('button[aria-label="Choose Image model"]')

    expect(modelButton.find(
      '[data-testid="model-image-generation-capability"]',
    ).exists()).toBe(true)
    expect(modelButton.find('[data-tip="Reasoning"]').exists()).toBe(false)
    expect(modelButton.find('[data-tip="Web search"]').exists()).toBe(false)
    expect(
      modelButton
        .get('[data-testid="model-price-tier"]')
        .attributes('data-tip'),
    ).toBe('$0.039 / image')
  })

  it('selects a model and closes the picker', async () => {
    const selectionMock = createSelectionMock('other-model')
    const { userModel } = selectionMock

    mocks.useUserModel.mockReturnValue(selectionMock)

    const wrapper = await mountPicker()

    await wrapper.get('[data-testid="current-model-trigger"]').trigger('click')
    await wrapper.get('button[aria-label="Choose Image model"]')
      .trigger('click')

    expect(userModel.value).toBe('image-model')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="models-picker-panel"]').exists())
        .toBe(false)
    })
  })

  it('filters the list by search query and hides the provider rail', async () => {
    const wrapper = await mountPicker()

    await wrapper.get('[data-testid="current-model-trigger"]').trigger('click')

    expect(wrapper.find('[data-testid="models-picker-rail"]').exists())
      .toBe(true)

    await wrapper.get('[data-testid="models-picker-search"]')
      .setValue('nothing here')

    expect(wrapper.find('[data-testid="models-picker-rail"]').exists())
      .toBe(false)
    expect(wrapper.get('[data-testid="models-picker-empty"]').text())
      .toContain('No models match')
    expect(wrapper.find('[data-testid="models-picker-clear-filters"]').exists())
      .toBe(false)
  })

  it('keeps deprecated models out of the selectable list', async () => {
    useLegacyCatalog()

    const wrapper = await mountPicker()

    await wrapper.get('[data-testid="current-model-trigger"]').trigger('click')

    expect(wrapper.find('button[aria-label="Choose Legacy model"]').exists())
      .toBe(false)
    expect(wrapper.find('button[aria-label="Choose Image model"]').exists())
      .toBe(true)
  })

  it('collapses the legacy section by default and counts its models', async () => {
    useLegacyCatalog()

    const wrapper = await mountPicker()

    await wrapper.get('[data-testid="current-model-trigger"]').trigger('click')

    const toggle = wrapper.get('[data-testid="models-picker-legacy-toggle"]')

    expect(toggle.text()).toContain('1 legacy model')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('[data-testid="models-picker-legacy-list"]')
      .attributes('style')).toBe('display: none;')
  })

  it('reveals the non-selectable legacy rows once expanded', async () => {
    useLegacyCatalog()

    const wrapper = await mountPicker()

    await wrapper.get('[data-testid="current-model-trigger"]').trigger('click')
    await wrapper.get('[data-testid="models-picker-legacy-toggle"]')
      .trigger('click')

    const toggle = wrapper.get('[data-testid="models-picker-legacy-toggle"]')
    const row = wrapper.get('#model-option-legacy-model')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('[data-testid="models-picker-legacy-list"]')
      .attributes('style')).toBeUndefined()
    expect(row.attributes('aria-disabled')).toBe('true')
    expect(row.find('button[aria-label="Choose Legacy model"]').exists())
      .toBe(false)
    expect(row.find('[data-testid="model-favorite-toggle"]').exists())
      .toBe(false)

    await toggle.trigger('click')

    expect(wrapper.get('[data-testid="models-picker-legacy-toggle"]')
      .attributes('aria-expanded')).toBe('false')
  })

  it('opens the detail panel from a legacy row info button', async () => {
    useLegacyCatalog()

    const wrapper = await mountPicker()

    await wrapper.get('[data-testid="current-model-trigger"]').trigger('click')
    await wrapper.get('[data-testid="models-picker-legacy-toggle"]')
      .trigger('click')
    await wrapper.get('#model-option-legacy-model')
      .get('[data-testid="model-info-trigger"]')
      .trigger('click')

    const panel = wrapper.get('[data-testid="model-detail-panel"]')

    expect(panel.attributes('id')).toBe('model-detail-legacy-model')
    expect(wrapper.get('[data-testid="model-detail-deprecated-notice"]').text())
      .toContain('no longer be selected')
  })

  it('never aims the keyboard highlight at a deprecated selection', async () => {
    useLegacyCatalog()
    mocks.useUserModel.mockReturnValue(createSelectionMock('legacy-model'))

    const wrapper = await mountPicker()

    await wrapper.get('[data-testid="current-model-trigger"]').trigger('click')

    const search = wrapper.get('[data-testid="models-picker-search"]')
    const listbox = wrapper.get('[role="listbox"][aria-label="Models"]')

    expect(search.attributes('aria-activedescendant'))
      .toBe('model-option-image-model')
    expect(listbox.find('#model-option-image-model').exists()).toBe(true)
    expect(listbox.find('#model-option-legacy-model').exists()).toBe(false)

    await search.trigger('keydown', { key: 'ArrowDown' })

    expect(search.attributes('aria-activedescendant'))
      .toBe('model-option-second-model')

    await search.trigger('keydown', { key: 'ArrowDown' })

    expect(search.attributes('aria-activedescendant'))
      .toBe('model-option-image-model')

    await search.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted()).toBeTruthy()
  })

  it('hides the legacy section when no model is deprecated', async () => {
    const wrapper = await mountPicker()

    await wrapper.get('[data-testid="current-model-trigger"]').trigger('click')

    expect(wrapper.find('[data-testid="models-picker-legacy"]').exists())
      .toBe(false)
  })

  it('keeps the listbox free of the legacy section', async () => {
    useLegacyCatalog()

    const wrapper = await mountPicker()

    await wrapper.get('[data-testid="current-model-trigger"]').trigger('click')

    const listbox = wrapper.get('[role="listbox"][aria-label="Models"]')

    expect(listbox.find('[data-testid="models-picker-legacy"]').exists())
      .toBe(false)
  })

  it('toggles a favorite through the user settings composable', async () => {
    const wrapper = await mountPicker()

    await wrapper.get('[data-testid="current-model-trigger"]').trigger('click')
    await wrapper.get('[data-testid="model-favorite-toggle"]').trigger('click')

    expect(mocks.toggleFavoriteModel).toHaveBeenCalledWith('image-model')
  })

  describe('gateway mode', () => {
    const gatewayModel = {
      id: 'anthropic/claude-opus-5',
      name: 'Claude Opus 5',
      contextLength: 200_000,
      pricing: { input: '0.0000025', output: '0.00001' },
      supportsTools: true,
    }

    function useGatewayModels() {
      mocks.useGatewayCatalog.mockReturnValue({
        models: shallowRef([gatewayModel]),
        pending: shallowRef(false),
        error: shallowRef(null),
        refresh: mocks.refreshGatewayCatalog,
      })
    }

    async function openGateway() {
      useGatewayModels()

      const wrapper = await mountPicker()

      await wrapper.get('[data-testid="current-model-trigger"]')
        .trigger('click')
      await wrapper.get('[data-testid="models-picker-gateway-vercel"]')
        .trigger('click')

      return wrapper
    }

    it('renders a rail button per enabled gateway', async () => {
      const wrapper = await mountPicker()

      await wrapper.get('[data-testid="current-model-trigger"]')
        .trigger('click')

      expect(wrapper.find('[data-testid="models-picker-gateway-vercel"]')
        .exists()).toBe(true)
      expect(wrapper.find('[data-testid="models-picker-gateway-openrouter"]')
        .exists()).toBe(true)
      expect(wrapper.find('[data-testid="models-picker-gateway-cloudflare"]')
        .exists()).toBe(true)
    })

    it('replaces provider browsing with an unmistakable gateway mode', async () => {
      const wrapper = await openGateway()

      expect(wrapper.get('[data-testid="models-picker-gateway-banner"]').text())
        .toContain('Vercel AI Gateway')
      expect(wrapper.find('[data-testid="models-picker-rail"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="models-picker-filter-free"]')
        .exists()).toBe(true)
      expect(wrapper.find('[data-testid="models-picker-filter-chat"]')
        .exists()).toBe(false)
      expect(wrapper.find('button[aria-label="Choose Image model"]').exists())
        .toBe(false)
      expect(wrapper.get('button[aria-label="Choose Claude Opus 5"]').exists())
        .toBe(true)
    })

    it('returns to provider mode from the banner exit', async () => {
      const wrapper = await openGateway()

      await wrapper.get('[data-testid="models-picker-gateway-exit"]')
        .trigger('click')

      expect(wrapper.find('[data-testid="models-picker-gateway-banner"]')
        .exists()).toBe(false)
      expect(wrapper.get('button[aria-label="Choose Image model"]').exists())
        .toBe(true)
    })

    it('writes a gateway selection instead of a bare model id', async () => {
      const selectionMock = createSelectionMock('image-model')

      mocks.useUserModel.mockReturnValue(selectionMock)

      const wrapper = await openGateway()

      await wrapper.get('button[aria-label="Choose Claude Opus 5"]')
        .trigger('click')

      expect(selectionMock.selection.value).toEqual({
        source: 'gateway',
        gatewayId: 'vercel',
        modelId: 'anthropic/claude-opus-5',
      })
    })

    it('routes favorites to the active gateway, not the curated list', async () => {
      const wrapper = await openGateway()

      await wrapper.get('[data-testid="gateway-model-favorite-toggle"]')
        .trigger('click')

      expect(mocks.toggleFavoriteGatewayModel).toHaveBeenCalledWith(
        'vercel',
        'anthropic/claude-opus-5',
      )
      expect(mocks.toggleFavoriteModel).not.toHaveBeenCalled()
    })

    it('offers a retry when the catalog fetch fails', async () => {
      mocks.useGatewayCatalog.mockReturnValue({
        models: shallowRef([]),
        pending: shallowRef(false),
        error: shallowRef(new Error('upstream down')),
        refresh: mocks.refreshGatewayCatalog,
      })

      const wrapper = await mountPicker()

      await wrapper.get('[data-testid="current-model-trigger"]')
        .trigger('click')
      await wrapper.get('[data-testid="models-picker-gateway-vercel"]')
        .trigger('click')
      await wrapper.get('[data-testid="gateway-models-retry"]').trigger('click')

      expect(mocks.refreshGatewayCatalog).toHaveBeenCalled()
    })

    it('keeps arrow-key navigation working over the gateway catalog', async () => {
      const wrapper = await openGateway()
      const search = wrapper.get('[data-testid="models-picker-search"]')

      await search.trigger('keydown', { key: 'ArrowDown' })

      expect(search.attributes('aria-activedescendant'))
        .toBe('gateway-model-option-anthropic/claude-opus-5')
    })

    it('reopens in the mode matching the current selection', async () => {
      useGatewayModels()
      mocks.useUserModel.mockReturnValue({
        selection: shallowRef<ModelSelection>({
          source: 'gateway',
          gatewayId: 'vercel',
          modelId: 'anthropic/claude-opus-5',
        }),
        userModel: shallowRef('anthropic/claude-opus-5'),
      })

      const wrapper = await mountPicker()

      await wrapper.get('[data-testid="current-model-trigger"]')
        .trigger('click')

      expect(wrapper.get('[data-testid="models-picker-gateway-banner"]').text())
        .toContain('Vercel AI Gateway')
    })

    it('rounds the banner and the gateway rail into the panel corners', async () => {
      const wrapper = await openGateway()

      expect(wrapper.get('[data-testid="models-picker-gateway-banner"]')
        .classes()).toContain('rounded-t-2xl')
      expect(wrapper.get('[data-testid="models-picker-gateway-rail"]')
        .classes()).toContain('rounded-b-2xl')
    })

    describe('provider strip', () => {
      const catalog = [
        {
          id: 'anthropic/claude-opus-5',
          name: 'Claude Opus 5',
          pricing: { input: '0.0000025', output: '0.00001' },
        },
        {
          id: 'openai/gpt-5.4',
          name: 'GPT-5.4',
          pricing: { input: '0.0000012', output: '0.00001' },
        },
        {
          id: 'openai/gpt-5.4-mini',
          name: 'GPT-5.4 mini',
          pricing: { input: '0', output: '0' },
        },
      ]

      async function openMultiProviderGateway(
        models: typeof catalog = catalog,
      ) {
        mocks.useGatewayCatalog.mockReturnValue({
          models: shallowRef(models),
          pending: shallowRef(false),
          error: shallowRef(null),
          refresh: mocks.refreshGatewayCatalog,
        })

        const wrapper = await mountPicker()

        await wrapper.get('[data-testid="current-model-trigger"]')
          .trigger('click')
        await wrapper.get('[data-testid="models-picker-gateway-vercel"]')
          .trigger('click')

        return wrapper
      }

      function getRenderedModelNames(
        wrapper: Awaited<ReturnType<typeof mountPicker>>,
      ) {
        return wrapper
          .findAll('li[id^="gateway-model-option-"]')
          .map((option) => {
            return option.get('.truncate').text()
          })
      }

      it('offers a chip per underlying provider, most stocked first', async () => {
        const wrapper = await openMultiProviderGateway()
        const chips = wrapper
          .findAll('[data-testid="models-picker-gateway-provider-strip"] button')
          .map((chip) => {
            return chip.attributes('data-testid')
          })

        expect(chips).toEqual([
          'models-picker-gateway-provider-openai',
          'models-picker-gateway-provider-anthropic',
        ])
      })

      it('clusters the list by provider in the same order', async () => {
        const wrapper = await openMultiProviderGateway()

        expect(getRenderedModelNames(wrapper))
          .toEqual(['GPT-5.4', 'GPT-5.4 mini', 'Claude Opus 5'])
      })

      it('narrows the list to the picked provider and back', async () => {
        const wrapper = await openMultiProviderGateway()
        const chip = wrapper
          .get('[data-testid="models-picker-gateway-provider-anthropic"]')

        await chip.trigger('click')

        expect(getRenderedModelNames(wrapper)).toEqual(['Claude Opus 5'])

        await chip.trigger('click')

        expect(getRenderedModelNames(wrapper)).toHaveLength(3)
      })

      it('hides the strip for a single-provider catalog', async () => {
        const wrapper = await openMultiProviderGateway([catalog[0]!])

        expect(wrapper.find(
          '[data-testid="models-picker-gateway-provider-strip"]',
        ).exists()).toBe(false)
      })

      it('hides the strip while a search is narrowing the list', async () => {
        const wrapper = await openMultiProviderGateway()

        await wrapper.get('[data-testid="models-picker-search"]')
          .setValue('gpt')

        expect(wrapper.find(
          '[data-testid="models-picker-gateway-provider-strip"]',
        ).exists()).toBe(false)
      })

      it('keeps only free models under the free filter', async () => {
        const wrapper = await openMultiProviderGateway()

        await wrapper.get('[data-testid="models-picker-filter-free"]')
          .trigger('click')

        expect(getRenderedModelNames(wrapper)).toEqual(['GPT-5.4 mini'])
        expect(wrapper.get('[data-testid="gateway-model-free"]').text())
          .toContain('Free')
      })

      it('drops a provider chip the free filter emptied out', async () => {
        const wrapper = await openMultiProviderGateway()

        await wrapper.get('[data-testid="models-picker-filter-free"]')
          .trigger('click')

        expect(wrapper.find(
          '[data-testid="models-picker-gateway-provider-strip"]',
        ).exists()).toBe(false)
      })

      it('releases a provider filter the free filter left unreachable', async () => {
        const wrapper = await openMultiProviderGateway()

        await wrapper
          .get('[data-testid="models-picker-gateway-provider-anthropic"]')
          .trigger('click')
        await wrapper.get('[data-testid="models-picker-filter-free"]')
          .trigger('click')

        expect(getRenderedModelNames(wrapper)).toEqual(['GPT-5.4 mini'])
      })

      it('clears every gateway filter from the empty state', async () => {
        const wrapper = await openMultiProviderGateway([catalog[0]!])

        await wrapper.get('[data-testid="models-picker-filter-free"]')
          .trigger('click')
        await wrapper.get('[data-testid="gateway-models-clear-filters"]')
          .trigger('click')

        expect(getRenderedModelNames(wrapper)).toEqual(['Claude Opus 5'])
      })
    })
  })
})
