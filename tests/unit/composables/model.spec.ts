import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultModel } from '../../../providers'
import { useUserModel } from '../../../app/composables/model'
import {
  getSelectionGatewayId,
  parseModelSelection,
  serializeModelSelection,
} from '../../../shared/utils/model-selection'

const openRouterModelId = 'anthropic/claude-opus-5:free'

describe('parseModelSelection', () => {
  it('reads a legacy bare string as a provider selection', () => {
    expect(parseModelSelection('gemini-2.5-flash', 'fallback-model')).toEqual({
      source: 'provider',
      modelId: 'gemini-2.5-flash',
    })
  })

  it('falls back to the default model when nothing is stored', () => {
    expect(parseModelSelection(null, 'fallback-model')).toEqual({
      source: 'provider',
      modelId: 'fallback-model',
    })
    expect(parseModelSelection('', 'fallback-model')).toEqual({
      source: 'provider',
      modelId: 'fallback-model',
    })
  })

  it('reads a gateway selection whose id contains a colon and a slash', () => {
    const raw = JSON.stringify({
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: openRouterModelId,
    })

    expect(parseModelSelection(raw, 'fallback-model')).toEqual({
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: openRouterModelId,
    })
  })

  it('degrades to a bare-string reading instead of throwing on bad JSON', () => {
    expect(parseModelSelection('{not json at all', 'fallback-model')).toEqual({
      source: 'provider',
      modelId: '{not json at all',
    })
  })

  it('rejects JSON that is not a valid selection', () => {
    const raw = JSON.stringify({ source: 'gateway', modelId: 'x' })
    const unknownGateway = JSON.stringify({
      source: 'gateway',
      gatewayId: 'not-a-gateway',
      modelId: 'x',
    })

    expect(parseModelSelection(raw, 'fallback-model').source).toBe('provider')
    expect(parseModelSelection(unknownGateway, 'fallback-model').source)
      .toBe('provider')
  })
})

describe('serializeModelSelection', () => {
  it('writes a provider selection as the bare model id', () => {
    expect(serializeModelSelection({
      source: 'provider',
      modelId: 'gemini-2.5-flash',
    })).toBe('gemini-2.5-flash')
  })

  it('round-trips a gateway selection through JSON', () => {
    const selection = {
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: openRouterModelId,
    } as const
    const raw = serializeModelSelection(selection)

    expect(raw.startsWith('{')).toBe(true)
    expect(parseModelSelection(raw, 'fallback-model')).toEqual(selection)
  })
})

describe('getSelectionGatewayId', () => {
  it('returns undefined for a provider selection', () => {
    expect(getSelectionGatewayId({
      source: 'provider',
      modelId: 'gemini-2.5-flash',
    })).toBeUndefined()
  })

  it('returns the gateway id for a gateway selection', () => {
    expect(getSelectionGatewayId({
      source: 'gateway',
      gatewayId: 'vercel',
      modelId: 'openai/gpt-4o',
    })).toBe('vercel')
  })
})

describe('useUserModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('loads a pre-gateway stored value with no migration', () => {
    localStorage.setItem('model', 'gpt-5.4')

    const { selection, userModel } = useUserModel()

    expect(selection.value).toEqual({
      source: 'provider',
      modelId: 'gpt-5.4',
    })
    expect(userModel.value).toBe('gpt-5.4')
  })

  it('falls back to the build-time default model', () => {
    const { selection, userModel } = useUserModel()

    expect(selection.value).toEqual({
      source: 'provider',
      modelId: defaultModel,
    })
    expect(userModel.value).toBe(defaultModel)
  })

  it('keeps writing provider selections as a bare string', () => {
    const { selection } = useUserModel()

    selection.value = { source: 'provider', modelId: 'gpt-5.4' }

    expect(localStorage.getItem('model')).toBe('gpt-5.4')
  })

  it('stores a gateway selection as JSON and reads it back', () => {
    const { selection, userModel } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: openRouterModelId,
    }

    expect(JSON.parse(localStorage.getItem('model') as string)).toEqual({
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: openRouterModelId,
    })
    expect(selection.value).toEqual({
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: openRouterModelId,
    })
    expect(userModel.value).toBe(openRouterModelId)
  })

  it('writes a provider selection when the legacy string ref is set', () => {
    const { selection, userModel } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'vercel',
      modelId: 'openai/gpt-4o',
    }
    userModel.value = 'gpt-5.4'

    expect(localStorage.getItem('model')).toBe('gpt-5.4')
    expect(selection.value).toEqual({
      source: 'provider',
      modelId: 'gpt-5.4',
    })
  })

  it('survives a corrupt stored value', () => {
    localStorage.setItem('model', '{"source":"gateway"')

    const { selection } = useUserModel()

    expect(selection.value.source).toBe('provider')
  })
})
