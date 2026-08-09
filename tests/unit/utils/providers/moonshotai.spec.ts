import type { Model, Provider } from '#shared/types/providers.d'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getModel: vi.fn(),
  getControllerModelId: vi.fn((model: Model) => model.id),
}))

vi.mock('#shared/utils/model', () => ({
  getModel: mocks.getModel,
  getControllerModelId: mocks.getControllerModelId,
}))

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'kimi-k2.5',
    name: 'Kimi K2.5',
    description: 'General-purpose Moonshot AI model',
    contextLength: 128_000,
    maxOutputTokens: 8_000,
    price: {
      tokens: 1_000_000,
      input: '0.6',
      output: '2.5',
    },
    priceTier: '$',
    modalities: {
      input: ['text'],
      output: ['text'],
    },
    tools: [],
    ...overrides,
  }
}

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'moonshotai',
    name: 'Moonshot AI',
    models: [],
    ...overrides,
  }
}

function stubModel(model: Model) {
  mocks.getModel.mockReturnValue({
    modelName: model.name,
    model,
    provider: createProvider({ models: [model] }),
  })
}

function stubKeyLookup() {
  vi.stubGlobal('useDb', () => ({
    query: {
      keys: {
        findFirst: vi.fn(async () => ({ apiKey: 'encrypted-key' })),
      },
    },
  }))
  vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
}

async function importUseMoonshotAi() {
  const { useMoonshotAi } = await import(
    '../../../../server/utils/providers/moonshotai'
  )

  return useMoonshotAi
}

describe.each(['kimi-k2.5', 'kimi-k2.6'])(
  'useMoonshotAi reasoning wiring for %s',
  (modelId) => {
    beforeEach(() => {
      vi.resetModules()
      vi.clearAllMocks()
      stubKeyLookup()
    })

    it('enables thinking and never sets the top-level reasoning option', async () => {
      stubModel(createModel({
        id: modelId,
        reasoning: { mode: 'toggle' },
      }))

      const useMoonshotAi = await importUseMoonshotAi()
      const result = await useMoonshotAi('1', modelId, [], 'medium')

      expect(result.providerOptions).toEqual({
        thinking: { type: 'enabled' },
      })
      expect(result.reasoning).toBeUndefined()
    })

    it('disables thinking and never sets the top-level reasoning option', async () => {
      stubModel(createModel({
        id: modelId,
        reasoning: { mode: 'toggle' },
      }))

      const useMoonshotAi = await importUseMoonshotAi()
      const result = await useMoonshotAi('1', modelId, [], 'off')

      expect(result.providerOptions).toEqual({
        thinking: { type: 'disabled' },
      })
      expect(result.reasoning).toBeUndefined()
    })
  },
)

describe('useMoonshotAi reasoning wiring for kimi-k3', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
  })

  it('sends no reasoning field for a model with no reasoning capability', async () => {
    stubModel(createModel({ id: 'kimi-k3' }))

    const useMoonshotAi = await importUseMoonshotAi()
    const result = await useMoonshotAi('1', 'kimi-k3', [], 'medium')

    expect(result.providerOptions).toEqual({})
    expect(result.reasoning).toBeUndefined()
  })
})
