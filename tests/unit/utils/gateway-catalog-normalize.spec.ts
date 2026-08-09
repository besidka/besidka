import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  estimateGatewayMessageCost,
  resolveGatewayPriceTier,
} from '#shared/utils/gateway-pricing'

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
    fetchCloudflareGatewayCatalog: module.fetchCloudflareGatewayCatalog,
    getCachedCloudflareGatewayCatalog:
      module.getCachedCloudflareGatewayCatalog,
    findGatewayCatalogModel: module.findGatewayCatalogModel,
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

interface CloudflareCatalogFetchMock {
  marketplace: unknown
  properties?: unknown
  propertiesStatus?: number
  propertiesThrows?: boolean
}

function mockCloudflareMarketplaceSequence(payloads: unknown[]) {
  let callIndex = 0

  const fetchMock = vi.fn(async (url: string) => {
    if (!url.includes('format=openrouter')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: [] }),
      }
    }

    const payload = payloads[callIndex] ?? payloads[payloads.length - 1]

    callIndex += 1

    return {
      ok: true,
      status: 200,
      json: async () => payload,
    }
  })

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

function countMarketplaceCalls(fetchMock: { mock: { calls: unknown[][] } }) {
  return fetchMock.mock.calls.filter(([url]) => {
    return String(url).includes('format=openrouter')
  }).length
}

