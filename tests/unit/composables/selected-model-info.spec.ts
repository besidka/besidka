import type { ModelSelection } from '#shared/types/model-selection.d'
import type { GatewayModel } from '#shared/types/gateways.d'
import { shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useSelectedModelInfo } from '../../../app/composables/selected-model-info'

const mocks = vi.hoisted(() => ({
  useUserModel: vi.fn(),
  useGatewayCatalogCache: vi.fn(),
  getModel: vi.fn(),
  getModelName: vi.fn(),
}))

mockNuxtImport('useUserModel', () => mocks.useUserModel)
mockNuxtImport('useGatewayCatalogCache', () => mocks.useGatewayCatalogCache)
mockNuxtImport('getModel', () => mocks.getModel)
mockNuxtImport('getModelName', () => mocks.getModelName)

const gatewayModel: GatewayModel = {
  id: 'anthropic/claude-opus-5',
  name: 'Claude Opus 5',
  description: 'Frontier reasoning model',
  toolCall: true,
}

function selectionOf(selection: ModelSelection) {
  mocks.useUserModel.mockReturnValue({
    selection: shallowRef<ModelSelection>(selection),
  })
}

describe('useSelectedModelInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useGatewayCatalogCache.mockReturnValue(shallowRef({}))
    mocks.getModel.mockReturnValue({
      model: { description: 'Curated model' },
      provider: { id: 'google' },
    })
    mocks.getModelName.mockReturnValue('Gemini 2.5 Flash')
  })

  it('resolves the selected model from the curated catalog', () => {
    selectionOf({ source: 'provider', modelId: 'gemini-2.5-flash' })

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
    selectionOf({ source: 'provider', modelId: 'unknown-model' })

    const { description, iconProviderId } = useSelectedModelInfo()

    expect(description.value).toBeUndefined()
    expect(iconProviderId.value).toBeNull()
  })

  it('resolves a gateway selection from the cached catalog', () => {
    mocks.useGatewayCatalogCache.mockReturnValue(
      shallowRef({ vercel: [gatewayModel] }),
    )
    selectionOf({
      source: 'gateway',
      gatewayId: 'vercel',
      modelId: 'anthropic/claude-opus-5',
    })

    const { name, description, iconProviderId } = useSelectedModelInfo()

    expect(name.value).toBe('Claude Opus 5')
    expect(description.value).toBe('Frontier reasoning model')
    expect(iconProviderId.value).toBe('vercel')
  })

  it('falls back to the raw id when the catalog is not cached yet', () => {
    selectionOf({
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: 'anthropic/claude-opus-5:free',
    })

    const { name, description, iconProviderId } = useSelectedModelInfo()

    expect(name.value).toBe('anthropic/claude-opus-5:free')
    expect(description.value).toBeUndefined()
    expect(iconProviderId.value).toBe('openrouter')
    expect(mocks.getModelName).not.toHaveBeenCalled()
  })

  it('does not confuse catalogs from different gateways', () => {
    mocks.useGatewayCatalogCache.mockReturnValue(
      shallowRef({ vercel: [gatewayModel] }),
    )
    selectionOf({
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: 'anthropic/claude-opus-5',
    })

    const { name } = useSelectedModelInfo()

    expect(name.value).toBe('anthropic/claude-opus-5')
  })
})
