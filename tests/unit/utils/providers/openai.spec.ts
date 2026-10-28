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

describe('useOpenAI image controller reasoning', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
  })

  function stubImageModel(controllerModelId: string) {
    stubModel(createModel({
      id: 'gpt-image-2',
      name: 'GPT Image 2',
      tools: [],
      toolCall: false,
      reasoning: undefined,
      imageGeneration: { controllerModel: controllerModelId },
    }))
    mocks.getControllerModelId.mockReturnValue(controllerModelId)
    mocks.getImageGenerationModelId.mockReturnValue('gpt-image-2')
  }

  it('sends reasoning effort none to the controller at off', async () => {
    stubImageModel('gpt-6-luna')

    const useOpenAI = await importUseOpenAI()
    const result = await useOpenAI(
      '1',
      'gpt-image-2',
      ['image_generation'],
      'off',
    )

    expect(result.providerOptions).toEqual({ reasoningEffort: 'none' })
    expect(result.reasoning).toBeUndefined()
  })

  it('keeps promptCacheKey next to the none effort', async () => {
    stubImageModel('gpt-6-luna')

    const useOpenAI = await importUseOpenAI()
    const result = await useOpenAI(
      '1',
      'gpt-image-2',
      ['image_generation'],
      'off',
      '01JABCDEFGHJKMNPQRSTVWXYZ0',
    )

    expect(result.providerOptions).toEqual({
      reasoningEffort: 'none',
      promptCacheKey: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    })
  })

  it('does not send none to a controller that does not accept it',
    async () => {
      stubImageModel('gpt-5.4')

      const useOpenAI = await importUseOpenAI()
      const result = await useOpenAI(
        '1',
        'gpt-image-2',
        ['image_generation'],
        'off',
      )

      expect(result.providerOptions).not.toHaveProperty('reasoningEffort')
    })

  it('leaves a normal gpt-6 text send at off untouched', async () => {
    mocks.getControllerModelId.mockImplementation((model: Model) => model.id)
    stubModel(createModel({
      id: 'gpt-6-luna',
      name: 'GPT-6 Luna',
      tools: ['web_search', 'image_generation'],
    }))

    const useOpenAI = await importUseOpenAI()
    const result = await useOpenAI('1', 'gpt-6-luna', ['web_search'], 'off')

    expect(result.providerOptions).toEqual({})
    expect(result.reasoning).toBeUndefined()
  })

  it('keeps the requested effort for a gpt-6 text send with reasoning on',
    async () => {
      mocks.getControllerModelId.mockImplementation((model: Model) => model.id)
      stubModel(createModel({ id: 'gpt-6-luna', name: 'GPT-6 Luna' }))

      const useOpenAI = await importUseOpenAI()
      const result = await useOpenAI('1', 'gpt-6-luna', [], 'high')

      expect(result.providerOptions).toEqual({ reasoningSummary: 'detailed' })
      expect(result.reasoning).toBe('high')
    })
})