function mockCloudflareCatalogFetch(responses: CloudflareCatalogFetchMock) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('format=openrouter')) {
      return {
        ok: true,
        status: 200,
        json: async () => responses.marketplace,
      }
    }

    if (responses.propertiesThrows) {
      throw new Error('network unreachable')
    }

    const status = responses.propertiesStatus ?? 200

    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => responses.properties,
    }
  })

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
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
          tags: ['reasoning', 'web-search', 'tool-use'],
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
        supportsReasoning: true,
        supportsWebSearch: 'native',
        supportsImageGeneration: false,
      },
    ])
  })

  it('reports supportsReasoning as false and supportsWebSearch as '
    + '\'universal\' when tags exist but omit the native web-search tag',
  async () => {
    mockFetchOnce({
      data: [
        {
          id: 'test-provider/tool-only-model',
          name: 'Tool Only Model',
          type: 'language',
          context_window: 32000,
          tags: ['tool-use'],
        },
      ],
    })

    const { fetchVercelGatewayCatalog } = await getFetchers()
    const models = await fetchVercelGatewayCatalog()

    expect(models[0]?.supportsReasoning).toBe(false)
    expect(models[0]?.supportsWebSearch).toBe('universal')
  })

  it('excludes the universal web-search resolution for a confirmed '
    + 'image-generation model', async () => {
    mockFetchOnce({
      data: [
        {
          id: 'openai/gpt-5-image',
          name: 'GPT-5 Image',
          type: 'language',
          context_window: 128000,
          modalities: { input: ['text'], output: ['image', 'text'] },
        },
      ],
    })

    const { fetchVercelGatewayCatalog } = await getFetchers()
    const models = await fetchVercelGatewayCatalog()

    expect(models[0]?.supportsImageGeneration).toBe(true)
    expect(models[0]?.supportsWebSearch).toBeUndefined()
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
        supportsReasoning: undefined,
        supportsWebSearch: 'universal',
        supportsImageGeneration: undefined,
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
            'reasoning',
            'web_search_options',
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
        supportsReasoning: true,
        supportsWebSearch: 'native',
        supportsImageGeneration: false,
      },
    ])
  })

  it('excludes the universal web-search resolution for a confirmed '
    + 'image-generation model', async () => {
    mockFetchOnce({
      data: [
        {
          id: 'openai/gpt-5-image',
          name: 'GPT-5 Image',
          context_length: 128000,
          architecture: {
            input_modalities: ['text'],
            output_modalities: ['image', 'text'],
          },
        },
      ],
    })

    const { fetchOpenRouterCatalog } = await getFetchers()
    const models = await fetchOpenRouterCatalog()

    expect(models[0]?.supportsImageGeneration).toBe(true)
    expect(models[0]?.supportsWebSearch).toBeUndefined()
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
      expect(models[0]?.supportsReasoning).toBe(false)
      expect(models[0]?.supportsWebSearch).toBe('universal')
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
          supportsReasoning: undefined,
          supportsWebSearch: 'universal',
          supportsImageGeneration: undefined,
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

describe('fetchCloudflareGatewayCatalog', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('normalizes a model from the OpenRouter provider/marketplace response',
    async () => {
      mockFetchOnce({
        data: [
          {
            schema_version: '2.4',
            id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
            name: 'Llama 3.3 70B Instruct FP8 Fast',
            description: 'A fast Llama 3.3 model on Workers AI.',
            input_modalities: [
              {
                type: 'text',
                supported_inputs: {
                  max_context_length: { value: 24000, unit: 'token' },
                },
                pricing: [
                  { type: 'prompt', unit: 'token', cost_usd: '0.0000002' },
                ],
              },
            ],
            output_modalities: [
              {
                type: 'text',
                max_length: { value: 4096, unit: 'token' },
                streaming: true,
                supported_parameters: {
                  tools: { type: 'boolean' },
                  tool_choice: { type: 'boolean' },
                },
                pricing: [
                  { type: 'completion', unit: 'token', cost_usd: '0.0000009' },
                ],
              },
            ],
          },
        ],
      })

      const { fetchCloudflareGatewayCatalog } = await getFetchers()
      const models = await fetchCloudflareGatewayCatalog({
        accountId: 'account-1',
        apiKey: 'cf-token',
      })

      expect(models).toEqual([
        {
          id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          name: 'Llama 3.3 70B Instruct FP8 Fast',
          description: 'A fast Llama 3.3 model on Workers AI.',
          contextLength: 24000,
          maxOutputTokens: 4096,
          pricing: { input: '0.0000002', output: '0.0000009' },
          modalities: { input: ['text'], output: ['text'] },
          supportsTools: true,
          supportsReasoning: undefined,
          supportsWebSearch: undefined,
          supportsImageGeneration: false,
        },
      ])
    })

  it('reports supportsTools as false when the text output modality omits tools',
    async () => {
      mockFetchOnce({
        data: [
          {
            id: '@cf/meta/embedding-only-model',
            name: 'Embedding Only Model',
            input_modalities: [{ type: 'text' }],
            output_modalities: [
              {
                type: 'text',
                supported_parameters: {
                  temperature: { type: 'range', min: 0, max: 1 },
                },
              },
            ],
          },
        ],
      })

      const { fetchCloudflareGatewayCatalog } = await getFetchers()
      const models = await fetchCloudflareGatewayCatalog({
        accountId: 'account-1',
        apiKey: 'cf-token',
      })

      expect(models[0]?.supportsTools).toBe(false)
      expect(models[0]?.supportsReasoning).toBeUndefined()
      expect(models[0]?.supportsWebSearch).toBeUndefined()
      expect(models[0]?.supportsImageGeneration).toBe(false)
    })

  it('reports supportsImageGeneration as true for an image-output model, '
    + 'and never resolves web search regardless', async () => {
    mockFetchOnce({
      data: [
        {
          id: '@cf/black-forest-labs/flux-1-schnell',
          name: 'FLUX.1 [schnell]',
          input_modalities: [{ type: 'text' }],
          output_modalities: [{ type: 'image' }],
        },
      ],
    })

    const { fetchCloudflareGatewayCatalog } = await getFetchers()
    const models = await fetchCloudflareGatewayCatalog({
      accountId: 'account-1',
      apiKey: 'cf-token',
    })

    expect(models[0]?.supportsImageGeneration).toBe(true)
    expect(models[0]?.supportsWebSearch).toBeUndefined()
  })

  it('handles a model missing pricing, modalities, and description',
    async () => {
      mockFetchOnce({
        data: [
          {
            id: '@cf/bare/model',
            name: 'Bare Model',
          },
        ],
      })

      const { fetchCloudflareGatewayCatalog } = await getFetchers()
      const models = await fetchCloudflareGatewayCatalog({
        accountId: 'account-1',
        apiKey: 'cf-token',
      })

      expect(models).toEqual([
        {
          id: '@cf/bare/model',
          name: 'Bare Model',
          description: undefined,
          contextLength: undefined,
          maxOutputTokens: undefined,
          pricing: undefined,
          modalities: undefined,
          supportsTools: undefined,
          supportsReasoning: undefined,
          supportsWebSearch: undefined,
          supportsImageGeneration: undefined,
        },
      ])
    })

  it('requests the account-scoped format=openrouter search endpoint with a bearer token',
    async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      })

      vi.stubGlobal('fetch', fetchMock)

      const { fetchCloudflareGatewayCatalog } = await getFetchers()

      await fetchCloudflareGatewayCatalog({
        accountId: 'account-1',
        apiKey: 'cf-token',
      })

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/account-1/ai/models/search?format=openrouter',
        { headers: { Authorization: 'Bearer cf-token' } },
      )
    })

  it('also requests the default-format catalog used for enrichment',
    async () => {
      const fetchMock = mockCloudflareCatalogFetch({
        marketplace: { data: [] },
        properties: { result: [] },
      })

      const { fetchCloudflareGatewayCatalog } = await getFetchers()

      await fetchCloudflareGatewayCatalog({
        accountId: 'account-1',
        apiKey: 'cf-token',
      })

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/account-1/ai/models/search?per_page=1000',
        { headers: { Authorization: 'Bearer cf-token' } },
      )
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

  it('throws a clean error when the upstream fetch fails', async () => {
    mockFetchOnce({}, false, 401)

    const { fetchCloudflareGatewayCatalog } = await getFetchers()

    await expect(fetchCloudflareGatewayCatalog({
      accountId: 'account-1',
      apiKey: 'bad-token',
    })).rejects.toThrow(
      'Failed to fetch Cloudflare AI Gateway model catalog',
    )
  })
})

