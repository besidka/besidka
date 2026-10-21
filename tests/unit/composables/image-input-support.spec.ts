import type { ModelSelection } from '#shared/types/model-selection.d'
import { shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useImageInputSupport } from '../../../app/composables/image-input-support'

const mocks = vi.hoisted(() => ({
  useUserModel: vi.fn(),
  useSelectedModelInfo: vi.fn(),
  getModel: vi.fn(),
}))

mockNuxtImport('useUserModel', () => mocks.useUserModel)
mockNuxtImport('useSelectedModelInfo', () => mocks.useSelectedModelInfo)
mockNuxtImport('getModel', () => mocks.getModel)

function selectDirectModel(inputModalities: string[] | undefined) {
  mocks.useUserModel.mockReturnValue({
    selection: shallowRef<ModelSelection>({
      source: 'provider',
      modelId: 'direct-model',
    }),
    userModel: shallowRef('direct-model'),
  })
  mocks.useSelectedModelInfo.mockReturnValue({
    gatewayModel: shallowRef(null),
  })
  mocks.getModel.mockReturnValue({
    model: inputModalities
      ? { modalities: { input: inputModalities, output: ['text'] } }
      : {},
  })
}

function selectGatewayModel(modalities: { input: string[] } | undefined) {
  mocks.useUserModel.mockReturnValue({
    selection: shallowRef<ModelSelection>({
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: 'vendor/model',
    } as ModelSelection),
    userModel: shallowRef(null),
  })
  mocks.useSelectedModelInfo.mockReturnValue({
    gatewayModel: shallowRef(
      modalities
        ? { id: 'vendor/model', name: 'Model', toolCall: true, modalities }
        : { id: 'vendor/model', name: 'Model', toolCall: true },
    ),
  })
}

describe('useImageInputSupport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('direct models', () => {
    it('rejects PDFs when the model lacks pdf input', () => {
      selectDirectModel(['text', 'image'])

      const {
        canAttachMediaType,
        isImageInputSupported,
      } = useImageInputSupport()

      expect(isImageInputSupported.value).toBe(true)
      expect(canAttachMediaType.value('application/pdf')).toBe(false)
      expect(canAttachMediaType.value('image/png')).toBe(true)
      expect(canAttachMediaType.value('text/plain')).toBe(true)
    })

    it('allows PDFs when the model has pdf input', () => {
      selectDirectModel(['text', 'image', 'pdf'])

      const { canAttachMediaType } = useImageInputSupport()

      expect(canAttachMediaType.value('application/pdf')).toBe(true)
    })

    it('accepts a PDF for an image-generation model through its controller', () => {
      selectDirectModel(['text', 'image'])
      mocks.getModel.mockReturnValue({
        model: {
          id: 'gpt-image-2',
          modalities: { input: ['text', 'image'], output: ['image'] },
          imageGeneration: { controllerModel: 'gpt-6-luna' },
        },
      })

      const { canAttachMediaType } = useImageInputSupport()

      expect(canAttachMediaType.value('application/pdf')).toBe(true)
      expect(canAttachMediaType.value('image/png')).toBe(true)
    })

    it('rejects images and PDFs for a text-only model', () => {
      selectDirectModel(['text'])

      const { canAttachMediaType } = useImageInputSupport()

      expect(canAttachMediaType.value('image/webp')).toBe(false)
      expect(canAttachMediaType.value('application/pdf')).toBe(false)
      expect(canAttachMediaType.value('text/plain')).toBe(true)
    })

    it('fails open when modalities are missing', () => {
      selectDirectModel(undefined)

      const { canAttachMediaType } = useImageInputSupport()

      expect(canAttachMediaType.value('image/png')).toBe(true)
      expect(canAttachMediaType.value('application/pdf')).toBe(true)
    })

    it('fails open when the model cannot be resolved', () => {
      selectDirectModel(['text'])
      mocks.getModel.mockReturnValue({ model: null })

      const {
        isImageInputSupported,
        canAttachMediaType,
      } = useImageInputSupport()

      expect(isImageInputSupported.value).toBe(true)
      expect(canAttachMediaType.value('application/pdf')).toBe(true)
    })
  })

  describe('gateway models', () => {
    it('always allows PDFs, even when modalities exclude them', () => {
      selectGatewayModel({ input: ['text'] })

      const { canAttachMediaType } = useImageInputSupport()

      expect(canAttachMediaType.value('application/pdf')).toBe(true)
    })

    it('gates images on gateway input modalities', () => {
      selectGatewayModel({ input: ['text', 'file'] })

      const {
        canAttachMediaType,
        isImageInputSupported,
      } = useImageInputSupport()

      expect(isImageInputSupported.value).toBe(false)
      expect(canAttachMediaType.value('image/jpeg')).toBe(false)
      expect(canAttachMediaType.value('text/plain')).toBe(true)
    })

    it('allows images when gateway modalities include image', () => {
      selectGatewayModel({ input: ['text', 'image'] })

      const { canAttachMediaType } = useImageInputSupport()

      expect(canAttachMediaType.value('image/png')).toBe(true)
    })

    it('fails open for images when gateway modalities are missing', () => {
      selectGatewayModel(undefined)

      const { canAttachMediaType } = useImageInputSupport()

      expect(canAttachMediaType.value('image/png')).toBe(true)
      expect(canAttachMediaType.value('application/pdf')).toBe(true)
    })
  })
})
