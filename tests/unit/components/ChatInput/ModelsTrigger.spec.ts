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
  useElementHover: vi.fn(),
  useUserModel: vi.fn(),
}))

mockNuxtImport('getModel', () => mocks.getModel)
mockNuxtImport('getModelName', () => mocks.getModelName)
mockNuxtImport('getProviders', () => mocks.getProviders)
mockNuxtImport('onClickOutside', () => mocks.onClickOutside)
mockNuxtImport('useDevice', () => mocks.useDevice)
mockNuxtImport('useElementHover', () => mocks.useElementHover)
mockNuxtImport('useUserModel', () => mocks.useUserModel)

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
        models: [{
          id: 'image-model',
          name: 'Image model',
          tools: ['image_generation'],
          reasoning: false,
        }],
      }],
    })
    mocks.useDevice.mockReturnValue({
      isIos: false,
      isAndroid: false,
    })
    mocks.useElementHover.mockReturnValue(shallowRef<boolean>(false))
    mocks.useUserModel.mockReturnValue({
      userModel: shallowRef<string>('image-model'),
    })
  })

  it('keeps image capability in the list but not the selected model trigger', async () => {
    const wrapper = await mountSuspended(ModelsTrigger, {
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

    const selectedModel = wrapper.get(
      '[data-testid="current-model-trigger"]',
    )

    expect(selectedModel.text()).toContain('Image model')
    expect(selectedModel.find(
      '[data-testid="model-image-generation-capability"]',
    ).exists()).toBe(false)
    expect(wrapper.findAll(
      '[data-testid="model-image-generation-capability"]',
    )).toHaveLength(1)
  })

  it('does not show tool icons for a purpose-built image model', async () => {
    mocks.getProviders.mockReturnValue({
      providers: [{
        id: 'google',
        name: 'Google AI Studio',
        models: [{
          id: 'image-model',
          name: 'Image model',
          tools: [],
          reasoning: false,
          imageGeneration: {
            controllerModel: 'controller-model',
          },
          price: {
            display: '$0.039 / image',
          },
        }],
      }],
    })

    const wrapper = await mountSuspended(ModelsTrigger, {
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
    const modelButton = wrapper.get('button[aria-label="Choose Image model"]')

    expect(wrapper.find(
      '[data-testid="model-image-generation-capability"]',
    ).exists()).toBe(false)
    expect(modelButton.attributes('data-tip')).toBe('$0.039 / image')
  })
})