describe('fetchCloudflareGatewayCatalog default-format enrichment', () => {
  const marketplaceCatalog = {
    data: [
      { id: '@cf/openai/gpt-oss-120b', name: 'gpt-oss-120b' },
    ],
  }

  const gptOss120bProperties = {
    id: 'f9f2250b-1048-4a52-9910-d0bf976616a1',
    name: '@cf/openai/gpt-oss-120b',
    properties: [
      { property_id: 'context_window', value: '128000' },
      {
        property_id: 'price',
        value: [
          { unit: 'per M input tokens', price: 0.35, currency: 'USD' },
          { unit: 'per M output tokens', price: 0.75, currency: 'USD' },
        ],
      },
      { property_id: 'function_calling', value: 'true' },
      { property_id: 'reasoning', value: 'true' },
    ],
  }

  const credentials = { accountId: 'account-1', apiKey: 'cf-token' }

  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('joins default-format `name` onto marketplace `id`', async () => {
    mockCloudflareCatalogFetch({
      marketplace: marketplaceCatalog,
      properties: { result: [gptOss120bProperties] },
    })

    const { fetchCloudflareGatewayCatalog } = await getFetchers()
    const models = await fetchCloudflareGatewayCatalog(credentials)

    expect(models[0]).toMatchObject({
      id: '@cf/openai/gpt-oss-120b',
      name: 'gpt-oss-120b',
      contextLength: 128000,
      pricing: { input: '3.5e-7', output: '7.5e-7' },
      supportsTools: true,
      supportsReasoning: true,
    })
    expect(models[0]?.supportsWebSearch).toBeUndefined()
  })

  it('converts per-million prices into the per-token unit the pricing helpers expect',
    async () => {
      mockCloudflareCatalogFetch({
        marketplace: marketplaceCatalog,
        properties: { result: [gptOss120bProperties] },
      })

      const { fetchCloudflareGatewayCatalog } = await getFetchers()
      const [model] = await fetchCloudflareGatewayCatalog(credentials)

      expect(Number(model?.pricing?.input)).toBeCloseTo(0.35 / 1_000_000, 12)
      expect(Number(model?.pricing?.output)).toBeCloseTo(0.75 / 1_000_000, 12)

      expect(resolveGatewayPriceTier(model!)).toBe('$')

      expect(estimateGatewayMessageCost(model!, {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      })).toBeCloseTo(1.1, 10)

      expect(estimateGatewayMessageCost(model!, {
        inputTokens: 1000,
        outputTokens: 500,
      })).toBeCloseTo(0.000725, 12)
    })

  it('resolves a price tier above the cheapest band for a pricier model',
    async () => {
      mockCloudflareCatalogFetch({
        marketplace: { data: [{ id: '@cf/qwen/qwq-32b', name: 'QwQ 32B' }] },
        properties: {
          result: [
            {
              id: 'b3c1f0a2-0000-4000-8000-0000000000aa',
              name: '@cf/qwen/qwq-32b',
              properties: [
                {
                  property_id: 'price',
                  value: [
                    { unit: 'per M input tokens', price: 0.66, currency: 'USD' },
                    { unit: 'per M output tokens', price: 1, currency: 'USD' },
                  ],
                },
              ],
            },
          ],
        },
      })

      const { fetchCloudflareGatewayCatalog } = await getFetchers()
      const [model] = await fetchCloudflareGatewayCatalog(credentials)

      expect(resolveGatewayPriceTier(model!)).toBe('$$')
    })

  it('accepts the `data` envelope as well as `result`', async () => {
    mockCloudflareCatalogFetch({
      marketplace: marketplaceCatalog,
      properties: { data: [gptOss120bProperties] },
    })

    const { fetchCloudflareGatewayCatalog } = await getFetchers()
    const [model] = await fetchCloudflareGatewayCatalog(credentials)

    expect(model?.supportsReasoning).toBe(true)
  })

  it('parses a JSON-encoded price value', async () => {
    mockCloudflareCatalogFetch({
      marketplace: marketplaceCatalog,
      properties: {
        result: [
          {
            name: '@cf/openai/gpt-oss-120b',
            properties: [
              {
                property_id: 'price',
                value: JSON.stringify([
                  { unit: 'per M input tokens', price: 0.35, currency: 'USD' },
                  { unit: 'per M output tokens', price: 0.75, currency: 'USD' },
                ]),
              },
            ],
          },
        ],
      },
    })

    const { fetchCloudflareGatewayCatalog } = await getFetchers()
    const [model] = await fetchCloudflareGatewayCatalog(credentials)

    expect(Number(model?.pricing?.input)).toBeCloseTo(0.35 / 1_000_000, 12)
  })

  it('leaves a model unenriched when nothing in the default format matches',
    async () => {
      mockCloudflareCatalogFetch({
        marketplace: marketplaceCatalog,
        properties: {
          result: [
            {
              id: 'a-uuid',
              name: '@cf/meta/some-other-model',
              properties: [{ property_id: 'reasoning', value: 'true' }],
            },
          ],
        },
      })

      const { fetchCloudflareGatewayCatalog } = await getFetchers()
      const models = await fetchCloudflareGatewayCatalog(credentials)

      expect(models).toHaveLength(1)
      expect(models[0]?.id).toBe('@cf/openai/gpt-oss-120b')
      expect(models[0]?.name).toBe('gpt-oss-120b')
      expect(models[0]?.pricing).toBeUndefined()
      expect(models[0]?.supportsReasoning).toBeUndefined()
      expect(models[0]?.supportsTools).toBeUndefined()
    })

  it('never mistakes the default-format UUID for a model id', async () => {
    mockCloudflareCatalogFetch({
      marketplace: {
        data: [{ id: 'f9f2250b-1048-4a52-9910-d0bf976616a1', name: 'Decoy' }],
      },
      properties: { result: [gptOss120bProperties] },
    })

    const { fetchCloudflareGatewayCatalog } = await getFetchers()
    const [model] = await fetchCloudflareGatewayCatalog(credentials)

    expect(model?.pricing).toBeUndefined()
    expect(model?.supportsReasoning).toBeUndefined()
  })

  it('ignores malformed property values without dropping the model',
    async () => {
      mockCloudflareCatalogFetch({
        marketplace: marketplaceCatalog,
        properties: {
          result: [
            {
              name: '@cf/openai/gpt-oss-120b',
              properties: [
                { property_id: 'context_window', value: 'not-a-number' },
                { property_id: 'price', value: 'definitely not json' },
                { property_id: 'function_calling', value: 'maybe' },
                { property_id: 'reasoning', value: null },
              ],
            },
          ],
        },
      })

      const { fetchCloudflareGatewayCatalog } = await getFetchers()
      const models = await fetchCloudflareGatewayCatalog(credentials)

      expect(models).toHaveLength(1)
      expect(models[0]?.id).toBe('@cf/openai/gpt-oss-120b')
      expect(models[0]?.contextLength).toBeUndefined()
      expect(models[0]?.pricing).toBeUndefined()
      expect(models[0]?.supportsTools).toBeUndefined()
      expect(models[0]?.supportsReasoning).toBeUndefined()
    })

  it('ignores a price entry whose unit it does not recognise', async () => {
    mockCloudflareCatalogFetch({
      marketplace: marketplaceCatalog,
      properties: {
        result: [
          {
            name: '@cf/openai/gpt-oss-120b',
            properties: [
              {
                property_id: 'price',
                value: [
                  { unit: 'per 1000 input tokens', price: 0.35 },
                  { unit: 'per 1000 output tokens', price: 0.75 },
                ],
              },
            ],
          },
        ],
      },
    })

    const { fetchCloudflareGatewayCatalog } = await getFetchers()
    const [model] = await fetchCloudflareGatewayCatalog(credentials)

    expect(model?.pricing).toBeUndefined()
  })

  it('drops half-priced models rather than reporting a partial pair',
    async () => {
      mockCloudflareCatalogFetch({
        marketplace: marketplaceCatalog,
        properties: {
          result: [
            {
              name: '@cf/openai/gpt-oss-120b',
              properties: [
                {
                  property_id: 'price',
                  value: [
                    { unit: 'per M input tokens', price: 0.35, currency: 'USD' },
                  ],
                },
              ],
            },
          ],
        },
      })

      const { fetchCloudflareGatewayCatalog } = await getFetchers()
      const [model] = await fetchCloudflareGatewayCatalog(credentials)

      expect(model?.pricing).toBeUndefined()
    })

  it('returns the unenriched catalog when the default-format fetch errors',
    async () => {
      mockCloudflareCatalogFetch({
        marketplace: marketplaceCatalog,
        propertiesStatus: 403,
      })

      const { fetchCloudflareGatewayCatalog } = await getFetchers()
      const models = await fetchCloudflareGatewayCatalog(credentials)

      expect(models).toHaveLength(1)
      expect(models[0]?.id).toBe('@cf/openai/gpt-oss-120b')
      expect(models[0]?.name).toBe('gpt-oss-120b')
      expect(models[0]?.pricing).toBeUndefined()
      expect(models[0]?.supportsReasoning).toBeUndefined()
      expect(models[0]?.supportsTools).toBeUndefined()
    })

  it('returns the unenriched catalog when the default-format fetch throws',
    async () => {
      mockCloudflareCatalogFetch({
        marketplace: marketplaceCatalog,
        propertiesThrows: true,
      })

      const { fetchCloudflareGatewayCatalog } = await getFetchers()
      const models = await fetchCloudflareGatewayCatalog(credentials)

      expect(models).toHaveLength(1)
      expect(models[0]?.id).toBe('@cf/openai/gpt-oss-120b')
    })

  it('survives a default-format response with an unexpected shape',
    async () => {
      mockCloudflareCatalogFetch({
        marketplace: marketplaceCatalog,
        properties: { result: 'not-an-array' },
      })

      const { fetchCloudflareGatewayCatalog } = await getFetchers()
      const models = await fetchCloudflareGatewayCatalog(credentials)

      expect(models).toHaveLength(1)
      expect(models[0]?.pricing).toBeUndefined()
    })

  it('never overwrites a value the marketplace response already provided',
    async () => {
      mockCloudflareCatalogFetch({
        marketplace: {
          data: [
            {
              id: '@cf/openai/gpt-oss-120b',
              name: 'gpt-oss-120b',
              input_modalities: [
                {
                  type: 'text',
                  supported_inputs: {
                    max_context_length: { value: 4096, unit: 'token' },
                  },
                  pricing: [
                    { type: 'prompt', unit: 'token', cost_usd: '0.000001' },
                  ],
                },
              ],
              output_modalities: [
                {
                  type: 'text',
                  pricing: [
                    {
                      type: 'completion',
                      unit: 'token',
                      cost_usd: '0.000002',
                    },
                  ],
                },
              ],
            },
          ],
        },
        properties: { result: [gptOss120bProperties] },
      })

      const { fetchCloudflareGatewayCatalog } = await getFetchers()
      const [model] = await fetchCloudflareGatewayCatalog(credentials)

      expect(model?.contextLength).toBe(4096)
      expect(model?.pricing).toEqual({
        input: '0.000001',
        output: '0.000002',
      })
      expect(model?.supportsReasoning).toBe(true)
    })

  it('reports enrichment coverage to the logger', async () => {
    mockCloudflareCatalogFetch({
      marketplace: marketplaceCatalog,
      properties: { result: [gptOss120bProperties] },
    })

    const set = vi.fn()
    const { fetchCloudflareGatewayCatalog } = await getFetchers()

    await fetchCloudflareGatewayCatalog(credentials, { logger: { set } })

    expect(set).toHaveBeenCalledWith({
      gatewayCatalogEnrichment: {
        gateway: 'cloudflare',
        models: 1,
        matched: 1,
        priced: 1,
      },
    })
  })

  it('logs why enrichment degraded when the default-format fetch fails',
    async () => {
      mockCloudflareCatalogFetch({
        marketplace: marketplaceCatalog,
        propertiesStatus: 403,
      })

      const set = vi.fn()
      const { fetchCloudflareGatewayCatalog } = await getFetchers()

      await fetchCloudflareGatewayCatalog(credentials, { logger: { set } })

      expect(set).toHaveBeenCalledWith({
        attributes: {
          gatewayCatalogEnrichment: {
            gateway: 'cloudflare',
            error: 'Cloudflare returned HTTP 403',
          },
        },
      })
    })
})

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

