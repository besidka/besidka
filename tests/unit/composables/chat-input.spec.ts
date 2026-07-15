import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatInput } from '../../../app/composables/chat-input'

const mocks = vi.hoisted(() => ({
  model: null as Record<string, any> | null,
  userModel: {
    __v_isRef: true,
    value: 'image-model',
  },
}))

mockNuxtImport('useUserModel', () => {
  return () => ({ userModel: mocks.userModel })
})

mockNuxtImport('getModel', () => {
  return () => ({ model: mocks.model })
})

mockNuxtImport('isImageGenerationModel', () => {
  return (model: Record<string, any> | null) => !!model?.imageGeneration
})

mockNuxtImport('getReasoningCapability', () => {
  return () => null
})

mockNuxtImport('getReasoningDropdownLevels', () => {
  return () => []
})

describe('useChatInput image model capability', () => {
  beforeEach(() => {
    mocks.userModel.value = 'image-model'
    mocks.model = null
  })

  it('requires image generation for a purpose-built image model', () => {
    mocks.model = {
      tools: [],
      imageGeneration: {
        controllerModel: 'controller-model',
      },
    }

    const chatInput = useChatInput()

    expect(chatInput.isImageGenerationSupported.value).toBe(true)
    expect(chatInput.isImageGenerationRequired.value).toBe(true)
    expect(chatInput.isWebSearchSupported.value).toBe(false)
  })

  it('keeps optional image generation optional on a regular model', () => {
    mocks.model = {
      tools: ['web_search', 'image_generation'],
    }

    const chatInput = useChatInput()

    expect(chatInput.isImageGenerationSupported.value).toBe(true)
    expect(chatInput.isImageGenerationRequired.value).toBe(false)
    expect(chatInput.isWebSearchSupported.value).toBe(true)
  })

  it('reports nothing supported when the model cannot be resolved', () => {
    mocks.model = null

    const chatInput = useChatInput()

    expect(chatInput.isImageGenerationSupported.value).toBe(false)
    expect(chatInput.isImageGenerationRequired.value).toBe(false)
    expect(chatInput.isWebSearchSupported.value).toBe(false)
  })
})
