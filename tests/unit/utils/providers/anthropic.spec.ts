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
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    description: 'General-purpose Anthropic model',
    contextLength: 1_000_000,
    maxOutputTokens: 64_000,
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
    toolCall: true,
    reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
    ...overrides,
  }
}

function createProvider(models: Model[]): Provider {
  return {
    id: 'anthropic',
    name: 'Anthropic',
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

async function importUseAnthropic() {
  const { useAnthropic } = await import(
    '../../../../server/utils/providers/anthropic'
  )

  return useAnthropic
}

describe('useAnthropic web search tool choice', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
  })

  it.each(['off', 'low', 'high'] as const)(
    'registers web search without forcing tool choice at reasoning %s',
    async (level) => {
      stubModel(createModel())

      const useAnthropic = await importUseAnthropic()
      const result = await useAnthropic(
        '1',
        'claude-sonnet-5-5',
        ['web_search'],
        level,
      )

      expect(result.tools.tools).toHaveProperty('web_search_preview')
      expect(result.tools.toolChoice).toBeUndefined()
    },
  )

  it('returns no tools when web search is not requested', async () => {
    stubModel(createModel())

    const useAnthropic = await importUseAnthropic()
    const result = await useAnthropic('1', 'claude-sonnet-5-5', [], 'off')

    expect(result.tools).toEqual({})
  })
})

describe('useAnthropic provider options', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
  })

  it.each(['off', 'high'] as const)(
    'enables automatic prompt caching at reasoning %s',
    async (level) => {
      stubModel(createModel())

      const useAnthropic = await importUseAnthropic()
      const result = await useAnthropic(
        '1',
        'claude-sonnet-5-5',
        [],
        level,
      )

      expect(result.providerOptions).toEqual({
        cacheControl: { type: 'ephemeral' },
      })
    },
  )

  it('never writes thinking or effort, which the SDK derives itself', async () => {
    stubModel(createModel())

    const useAnthropic = await importUseAnthropic()
    const result = await useAnthropic(
      '1',
      'claude-sonnet-5-5',
      ['web_search'],
      'high',
    )

    expect(result.providerOptions).not.toHaveProperty('thinking')
    expect(result.providerOptions).not.toHaveProperty('effort')
  })

  it('keeps the default five minute cache lifetime', async () => {
    stubModel(createModel())

    const useAnthropic = await importUseAnthropic()
    const result = await useAnthropic('1', 'claude-sonnet-5-5', [], 'off')

    expect(result.providerOptions.cacheControl).not.toHaveProperty('ttl')
  })
})
