import { shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useSelectedModelInfo } from '../../../app/composables/selected-model-info'

const mocks = vi.hoisted(() => ({
  useUserModel: vi.fn(),
  getModel: vi.fn(),
  getModelName: vi.fn(),
}))

mockNuxtImport('useUserModel', () => mocks.useUserModel)
mockNuxtImport('getModel', () => mocks.getModel)
mockNuxtImport('getModelName', () => mocks.getModelName)

function userModelOf(modelId: string) {
  mocks.useUserModel.mockReturnValue({
    userModel: shallowRef<string>(modelId),
  })
}

describe('useSelectedModelInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getModel.mockReturnValue({
      model: { description: 'Curated model' },
      provider: { id: 'google' },
    })
    mocks.getModelName.mockReturnValue('Gemini 2.5 Flash')
  })

  it('resolves the selected model from the curated catalog', () => {
    userModelOf('gemini-2.5-flash')

    const { name, description, iconProviderId } = useSelectedModelInfo()

    expect(name.value).toBe('Gemini 2.5 Flash')
    expect(description.value).toBe('Curated model')
    expect(iconProviderId.value).toBe('google')
  })

  it('returns a null icon provider id when the model is not found', () => {
    mocks.getModel.mockReturnValue({
      model: null,
      provider: null,
    })
    userModelOf('unknown-model')

    const { description, iconProviderId } = useSelectedModelInfo()

    expect(description.value).toBeUndefined()
    expect(iconProviderId.value).toBeNull()
  })
})
