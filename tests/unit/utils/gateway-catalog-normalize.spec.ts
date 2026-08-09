import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('evlog', () => ({
  createError: (input: { message: string, status?: number }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
}))

async function getFetchers() {
  const module = await import('../../../server/utils/gateways/catalog')

  return {
    fetchVercelGatewayCatalog: module.fetchVercelGatewayCatalog,
    fetchOpenRouterCatalog: module.fetchOpenRouterCatalog,
  }
}

function mockFetchOnce(payload: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }))
}

describe('fetchVercelGatewayCatalog', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('normalizes a full language model', async () => {
    mockFetchOnce({
      data: [
        {
          id: 'openai/gpt-4o',
          name: 'GPT-4o',
          description: 'GPT-4o from OpenAI.',
          context_window: 128000,
          max_tokens: 16384,
          type: 'language',
          modalities: {
            input: ['text', 'image', 'pdf'],
            output: ['text'],
          },
          supported_parameters: [
            'max_tokens',
            'temperature',
            'stop',
            'tools',
            'tool_choice',
          ],
          pricing: {
            input: '0.0000025',
            output: '0.00001',
            input_cache_read: '0.00000125',
            web_search: '10',
          },
        },
      ],
    })

    const { fetchVercelGatewayCatalog } = await getFetchers()
    const models = await fetchVercelGatewayCatalog()

    expect(models).toEqual([
      {
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        description: 'GPT-4o from OpenAI.',
        contextLength: 128000,
        maxOutputTokens: 16384,
        pricing: { input: '0.0000025', output: '0.00001' },
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        supportsTools: true,
      },
    ])
  })

  it('excludes non-language models from the catalog', async () => {
    mockFetchOnce({
      data: [
        {
          id: 'openai/gpt-4o',
          name: 'GPT-4o',
          type: 'language',
          context_window: 128000,
        },
        {
          id: 'openai/text-embedding-3-small',
          name: 'Text Embedding 3 Small',
          type: 'embedding',
        },
      ],
    })

    const { fetchVercelGatewayCatalog } = await getFetchers()
    const models = await fetchVercelGatewayCatalog()

    expect(models).toHaveLength(1)
    expect(models[0]?.id).toBe('openai/gpt-4o')
  })

  it('handles a model missing pricing and modalities', async () => {
    mockFetchOnce({
      data: [
        {
          id: 'test-provider/bare-model',
          name: 'Bare Model',
          type: 'language',
          context_window: 32000,
        },
      ],
    })

    const { fetchVercelGatewayCatalog } = await getFetchers()
    const models = await fetchVercelGatewayCatalog()

    expect(models).toEqual([
      {
        id: 'test-provider/bare-model',
        name: 'Bare Model',
        description: undefined,
        contextLength: 32000,
        maxOutputTokens: undefined,
        pricing: undefined,
        modalities: undefined,
        supportsTools: undefined,
      },
    ])
  })

  it('throws a clean error when the upstream fetch fails', async () => {
    mockFetchOnce({}, false, 502)

    const { fetchVercelGatewayCatalog } = await getFetchers()

    await expect(fetchVercelGatewayCatalog()).rejects.toThrow(
      'Failed to fetch Vercel AI Gateway model catalog',
    )
  })
})

describe('fetchOpenRouterCatalog', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('normalizes a full model with tool support', async () => {
    mockFetchOnce({
      data: [
        {
          id: 'openai/gpt-4o-2024-11-20',
          name: 'OpenAI: GPT-4o (2024-11-20)',
          description: 'The 2024-11-20 version of GPT-4o.',
          context_length: 128000,
          architecture: {
            modality: 'text+image+file->text',
            input_modalities: ['text', 'image', 'file'],
            output_modalities: ['text'],
          },
          pricing: {
            prompt: '0.0000025',
            completion: '0.00001',
            input_cache_read: '0.00000125',
          },
          top_provider: {
            context_length: 128000,
            max_completion_tokens: 16384,
            is_moderated: true,
          },
          supported_parameters: [
            'frequency_penalty',
            'tool_choice',
            'tools',
            'top_p',
          ],
        },
      ],
    })

    const { fetchOpenRouterCatalog } = await getFetchers()
    const models = await fetchOpenRouterCatalog()

    expect(models).toEqual([
      {
        id: 'openai/gpt-4o-2024-11-20',
        name: 'OpenAI: GPT-4o (2024-11-20)',
        description: 'The 2024-11-20 version of GPT-4o.',
        contextLength: 128000,
        maxOutputTokens: 16384,
        pricing: { input: '0.0000025', output: '0.00001' },
        modalities: {
          input: ['text', 'image', 'file'],
          output: ['text'],
        },
        supportsTools: true,
      },
    ])
  })

  it('preserves free-tier ids and zero pricing', async () => {
    mockFetchOnce({
      data: [
        {
          id: 'inclusionai/ling-3.0-tiny:free',
          name: 'inclusionAI: Ling 3.0 Tiny (free)',
          description: 'A mixture-of-experts model from InclusionAI.',
          context_length: 262144,
          architecture: {
            input_modalities: ['text'],
            output_modalities: ['text'],
          },
          pricing: { prompt: '0', completion: '0' },
          top_provider: {
            context_length: 262144,
            max_completion_tokens: 32768,
            is_moderated: false,
          },
          supported_parameters: ['tools', 'reasoning'],
        },
      ],
    })

    const { fetchOpenRouterCatalog } = await getFetchers()
    const models = await fetchOpenRouterCatalog()

    expect(models[0]?.id).toBe('inclusionai/ling-3.0-tiny:free')
    expect(models[0]?.pricing).toEqual({ input: '0', output: '0' })
  })

  it('falls back to undefined maxOutputTokens when top_provider caps it null',
    async () => {
      mockFetchOnce({
        data: [
          {
            id: 'meta/muse-spark-1.2',
            name: 'Meta: Muse Spark 1.2',
            context_length: 1048576,
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            pricing: { prompt: '0.000001', completion: '0.000002' },
            top_provider: {
              context_length: 1048576,
              max_completion_tokens: null,
              is_moderated: true,
            },
            supported_parameters: ['max_tokens'],
          },
        ],
      })

      const { fetchOpenRouterCatalog } = await getFetchers()
      const models = await fetchOpenRouterCatalog()

      expect(models[0]?.maxOutputTokens).toBeUndefined()
      expect(models[0]?.supportsTools).toBe(false)
    })

  it('handles a model missing pricing, architecture, and top_provider',
    async () => {
      mockFetchOnce({
        data: [
          {
            id: 'test-author/bare-model',
            name: 'Bare Model',
            context_length: 8192,
          },
        ],
      })

      const { fetchOpenRouterCatalog } = await getFetchers()
      const models = await fetchOpenRouterCatalog()

      expect(models).toEqual([
        {
          id: 'test-author/bare-model',
          name: 'Bare Model',
          description: undefined,
          contextLength: 8192,
          maxOutputTokens: undefined,
          pricing: undefined,
          modalities: undefined,
          supportsTools: undefined,
        },
      ])
    })

  it('throws a clean error when the upstream fetch fails', async () => {
    mockFetchOnce({}, false, 500)

    const { fetchOpenRouterCatalog } = await getFetchers()

    await expect(fetchOpenRouterCatalog()).rejects.toThrow(
      'Failed to fetch OpenRouter model catalog',
    )
  })
})
