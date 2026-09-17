import type { Model, Provider } from '#shared/types/providers.d'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getModel: vi.fn(),
  getControllerModelId: vi.fn((model: Model) => model.id),
  getImageGenerationModelId: vi.fn(
    (model: Model, fallbackModelId: string) => {
      return model.imageGeneration ? model.id : fallbackModelId
    },
  ),
}))

vi.mock('#shared/utils/model', () => ({
  getModel: mocks.getModel,
  getControllerModelId: mocks.getControllerModelId,
  getImageGenerationModelId: mocks.getImageGenerationModelId,
}))

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'grok-4.5',
    name: 'Grok 4.5',
    description: 'General-purpose xAI model',
    contextLength: 256_000,
    maxOutputTokens: 16_000,
    price: {
      tokens: 1_000_000,
      input: '3.00',
      output: '15.00',
    },
    priceTier: '$$$',
    modalities: {
      input: ['text'],
      output: ['text'],
    },
    tools: ['web_search'],
    ...overrides,
  }
}

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'xai',
    name: 'xAI',
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

async function importUseXai() {
  const { useXai } = await import('../../../../server/utils/providers/xai')

  return useXai
}

describe('useXai reasoning wiring for grok-4.5', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
  })

  it.each(['low', 'medium', 'high'] as const)(
    'sets the reasoning option at %s and marks summaries detailed',
    async (level) => {
      stubModel(createModel({
        id: 'grok-4.5',
        reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
      }))

      const useXai = await importUseXai()
      const result = await useXai('1', 'grok-4.5', [], level)

      expect(result.providerOptions).toEqual({
        reasoningSummary: 'detailed',
      })
      expect(result.reasoning).toBe(level)
    },
  )

  it('leaves providerOptions empty and reasoning unset when off', async () => {
    stubModel(createModel({
      id: 'grok-4.5',
      reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
    }))

    const useXai = await importUseXai()
    const result = await useXai('1', 'grok-4.5', [], 'off')

    expect(result.providerOptions).toEqual({})
    expect(result.reasoning).toBeUndefined()
  })
})

describe.each(['grok-4.20-0309-reasoning', 'grok-4.20-0309-non-reasoning'])(
  'useXai reasoning wiring for %s',
  (modelId) => {
    beforeEach(() => {
      vi.resetModules()
      vi.clearAllMocks()
      stubKeyLookup()
    })

    it.each(['off', 'low', 'medium', 'high'] as const)(
      'never sets a reasoning value when requested level is %s',
      async (level) => {
        stubModel(createModel({ id: modelId }))

        const useXai = await importUseXai()
        const result = await useXai('1', modelId, [], level)

        expect(result.providerOptions).toEqual({})
        expect(result.reasoning).toBeUndefined()
      },
    )
  },
)

describe('useXai reasoning wiring for the reasoningAlwaysOn flag', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
  })

  it.each(['off', 'low', 'medium', 'high'] as const)(
    'always requests a reasoning summary regardless of requested level %s, '
    + 'since the model always reasons but never accepts a reasoning_effort',
    async (level) => {
      stubModel(createModel({
        id: 'grok-4.20-0309-reasoning',
        reasoningAlwaysOn: true,
      }))

      const useXai = await importUseXai()
      const result = await useXai(
        '1',
        'grok-4.20-0309-reasoning',
        [],
        level,
      )

      expect(result.providerOptions).toEqual({
        reasoningSummary: 'detailed',
      })
      expect(result.reasoning).toBeUndefined()
    },
  )
})

describe('useXai web search tool choice', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
  })

  it('forces the web search tool choice when reasoning is off', async () => {
    stubModel(createModel({
      id: 'grok-4.5',
      reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
    }))

    const useXai = await importUseXai()
    const result = await useXai('1', 'grok-4.5', ['web_search'], 'off')

    expect(result.tools.toolChoice).toEqual({
      type: 'tool',
      toolName: 'web_search_preview',
    })
  })

  it('leaves tool choice unset when reasoning is enabled', async () => {
    stubModel(createModel({
      id: 'grok-4.5',
      reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
    }))

    const useXai = await importUseXai()
    const result = await useXai('1', 'grok-4.5', ['web_search'], 'medium')

    expect(result.tools.toolChoice).toBeUndefined()
  })
})

describe('useXai image generation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
  })

  it('returns undefined for the image model unless image_generation is '
    + 'requested', async () => {
    stubModel(createModel({ id: 'grok-4.20-0309-non-reasoning' }))

    const useXai = await importUseXai()
    const result = await useXai(
      '1',
      'grok-4.20-0309-non-reasoning',
      ['web_search'],
      'off',
    )

    expect(result.imageModel).toBeUndefined()
  })

  it('resolves the image model and its id when image_generation is '
    + 'requested', async () => {
    stubModel(createModel({
      id: 'grok-imagine-image-2.0',
      imageGeneration: {
        controllerModel: 'grok-4.20-0309-non-reasoning',
      },
    }))

    const useXai = await importUseXai()
    const result = await useXai(
      '1',
      'grok-imagine-image-2.0',
      ['image_generation'],
      'off',
    )

    expect(result.imageModelId).toBe('grok-imagine-image-2.0')
    expect(result.imageModel).toBeDefined()
  })

  it('returns an empty tools object when image_generation is requested, '
    + 'never attaching web search alongside the image tool', async () => {
    stubModel(createModel({
      id: 'grok-imagine-image-2.0',
      imageGeneration: {
        controllerModel: 'grok-4.20-0309-non-reasoning',
      },
    }))

    const useXai = await importUseXai()
    const result = await useXai(
      '1',
      'grok-imagine-image-2.0',
      ['image_generation', 'web_search'],
      'off',
    )

    expect(result.tools).toEqual({})
  })
})

describe('useXai controller model resolution for image-only models', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
  })

  it('builds the language model instance from the imageGeneration '
    + 'controller model, not the image-only model id itself', async () => {
    const controllerModelId = 'grok-4.20-0309-non-reasoning'
    const imageOnlyModel = createModel({
      id: 'grok-imagine-image-2.0',
      imageGeneration: { controllerModel: controllerModelId },
    })

    stubModel(imageOnlyModel)
    mocks.getControllerModelId.mockImplementationOnce((model: Model) => {
      return model.imageGeneration?.controllerModel ?? model.id
    })

    const useXai = await importUseXai()
    const result = await useXai(
      '1',
      'grok-imagine-image-2.0',
      ['image_generation'],
      'off',
    )

    expect(mocks.getControllerModelId).toHaveBeenCalledWith(imageOnlyModel)
    expect(result.instance.modelId).toBe(controllerModelId)
    expect(result.instance.modelId).not.toBe('grok-imagine-image-2.0')
  })
})
