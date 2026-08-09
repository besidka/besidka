import { beforeEach, describe, expect, it, vi } from 'vitest'

function stubKeyLookup(apiKey: string | null = 'encrypted-key') {
  vi.stubGlobal('useDb', () => ({
    query: {
      keys: {
        findFirst: vi.fn(async () => (apiKey ? { apiKey } : undefined)),
      },
    },
  }))
  vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
}

function stubVercelCatalog(models: unknown[]) {
  vi.stubGlobal('useStorage', () => ({
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
  }))
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: models }),
  })))
}

async function importVercelGatewayModule() {
  return await import('../../../../server/utils/gateways/vercel')
}

describe('useVercelGateway', () => {
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

  it('throws a 401-style error when no key is stored', async () => {
    stubKeyLookup(null)

    const { useVercelGateway } = await importVercelGatewayModule()

    await expect(useVercelGateway('1', 'openai/gpt-4o', [], 'off'))
      .rejects.toMatchObject({
        statusCode: 401,
        statusMessage: 'Vercel AI Gateway API key not found. Please set it up in the settings.',
      })
  })

  it('builds an instance and exposes the raw gateway client', async () => {
    stubKeyLookup()

    const { useVercelGateway } = await importVercelGatewayModule()
    const result = await useVercelGateway('1', 'openai/gpt-4o', [], 'off')

    expect(result.tools).toEqual({})
    expect(result.providerOptions).toEqual({})
    expect(typeof result.generateChatTitle).toBe('function')
    expect(typeof result.client?.getGenerationInfo).toBe('function')
    expect(result.reasoning).toBeUndefined()

    const instance = result.instance as unknown as { modelId: string }

    expect(instance.modelId).toBe('openai/gpt-4o')
  })

  it('caps maxOutputTokens from the model\'s own catalog entry', async () => {
    stubKeyLookup()
    stubVercelCatalog([
      {
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        type: 'language',
        max_tokens: 4096,
      },
    ])

    const { useVercelGateway } = await importVercelGatewayModule()
    const result = await useVercelGateway('1', 'openai/gpt-4o', [], 'off')

    expect(result.maxOutputTokens).toBe(4096)
  })

  it('leaves maxOutputTokens undefined when the model is not in the '
    + 'catalog', async () => {
    stubKeyLookup()
    stubVercelCatalog([])

    const { useVercelGateway } = await importVercelGatewayModule()
    const result = await useVercelGateway('1', 'openai/gpt-4o', [], 'off')

    expect(result.maxOutputTokens).toBeUndefined()
  })

  it('passes the catalog maxOutputTokens through to generateChatTitle',
    async () => {
      stubKeyLookup()
      stubVercelCatalog([
        {
          id: 'openai/gpt-4o',
          name: 'GPT-4o',
          type: 'language',
          max_tokens: 4096,
        },
      ])

      const useChatTitleMock = vi.fn(async () => 'A title')

      vi.stubGlobal('useChatTitle', useChatTitleMock)

      const { useVercelGateway } = await importVercelGatewayModule()
      const result = await useVercelGateway('1', 'openai/gpt-4o', [], 'off')

      await result.generateChatTitle('Plan a trip to Kyoto')

      expect(useChatTitleMock).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'openai/gpt-4o' }),
        'Plan a trip to Kyoto',
        4096,
      )
    })

  describe('web search requested', () => {
    it('attaches the gateway-executed perplexity search tool, no '
      + 'toolChoice', async () => {
      stubKeyLookup()

      const { useVercelGateway } = await importVercelGatewayModule()
      const result = await useVercelGateway(
        '1',
        'openai/gpt-4o',
        ['web_search'],
        'off',
      )

      expect(result.tools.toolChoice).toBeUndefined()
      expect(result.tools.tools?.web_search).toMatchObject({
        type: 'provider',
        isProviderExecuted: true,
        id: 'gateway.perplexity_search',
      })
    })

    it('leaves tools empty when web search was not requested', async () => {
      stubKeyLookup()

      const { useVercelGateway } = await importVercelGatewayModule()
      const result = await useVercelGateway(
        '1',
        'openai/gpt-4o',
        ['image_generation'],
        'off',
      )

      expect(result.tools).toEqual({})
    })
  })

  describe('image generation requested', () => {
    it('needs no special request configuration at all — Gemini *-image '
      + 'models return image content parts from a plain instance built the '
      + 'same way as any other model', async () => {
      stubKeyLookup()

      const { useVercelGateway } = await importVercelGatewayModule()
      const result = await useVercelGateway(
        '1',
        'google/gemini-3.1-flash-image-preview',
        ['image_generation'],
        'off',
      )

      expect(result.tools).toEqual({})
      expect(result.providerOptions).toEqual({})

      const instance = result.instance as unknown as { modelId: string }

      expect(instance.modelId).toBe('google/gemini-3.1-flash-image-preview')
    })
  })

  describe('reasoning requested', () => {
    it('returns the mapped reasoning effort for the top-level streamText '
      + 'option, with no per-provider providerOptions needed', async () => {
      stubKeyLookup()

      const { useVercelGateway } = await importVercelGatewayModule()
      const result = await useVercelGateway(
        '1',
        'anthropic/claude-opus-5',
        [],
        'medium',
      )

      expect(result.reasoning).toBe('medium')
      expect(result.providerOptions).toEqual({})
    })

    it('returns undefined for an off request', async () => {
      stubKeyLookup()

      const { useVercelGateway } = await importVercelGatewayModule()
      const result = await useVercelGateway(
        '1',
        'anthropic/claude-opus-5',
        [],
        'off',
      )

      expect(result.reasoning).toBeUndefined()
    })
  })
})

