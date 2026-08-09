import type { Model, Provider } from '#shared/types/providers.d'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getModel: vi.fn(),
  getControllerModelId: vi.fn((model: Model) => model.id),
  getMoonshotWebSearchTools: vi.fn(),
}))

vi.mock('#shared/utils/model', () => ({
  getModel: mocks.getModel,
  getControllerModelId: mocks.getControllerModelId,
}))

vi.mock('../../../../server/utils/providers/moonshotai-web-search', () => ({
  getMoonshotWebSearchTools: mocks.getMoonshotWebSearchTools,
}))

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6',
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

describe('useMoonshotAi reasoning wiring for kimi-k2.6', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
  })

  it('enables thinking and never sets the top-level reasoning option', async () => {
    stubModel(createModel({
      id: 'kimi-k2.6',
      reasoning: { mode: 'toggle' },
    }))

    const useMoonshotAi = await importUseMoonshotAi()
    const result = await useMoonshotAi('1', 'kimi-k2.6', [], 'medium')

    expect(result.providerOptions).toEqual({
      thinking: { type: 'enabled' },
    })
    expect(result.reasoning).toBeUndefined()
  })

  it('disables thinking and never sets the top-level reasoning option', async () => {
    stubModel(createModel({
      id: 'kimi-k2.6',
      reasoning: { mode: 'toggle' },
    }))

    const useMoonshotAi = await importUseMoonshotAi()
    const result = await useMoonshotAi('1', 'kimi-k2.6', [], 'off')

    expect(result.providerOptions).toEqual({
      thinking: { type: 'disabled' },
    })
    expect(result.reasoning).toBeUndefined()
  })
})

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

  it('sends no reasoning field even when reasoningAlwaysOn is set, since '
    + 'the flag only drives the picker UI, not provider wiring', async () => {
    stubModel(createModel({ id: 'kimi-k3', reasoningAlwaysOn: true }))

    const useMoonshotAi = await importUseMoonshotAi()
    const result = await useMoonshotAi('1', 'kimi-k3', [], 'medium')

    expect(result.providerOptions).toEqual({})
    expect(result.reasoning).toBeUndefined()
  })
})

describe('useMoonshotAi web search wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
  })

  it('exposes no tools when web search is not requested', async () => {
    stubModel(createModel({ id: 'kimi-k2.6', tools: ['web_search'] }))

    const useMoonshotAi = await importUseMoonshotAi()
    const result = await useMoonshotAi('1', 'kimi-k2.6', [], 'off')

    expect(result.tools).toEqual({})
    expect(mocks.getMoonshotWebSearchTools).not.toHaveBeenCalled()
  })

  it('builds the Formula-API search tool with the user\'s decrypted key '
    + 'when web search is requested', async () => {
    stubModel(createModel({ id: 'kimi-k2.6', tools: ['web_search'] }))
    mocks.getMoonshotWebSearchTools.mockResolvedValue({
      tools: { web_search: { description: 'stub tool' } },
    })

    const useMoonshotAi = await importUseMoonshotAi()
    const result = await useMoonshotAi(
      '1',
      'kimi-k2.6',
      ['web_search'],
      'off',
    )

    expect(mocks.getMoonshotWebSearchTools).toHaveBeenCalledWith(
      'decrypted-key',
    )
    expect(result.tools).toEqual({
      tools: { web_search: { description: 'stub tool' } },
    })
  })

  it('builds the Formula-API search tool for kimi-k3 too', async () => {
    stubModel(createModel({ id: 'kimi-k3', tools: ['web_search'] }))
    mocks.getMoonshotWebSearchTools.mockResolvedValue({
      tools: { web_search: { description: 'stub tool' } },
    })

    const useMoonshotAi = await importUseMoonshotAi()
    const result = await useMoonshotAi(
      '1',
      'kimi-k3',
      ['web_search'],
      'off',
    )

    expect(mocks.getMoonshotWebSearchTools).toHaveBeenCalledWith(
      'decrypted-key',
    )
    expect(result.tools).toEqual({
      tools: { web_search: { description: 'stub tool' } },
    })
  })
})
