import type { Model, Provider } from '#shared/types/providers.d'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getModel: vi.fn(),
}))

vi.mock('#shared/utils/model', () => ({
  getModel: mocks.getModel,
}))

async function importProvider() {
  return import('../../../../server/utils/chats/provider')
}

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'gpt-5-mini',
    name: 'GPT-5 mini',
    description: 'Fast general-purpose model',
    contextLength: 128_000,
    maxOutputTokens: 16_000,
    price: {
      tokens: 1_000_000,
      input: '0.15',
      output: '0.6',
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
    id: 'openai',
    name: 'OpenAI',
    models: [],
    ...overrides,
  }
}

describe('useChatProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an empty model id without resolving the catalog', async () => {
    const { useChatProvider } = await importProvider()

    expect(() => useChatProvider('')).toThrow(
      'Please select a model to continue.',
    )
    expect(mocks.getModel).not.toHaveBeenCalled()
  })

  it('rejects an unknown model id with the existing 400', async () => {
    mocks.getModel.mockReturnValue({
      model: null,
      provider: null,
      modelName: 'Select Model',
    })

    const { useChatProvider } = await importProvider()

    let caughtError: any

    try {
      useChatProvider('not-a-real-model')
    } catch (exception) {
      caughtError = exception
    }

    expect(caughtError.statusCode).toBe(400)
    expect(caughtError.statusMessage).toBe(
      'Current model is not supported by any provider. Please select a'
      + ' different model.',
    )
  })

  it('rejects a deprecated model with a structured 400', async () => {
    const deprecatedModel = createModel({
      id: 'gemini-3-pro-preview',
      name: 'Gemini 3 Pro Preview',
      status: 'deprecated',
    })
    const provider = createProvider({ id: 'google', name: 'Google' })

    mocks.getModel.mockReturnValue({
      model: deprecatedModel,
      provider,
      modelName: deprecatedModel.name,
    })

    const { useChatProvider } = await importProvider()

    let caughtError: any

    try {
      useChatProvider('gemini-3-pro-preview')
    } catch (exception) {
      caughtError = exception
    }

    expect(caughtError.status).toBe(400)
    expect(caughtError.message).toBe('This model is no longer available.')
    expect(caughtError.why).toContain('Gemini 3 Pro Preview')
    expect(caughtError.fix).toBe('Choose a different model from the picker.')
  })

  it('resolves a non-deprecated model normally', async () => {
    const model = createModel()
    const provider = createProvider()

    mocks.getModel.mockReturnValue({
      model,
      provider,
      modelName: model.name,
    })

    const { useChatProvider } = await importProvider()

    const result = useChatProvider('gpt-5-mini')

    expect(result.model).toBe(model)
    expect(result.provider).toBe(provider)
    expect(result.modelName).toBe(model.name)
    expect(mocks.getModel).toHaveBeenCalledWith('gpt-5-mini')
  })

  it('does not reject models carrying a non-deprecated status', async () => {
    const betaModel = createModel({
      id: 'gemini-3.6-flash',
      name: 'Gemini 3.6 Flash',
      status: 'beta',
    })

    mocks.getModel.mockReturnValue({
      model: betaModel,
      provider: createProvider({ id: 'google', name: 'Google' }),
      modelName: betaModel.name,
    })

    const { useChatProvider } = await importProvider()

    expect(() => useChatProvider('gemini-3.6-flash')).not.toThrow()
  })
})