describe('persistVercelGenerationCost', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  function createLogger() {
    return { set: vi.fn() }
  }

  it('merges the reported cost into the existing usage row', async () => {
    const updateWhere = vi.fn(async () => undefined)
    const updateSet = vi.fn(() => ({ where: updateWhere }))
    const db = {
      query: {
        messages: {
          findFirst: vi.fn(async () => ({
            usage: {
              model: 'openai/gpt-4o',
              provider: 'vercel-gateway',
              inputTokens: 10,
              outputTokens: 20,
              totalTokens: 30,
            },
          })),
        },
      },
      update: vi.fn(() => ({ set: updateSet })),
    }

    const client = {
      getGenerationInfo: vi.fn(async () => ({ totalCost: 0.0123 })),
    }
    const logger = createLogger()

    const { persistVercelGenerationCost } = await importVercelGatewayModule()

    await persistVercelGenerationCost({
      db: db as any,
      client: client as any,
      generationId: 'gen_123',
      publicId: 'assistant-public-1',
      logger,
    })

    expect(client.getGenerationInfo).toHaveBeenCalledWith({ id: 'gen_123' })
    expect(updateSet).toHaveBeenCalledWith({
      usage: expect.objectContaining({
        totalCost: 0.0123,
        inputTokens: 10,
        outputTokens: 20,
      }),
    })
    expect(logger.set).not.toHaveBeenCalled()
  })

  it('retries once when the generation record is not immediately available', async () => {
    vi.useFakeTimers()

    const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }))
    const db = {
      query: {
        messages: {
          findFirst: vi.fn(async () => ({
            usage: {
              model: 'x', provider: 'x', inputTokens: 0, outputTokens: 0, totalTokens: 0,
            },
          })),
        },
      },
      update: vi.fn(() => ({ set: updateSet })),
    }

    const client = {
      getGenerationInfo: vi.fn()
        .mockRejectedValueOnce(new Error('not found yet'))
        .mockResolvedValueOnce({ totalCost: 0.05 }),
    }
    const logger = createLogger()

    const { persistVercelGenerationCost } = await importVercelGatewayModule()

    const pending = persistVercelGenerationCost({
      db: db as any,
      client: client as any,
      generationId: 'gen_456',
      publicId: 'assistant-public-2',
      logger,
    })

    await vi.runAllTimersAsync()
    await pending

    expect(client.getGenerationInfo).toHaveBeenCalledTimes(2)
    expect(updateSet).toHaveBeenCalledWith({
      usage: expect.objectContaining({ totalCost: 0.05 }),
    })

    vi.useRealTimers()
  })

  it('logs a non-fatal error instead of throwing when both attempts fail', async () => {
    const db = {
      query: { messages: { findFirst: vi.fn() } },
      update: vi.fn(),
    }

    vi.useFakeTimers()

    const client = {
      getGenerationInfo: vi.fn().mockRejectedValue(new Error('gone')),
    }
    const logger = createLogger()

    const { persistVercelGenerationCost } = await importVercelGatewayModule()

    const pending = persistVercelGenerationCost({
      db: db as any,
      client: client as any,
      generationId: 'gen_789',
      publicId: 'assistant-public-3',
      logger,
    })

    await vi.runAllTimersAsync()
    await expect(pending).resolves.toBeUndefined()

    expect(db.query.messages.findFirst).not.toHaveBeenCalled()
    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      attributes: {
        vercelGenerationCost: {
          error: 'gone',
        },
      },
    }))

    vi.useRealTimers()
  })

  it('no-ops when the message row has no usage to merge into', async () => {
    const updateSet = vi.fn()
    const db = {
      query: {
        messages: {
          findFirst: vi.fn(async () => ({ usage: null })),
        },
      },
      update: vi.fn(() => ({ set: updateSet })),
    }

    const client = {
      getGenerationInfo: vi.fn(async () => ({ totalCost: 0.01 })),
    }
    const logger = createLogger()

    const { persistVercelGenerationCost } = await importVercelGatewayModule()

    await persistVercelGenerationCost({
      db: db as any,
      client: client as any,
      generationId: 'gen_000',
      publicId: 'assistant-public-4',
      logger,
    })

    expect(updateSet).not.toHaveBeenCalled()
  })
})
