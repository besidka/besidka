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
    id: 'qwen3.7-plus',
    name: 'Qwen3.7 Plus',
    description: 'General-purpose Qwen model',
    contextLength: 1_000_000,
    maxOutputTokens: 65_536,
    price: {
      tokens: 1_000_000,
      input: '0.50',
      output: '3.00',
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
    id: 'qwen',
    name: 'Qwen',
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

async function importUseQwen() {
  const { useQwen } = await import('../../../../server/utils/providers/qwen')

  return useQwen
}

describe('useQwen key lookup', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
    }) => {
      const exception = new Error(input.statusMessage || 'Error')

      Object.assign(exception, input)

      return exception
    })
  })

  it('looks the key up under the qwen provider id', async () => {
    const findFirst = vi.fn(async () => ({ apiKey: 'encrypted-key' }))

    vi.stubGlobal('useDb', () => ({ query: { keys: { findFirst } } }))
    vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
    stubModel(createModel())

    const useQwen = await importUseQwen()

    await useQwen('1', 'qwen3.7-plus', [], 'off')

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: 'qwen',
        }),
      }),
    )
  })

  it('throws a 401-style error when no key is stored', async () => {
    vi.stubGlobal('useDb', () => ({
      query: {
        keys: {
          findFirst: vi.fn(async () => undefined),
        },
      },
    }))
    stubModel(createModel())

    const useQwen = await importUseQwen()

    await expect(useQwen('1', 'qwen3.7-plus', [], 'off'))
      .rejects.toMatchObject({
        statusCode: 401,
        statusMessage: 'Qwen API key not found. Please set it up in the settings.',
      })
  })

  it('throws a 400-style error for an unsupported model', async () => {
    stubKeyLookup()
    mocks.getModel.mockReturnValue({
      modelName: 'Select Model',
      model: null,
      provider: null,
    })

    const useQwen = await importUseQwen()

    await expect(useQwen('1', 'not-a-model', [], 'off'))
      .rejects.toMatchObject({
        statusCode: 400,
        statusMessage: 'Unsupported model.',
      })
  })
})

describe('useQwen instance shape', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
  })

  it('builds an openai-compatible instance against the DashScope '
    + 'international endpoint', async () => {
    stubModel(createModel())

    const useQwen = await importUseQwen()
    const result = await useQwen('1', 'qwen3.7-plus', [], 'off')

    const instance = result.instance as unknown as {
      modelId: string
      config: { provider: string, url: (options: { path: string }) => string }
    }

    expect(instance.modelId).toBe('qwen3.7-plus')
    expect(instance.config.provider).toContain('qwen')
    expect(instance.config.url({ path: '/chat/completions' })).toBe(
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    )
  })

  it('exposes no tools, matching every other Qwen model', async () => {
    stubModel(createModel())

    const useQwen = await importUseQwen()
    const result = await useQwen('1', 'qwen3.7-plus', [], 'off')

    expect(result.tools).toEqual({})
  })

  it('wires generateChatTitle through useChatTitle with the built instance',
    async () => {
      stubModel(createModel())

      const useChatTitleMock = vi.fn(async () => 'A title')

      vi.stubGlobal('useChatTitle', useChatTitleMock)

      const useQwen = await importUseQwen()
      const result = await useQwen('1', 'qwen3.7-plus', [], 'off')

      const title = await result.generateChatTitle('Plan a trip to Kyoto')

      expect(title).toBe('A title')
      expect(useChatTitleMock).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'qwen3.7-plus' }),
        'Plan a trip to Kyoto',
      )
    })
})

describe('useQwen reasoning wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
  })

  it('enables the thinking toggle without setting the top-level reasoning '
    + 'option', async () => {
    stubModel(createModel({
      id: 'qwen3.7-plus',
      reasoning: { mode: 'toggle' },
    }))

    const useQwen = await importUseQwen()
    const result = await useQwen('1', 'qwen3.7-plus', [], 'medium')

    expect(result.providerOptions).toEqual({
      enable_thinking: true,
    })
    expect(result.reasoning).toBeUndefined()
  })

  it('disables the thinking toggle when the requested level is off',
    async () => {
      stubModel(createModel({
        id: 'qwen3.7-plus',
        reasoning: { mode: 'toggle' },
      }))

      const useQwen = await importUseQwen()
      const result = await useQwen('1', 'qwen3.7-plus', [], 'off')

      expect(result.providerOptions).toEqual({
        enable_thinking: false,
      })
      expect(result.reasoning).toBeUndefined()
    })

  it('leaves providerOptions empty for a model with no reasoning '
    + 'capability', async () => {
    stubModel(createModel({ id: 'qwen3.7-plus', reasoning: undefined }))

    const useQwen = await importUseQwen()
    const result = await useQwen('1', 'qwen3.7-plus', [], 'medium')

    expect(result.providerOptions).toEqual({})
    expect(result.reasoning).toBeUndefined()
  })
})
