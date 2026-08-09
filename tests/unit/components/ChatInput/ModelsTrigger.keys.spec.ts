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
  useUserKeys: vi.fn(),
  useGatewayCatalog: vi.fn(),
  toggleFavoriteModel: vi.fn(),
  toggleFavoriteGatewayModel: vi.fn(),
  getFavoriteGatewayModels: vi.fn(),
  refreshGatewayCatalog: vi.fn(),
  refreshUserKeys: vi.fn(),
}))

mockNuxtImport('getModel', () => mocks.getModel)
mockNuxtImport('getModelName', () => mocks.getModelName)
mockNuxtImport('getProviders', () => mocks.getProviders)
mockNuxtImport('onClickOutside', () => mocks.onClickOutside)
mockNuxtImport('useDevice', () => mocks.useDevice)
mockNuxtImport('useUserModel', () => mocks.useUserModel)
mockNuxtImport('useUserSetting', () => mocks.useUserSetting)
mockNuxtImport('useUserKeys', () => mocks.useUserKeys)
mockNuxtImport('useGatewayCatalog', () => mocks.useGatewayCatalog)

const keyedProviderIds = shallowRef<string[]>([])

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

const baseModel = {
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
  reasoning: false,
}

const openAiModel = {
  ...baseModel,
  id: 'openai-model',
  name: 'OpenAI model',
  description: 'Needs an OpenAI key',
}

const googleModel = {
  ...baseModel,
  id: 'google-model',
  name: 'Google model',
  description: 'Needs a Google key',
}