describe('getCachedCloudflareGatewayCatalog', () => {
  function createFakeCache() {
    const store = new Map<string, unknown>()

    return {
      async getItem(key: string) {
        return store.get(key) ?? null
      },
      async setItem(key: string, value: unknown) {
        store.set(key, value)
      },
    }
  }

  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('scopes the cache key per account, so two accounts never share a catalog',
    async () => {
      const cache = createFakeCache()
      const fetchMock = mockCloudflareMarketplaceSequence([
        { data: [{ id: 'model-a', name: 'Model A' }] },
        { data: [{ id: 'model-b', name: 'Model B' }] },
      ])

      vi.stubGlobal('useStorage', () => cache)

      const { getCachedCloudflareGatewayCatalog } = await getFetchers()

      const accountOneModels = await getCachedCloudflareGatewayCatalog({
        accountId: 'account-1',
        apiKey: 'token-1',
      })
      const accountTwoModels = await getCachedCloudflareGatewayCatalog({
        accountId: 'account-2',
        apiKey: 'token-2',
      })

      expect(accountOneModels[0]?.id).toBe('model-a')
      expect(accountTwoModels[0]?.id).toBe('model-b')
      expect(countMarketplaceCalls(fetchMock)).toBe(2)
    })

  it('scopes the cache key per apiKey, so a guessed accountId with a different key never shares a catalog',
    async () => {
      const cache = createFakeCache()
      const fetchMock = mockCloudflareMarketplaceSequence([
        { data: [{ id: 'model-a', name: 'Model A' }] },
        { data: [{ id: 'model-b', name: 'Model B' }] },
      ])

      vi.stubGlobal('useStorage', () => cache)

      const { getCachedCloudflareGatewayCatalog } = await getFetchers()

      const genuineOwnerModels = await getCachedCloudflareGatewayCatalog({
        accountId: 'account-1',
        apiKey: 'genuine-owner-token',
      })
      const guessedAccountModels = await getCachedCloudflareGatewayCatalog({
        accountId: 'account-1',
        apiKey: 'attacker-fake-token',
      })

      expect(genuineOwnerModels[0]?.id).toBe('model-a')
      expect(guessedAccountModels[0]?.id).toBe('model-b')
      expect(countMarketplaceCalls(fetchMock)).toBe(2)
    })

  it('serves the second request for the same account from cache', async () => {
    const cache = createFakeCache()
    const fetchMock = mockCloudflareMarketplaceSequence([
      { data: [{ id: 'model-a', name: 'Model A' }] },
    ])

    vi.stubGlobal('useStorage', () => cache)

    const { getCachedCloudflareGatewayCatalog } = await getFetchers()

    const credentials = { accountId: 'account-1', apiKey: 'token-1' }

    const first = await getCachedCloudflareGatewayCatalog(credentials)
    const second = await getCachedCloudflareGatewayCatalog(credentials)

    expect(first).toEqual(second)
    expect(countMarketplaceCalls(fetchMock)).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('serves a stale per-account cache entry when the upstream fetch fails',
    async () => {
      const cache = createFakeCache()
      const staleModels = [{ id: 'model-a-stale', name: 'Model A (stale)' }]
      const apiKeyHash = await sha256Hex('token-1')

      await cache.setItem(
        `gateway-catalog:v2:cloudflare:account-1:${apiKeyHash}`,
        {
          models: staleModels,
          cachedAt: Date.now() - (60 * 60 * 1000),
        },
      )

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service unavailable',
      })
      const loggerSet = vi.fn()

      vi.stubGlobal('fetch', fetchMock)
      vi.stubGlobal('useStorage', () => cache)

      const { getCachedCloudflareGatewayCatalog } = await getFetchers()

      const models = await getCachedCloudflareGatewayCatalog(
        { accountId: 'account-1', apiKey: 'token-1' },
        { logger: { set: loggerSet } },
      )

      expect(models).toEqual(staleModels)
      expect(loggerSet).toHaveBeenCalledWith(
        expect.objectContaining({
          gatewayCatalogFetch: {
            gateway: 'cloudflare',
            servedStale: true,
          },
        }),
      )
    })
})

describe('findGatewayCatalogModel', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('returns the matching model from the fetched catalog', async () => {
    const { findGatewayCatalogModel } = await getFetchers()
    const models = [
      { id: 'model-a', name: 'Model A' },
      { id: 'model-b', name: 'Model B' },
    ]

    const found = await findGatewayCatalogModel(
      async () => models,
      'model-b',
    )

    expect(found).toEqual({ id: 'model-b', name: 'Model B' })
  })

  it('returns undefined when no model in the catalog matches the id',
    async () => {
      const { findGatewayCatalogModel } = await getFetchers()

      const found = await findGatewayCatalogModel(
        async () => [{ id: 'model-a', name: 'Model A' }],
        'model-missing',
      )

      expect(found).toBeUndefined()
    })

  it('returns undefined instead of throwing when the catalog fetch fails',
    async () => {
      const { findGatewayCatalogModel } = await getFetchers()

      const found = await findGatewayCatalogModel(
        async () => {
          throw new Error('upstream unavailable')
        },
        'model-a',
      )

      expect(found).toBeUndefined()
    })
})
