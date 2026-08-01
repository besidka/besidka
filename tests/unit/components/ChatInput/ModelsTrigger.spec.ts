import { shallowRef } from 'vue'
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
  toggleFavoriteModel: vi.fn(),
}))

mockNuxtImport('getModel', () => mocks.getModel)
mockNuxtImport('getModelName', () => mocks.getModelName)
mockNuxtImport('getProviders', () => mocks.getProviders)
mockNuxtImport('onClickOutside', () => mocks.onClickOutside)
mockNuxtImport('useDevice', () => mocks.useDevice)
mockNuxtImport('useUserModel', () => mocks.useUserModel)
mockNuxtImport('useUserSetting', () => mocks.useUserSetting)

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
    mocks.useUserModel.mockReturnValue({
      userModel: shallowRef<string>('image-model'),
    })
    mocks.useUserSetting.mockReturnValue({
      favoriteModels: shallowRef<string[]>([]),
      toggleFavoriteModel: mocks.toggleFavoriteModel,
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
      modelButton.get('[data-testid="model-price-tier"]').attributes('title'),
    ).toBe('$0.039 / image')
  })

  it('selects a model and closes the picker', async () => {
    const userModel = shallowRef<string>('other-model')

    mocks.useUserModel.mockReturnValue({ userModel })

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

  it('toggles a favorite through the user settings composable', async () => {
    const wrapper = await mountPicker()

    await wrapper.get('[data-testid="current-model-trigger"]').trigger('click')
    await wrapper.get('[data-testid="model-favorite-toggle"]').trigger('click')

    expect(mocks.toggleFavoriteModel).toHaveBeenCalledWith('image-model')
  })
})
