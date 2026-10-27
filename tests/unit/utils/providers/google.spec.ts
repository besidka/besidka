import type { Model, Provider } from '#shared/types/providers.d'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { ToolSet } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { streamText } from 'ai'
import {
  MockLanguageModelV4,
  convertArrayToReadableStream,
} from 'ai/test'

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
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    description: 'Fast Google model',
    contextLength: 1_048_576,
    maxOutputTokens: 65_536,
    price: {
      tokens: 1_000_000,
      input: '0.10',
      output: '0.40',
    },
    priceTier: '$',
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
    id: 'google',
    name: 'Google',
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

async function importUseGoogle() {
  const { useGoogle } = await import('../../../../server/utils/providers/google')

  return useGoogle
}

function createGroundedAnswerModel() {
  const streamParts: LanguageModelV4StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: 'EUR/PLN is 4.25.' },
    { type: 'text-end', id: 'text-1' },
    {
      type: 'source',
      sourceType: 'url',
      id: 'source-1',
      url: 'https://example.com/eur-pln',
    },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'STOP' },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      },
    },
  ]

  return new MockLanguageModelV4({
    doStream: async () => {
      return { stream: convertArrayToReadableStream(streamParts) }
    },
  })
}

async function collectStreamPartTypes(options: {
  tools: ToolSet
  toolChoice?: { type: 'tool', toolName: string }
}): Promise<string[]> {
  const result = streamText({
    model: createGroundedAnswerModel(),
    messages: [{ role: 'user', content: 'Current EUR to PLN rate?' }],
    tools: options.tools,
    ...(options.toolChoice ? { toolChoice: options.toolChoice } : {}),
  })
  const partTypes: string[] = []

  for await (const part of result.fullStream) {
    partTypes.push(part.type === 'error'
      ? `error:${(part.error as Error).name}`
      : part.type)
  }

  return partTypes
}

describe('useGoogle web search tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubKeyLookup()
    stubModel(createModel())
  })

  it('registers Google grounding as an exclusive native search tool '
    + 'without a forced tool choice', async () => {
    const useGoogle = await importUseGoogle()
    const result = await useGoogle(
      '1',
      'gemini-2.5-flash-lite',
      ['web_search'],
      'high',
    )

    expect(Object.keys(result.tools.tools ?? {})).toEqual([
      'web_search_preview',
    ])
    expect(result.tools.toolChoice).toBeUndefined()
    expect(result.tools.exclusiveNativeWebSearch).toBe(true)
  })

  it('registers no tools when web search was not requested', async () => {
    const useGoogle = await importUseGoogle()
    const result = await useGoogle('1', 'gemini-2.5-flash-lite', [], 'off')

    expect(result.tools).toEqual({})
  })

  it('streams a grounded answer without a tool choice violation, which a '
    + 'forced web_search_preview choice would raise', async () => {
    const useGoogle = await importUseGoogle()
    const { tools } = await useGoogle(
      '1',
      'gemini-2.5-flash-lite',
      ['web_search'],
      'high',
    )
    const groundedTools = tools.tools as ToolSet

    const partTypes = await collectStreamPartTypes({
      tools: groundedTools,
      ...(tools.toolChoice ? { toolChoice: tools.toolChoice } : {}),
    })
    const forcedPartTypes = await collectStreamPartTypes({
      tools: groundedTools,
      toolChoice: { type: 'tool', toolName: 'web_search_preview' },
    })

    expect(partTypes).toEqual(expect.arrayContaining([
      'text-delta',
      'source',
      'finish',
    ]))
    expect(partTypes.some(type => type.startsWith('error'))).toBe(false)
    expect(forcedPartTypes).toContain('error:AI_ToolChoiceViolationError')
  })
})