function mountPicker() {
  return mountSuspended(ModelsTrigger, {
    props: {
      isWebSearchEnabled: false,
      isImageGenerationEnabled: false,
      isReasoningEnabled: false,
    },
    global: {
      stubs: {
        ClientOnly: {
          template: '<slot />',
        },
        NuxtLink: {
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  })
}

async function openPicker() {
  const wrapper = await mountPicker()

  await wrapper.get('[data-testid="current-model-trigger"]').trigger('click')

  return wrapper
}

describe('ChatInput/ModelsTrigger no-key gating', () => {
  beforeEach(() => {
    keyedProviderIds.value = ['google']

    mocks.getModel.mockReturnValue({ provider: { id: 'google' } })
    mocks.getModelName.mockReturnValue('Google model')
    mocks.getProviders.mockReturnValue({
      providers: [
        { id: 'openai', name: 'OpenAI', models: [openAiModel] },
        { id: 'google', name: 'Google AI Studio', models: [googleModel] },
      ],
    })
    mocks.useDevice.mockReturnValue({
      isIos: false,
      isAndroid: false,
      isDesktop: true,
    })
    mocks.useUserModel.mockReturnValue(createSelectionMock('google-model'))
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
    mocks.useGatewayCatalog.mockReset()
    mocks.useGatewayCatalog.mockReturnValue({
      models: shallowRef([]),
      pending: shallowRef(false),
      error: shallowRef(null),
      refresh: mocks.refreshGatewayCatalog,
    })
  })

  describe('provider rows', () => {
    it('marks a model non-selectable when its provider has no key', async () => {
      const wrapper = await openPicker()
      const row = wrapper.get('#model-option-openai-model')

      expect(row.attributes('aria-disabled')).toBe('true')
      expect(row.find('[data-testid="model-key-required"]').exists()).toBe(true)
      expect(wrapper.find('button[aria-label="Choose OpenAI model"]').exists())
        .toBe(false)
    })

    it('leaves a model selectable when its provider has a key', async () => {
      const wrapper = await openPicker()
      const row = wrapper.get('#model-option-google-model')

      expect(row.attributes('aria-disabled')).toBeUndefined()
      expect(row.find('[data-testid="model-key-required"]').exists())
        .toBe(false)
      expect(wrapper.find('button[aria-label="Choose Google model"]').exists())
        .toBe(true)
    })

    it('ignores a click on a keyless row instead of selecting it', async () => {
      const selectionMock = createSelectionMock('google-model')

      mocks.useUserModel.mockReturnValue(selectionMock)

      const wrapper = await openPicker()

      await wrapper.get('#model-option-openai-model div').trigger('click')

      expect(selectionMock.selection.value).toEqual({
        source: 'provider',
        modelId: 'google-model',
      })
      expect(wrapper.find('[data-testid="models-picker-panel"]').exists())
        .toBe(true)
    })

    it('explains the missing key and links to the keys page in the detail card', async () => {
      const wrapper = await openPicker()

      await wrapper
        .get('#model-option-openai-model [data-testid="model-info-trigger"]')
        .trigger('click')

      const notice = wrapper.get('[data-testid="model-detail-key-notice"]')

      expect(notice.text()).toContain('OpenAI')
      expect(
        notice.get('[data-testid="model-detail-key-link"]').attributes('href'),
      ).toBe('/profile/keys')
    })

    it('enables the rows live once the key lands, without a remount', async () => {
      keyedProviderIds.value = []

      const wrapper = await openPicker()

      expect(wrapper.get('#model-option-openai-model')
        .attributes('aria-disabled')).toBe('true')

      keyedProviderIds.value = ['openai']
      await wrapper.vm.$nextTick()

      expect(wrapper.get('#model-option-openai-model')
        .attributes('aria-disabled')).toBeUndefined()
      expect(wrapper.find('button[aria-label="Choose OpenAI model"]').exists())
        .toBe(true)
    })
  })

  describe('keyboard navigation', () => {
    it('opens with the highlight past the keyless rows', async () => {
      const wrapper = await openPicker()

      expect(
        wrapper.get('[data-testid="models-picker-search"]')
          .attributes('aria-activedescendant'),
      ).toBe('model-option-google-model')
    })

    it('never lands the highlight on a keyless row while arrowing', async () => {
      const wrapper = await openPicker()
      const search = wrapper.get('[data-testid="models-picker-search"]')

      await search.trigger('keydown', { key: 'ArrowDown' })
      expect(search.attributes('aria-activedescendant'))
        .toBe('model-option-google-model')

      await search.trigger('keydown', { key: 'ArrowUp' })
      expect(search.attributes('aria-activedescendant'))
        .toBe('model-option-google-model')

      await search.trigger('keydown', { key: 'Home' })
      expect(search.attributes('aria-activedescendant'))
        .toBe('model-option-google-model')
    })

    it('chooses the first model that has a key when Enter is pressed', async () => {
      const selectionMock = createSelectionMock('other-model')

      mocks.useUserModel.mockReturnValue(selectionMock)

      const wrapper = await openPicker()

      await wrapper.get('[data-testid="models-picker-search"]')
        .trigger('keydown', { key: 'Enter' })

      expect(selectionMock.selection.value).toEqual({
        source: 'provider',
        modelId: 'google-model',
      })
    })
  })

  describe('provider rail', () => {
    it('flags the keyless providers only', async () => {
      const wrapper = await openPicker()

      expect(
        wrapper.find('[data-testid="models-picker-rail-openai-keyless"]')
          .exists(),
      ).toBe(true)
      expect(
        wrapper.find('[data-testid="models-picker-rail-google-keyless"]')
          .exists(),
      ).toBe(false)
      expect(
        wrapper.get('[data-testid="models-picker-rail-openai"]')
          .attributes('aria-label'),
      ).toContain('API key required')
    })
  })

  describe('zero-key account', () => {
    it('calls out that nothing works yet and links to the keys page', async () => {
      keyedProviderIds.value = []

      const wrapper = await openPicker()
      const banner = wrapper.get('[data-testid="models-picker-key-banner"]')

      expect(banner.text()).toContain('No API keys yet')
      expect(
        banner.get('[data-testid="models-picker-key-banner-link"]')
          .attributes('href'),
      ).toBe('/profile/keys')
    })

    it('stays hidden as soon as any key exists', async () => {
      const wrapper = await openPicker()

      expect(wrapper.find('[data-testid="models-picker-key-banner"]').exists())
        .toBe(false)
    })
  })

  describe('gateway mode', () => {
    it('prompts for the gateway key instead of fetching a catalog to disable', async () => {
      const wrapper = await openPicker()

      await wrapper.get('[data-testid="models-picker-gateway-vercel"]')
        .trigger('click')

      const prompt = wrapper.get('[data-testid="models-picker-key-prompt"]')

      expect(prompt.text()).toContain('Vercel AI Gateway needs an API key')
      expect(
        prompt.get('[data-testid="models-picker-key-prompt-link"]')
          .attributes('href'),
      ).toBe('/profile/keys')
      expect(mocks.useGatewayCatalog).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="gateway-models-loading"]').exists())
        .toBe(false)
    })

    it('loads the catalog once the gateway key exists', async () => {
      keyedProviderIds.value = ['google', 'vercel']

      const wrapper = await openPicker()

      await wrapper.get('[data-testid="models-picker-gateway-vercel"]')
        .trigger('click')

      expect(wrapper.find('[data-testid="models-picker-key-prompt"]').exists())
        .toBe(false)
      expect(mocks.useGatewayCatalog).toHaveBeenCalled()
    })

    it('flags the keyless gateways on the rail', async () => {
      keyedProviderIds.value = ['vercel']

      const wrapper = await openPicker()

      expect(
        wrapper
          .find('[data-testid="models-picker-gateway-vercel-keyless"]')
          .exists(),
      ).toBe(false)
      expect(
        wrapper
          .find('[data-testid="models-picker-gateway-openrouter-keyless"]')
          .exists(),
      ).toBe(true)
      expect(
        wrapper.get('[data-testid="models-picker-gateway-openrouter"]')
          .attributes('aria-label'),
      ).toContain('API key required')
    })
  })

  describe('fail-open contract', () => {
    it('gates nothing while key presence is still unknown', async () => {
      mocks.useUserKeys.mockReturnValue({
        pending: shallowRef(true),
        error: shallowRef(null),
        hasKey: vi.fn(),
        hasKeyForProvider: () => true,
        hasAnyKey: computed(() => true),
        refresh: mocks.refreshUserKeys,
      })

      const wrapper = await openPicker()

      expect(wrapper.findAll('[data-testid="model-key-required"]'))
        .toHaveLength(0)
      expect(wrapper.find('[data-testid="models-picker-key-banner"]').exists())
        .toBe(false)
      expect(wrapper.find('button[aria-label="Choose OpenAI model"]').exists())
        .toBe(true)
    })
  })
})
