import type { Model, Provider } from '#shared/types/providers.d'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getModel: vi.fn(),
  getControllerModelId: vi.fn((model: Model) => model.id),
  getImageGenerationModelId: vi.fn(
    (_model: Model, fallbackModelId: string) => fallbackModelId,
  ),
}))

vi.mock('#shared/utils/model', () => ({
  getModel: mocks.getModel,
  getControllerModelId: mocks.getControllerModelId,
  getImageGenerationModelId: mocks.getImageGenerationModelId,
}))

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    description: 'General-purpose OpenAI model',
    contextLength: 400_000,
    maxOutputTokens: 128_000,
    price: {
      tokens: 1_000_000,
      input: '2.50',
      output: '15.00',
    },
    priceTier: '$$$',
    modalities: {
      input: ['text'],
      output: ['text'],
    },
    tools: ['web_search'],
    toolCall: true,
    reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
    ...overrides,
  }
}

function createProvider(models: Model[]): Provider {
  return {
    id: 'openai',
    name: 'OpenAI',
    models,
  }
}

function stubModel(model: Model) {
  mocks.getModel.mockReturnValue({
    modelName: model.name,
    model,
    provider: createProvider([model]),
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

async function importUseOpenAI() {
  const { useOpenAI } = await import('../../../../server/utils/providers/openai')

  return useOpenAI
}

describe('useOpenAI prompt cache routing', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
    stubModel(createModel())
  })

  it('adds promptCacheKey when a cache key is given', async () => {
    const useOpenAI = await importUseOpenAI()
    const result = await useOpenAI(
      '1',
      'gpt-5.4',
      [],
      'off',
      '01JABCDEFGHJKMNPQRSTVWXYZ0',
    )

    expect(result.providerOptions).toEqual({
      promptCacheKey: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    })
  })

  it('keeps reasoningSummary alongside promptCacheKey', async () => {
    const useOpenAI = await importUseOpenAI()
    const result = await useOpenAI(
      '1',
      'gpt-5.4',
      [],
      'medium',
      '01JABCDEFGHJKMNPQRSTVWXYZ0',
    )

    expect(result.providerOptions).toEqual({
      reasoningSummary: 'detailed',
      promptCacheKey: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    })
  })

  it('omits promptCacheKey when no cache key is given', async () => {
    const useOpenAI = await importUseOpenAI()
    const result = await useOpenAI('1', 'gpt-5.4', [], 'off')

    expect(result.providerOptions).toEqual({})
    expect(result.providerOptions).not.toHaveProperty('promptCacheKey')
  })

  it('never sets prompt cache retention or options', async () => {
    const useOpenAI = await importUseOpenAI()
    const result = await useOpenAI(
      '1',
      'gpt-5.4',
      [],
      'off',
      '01JABCDEFGHJKMNPQRSTVWXYZ0',
    )

    expect(result.providerOptions).not.toHaveProperty('promptCacheRetention')
    expect(result.providerOptions).not.toHaveProperty('promptCacheOptions')
  })
})
