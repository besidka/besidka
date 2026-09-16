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
    id: 'deepseek-flash',
    name: 'DeepSeek Flash',
    description: 'General-purpose DeepSeek model',
    contextLength: 128_000,
    maxOutputTokens: 8_000,
    price: {
      tokens: 1_000_000,
      input: '0.27',
      output: '1.10',
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
    id: 'deepseek',
    name: 'DeepSeek',
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

async function importUseDeepSeek() {
  const { useDeepSeek } = await import(
    '../../../../server/utils/providers/deepseek'
  )

  return useDeepSeek
}

describe('useDeepSeek reasoning wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
  })

  it('enables the thinking toggle without double-signaling reasoning', async () => {
    stubModel(createModel({
      id: 'deepseek-flash',
      reasoning: { mode: 'toggle' },
    }))

    const useDeepSeek = await importUseDeepSeek()
    const result = await useDeepSeek('1', 'deepseek-flash', [], 'medium')

    expect(result.providerOptions).toEqual({
      thinking: { type: 'enabled' },
    })
    expect(result.reasoning).toBeUndefined()
  })

  it('disables the thinking toggle without double-signaling reasoning', async () => {
    stubModel(createModel({
      id: 'deepseek-v4-pro',
      reasoning: { mode: 'toggle' },
    }))

    const useDeepSeek = await importUseDeepSeek()
    const result = await useDeepSeek('1', 'deepseek-v4-pro', [], 'off')

    expect(result.providerOptions).toEqual({
      thinking: { type: 'disabled' },
    })
    expect(result.reasoning).toBeUndefined()
  })

  it('leaves providerOptions empty and forwards the level for a '
    + 'synthetic levels-mode model, since no curated DeepSeek model uses '
    + 'levels mode any more', async () => {
    stubModel(createModel({
      id: 'deepseek-synthetic-levels-model',
      reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
    }))

    const useDeepSeek = await importUseDeepSeek()
    const result = await useDeepSeek(
      '1',
      'deepseek-synthetic-levels-model',
      [],
      'high',
    )

    expect(result.providerOptions).toEqual({})
    expect(result.reasoning).toBe('high')
  })

  it('resolves an unsupported level to off for a synthetic levels-mode '
    + 'model', async () => {
    stubModel(createModel({
      id: 'deepseek-synthetic-levels-model',
      reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
    }))

    const useDeepSeek = await importUseDeepSeek()
    const result = await useDeepSeek(
      '1',
      'deepseek-synthetic-levels-model',
      [],
      'off',
    )

    expect(result.providerOptions).toEqual({})
    expect(result.reasoning).toBeUndefined()
  })
})
