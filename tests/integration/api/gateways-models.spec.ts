import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
}))

vi.mock('evlog', () => ({
  createError: (input: {
    message: string
    status?: number
    why?: string
    fix?: string
  }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
  useLogger: () => ({ set: mocks.loggerSet }),
}))

function createFakeKv() {
  const store = new Map<string, string>()

  return {
    async get(key: string) {
      return store.get(key) ?? null
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
  }
}

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

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/gateways/[gateway]/models.get'
  )

  return module.default
}

const vercelCatalogPayload = {
  data: [
    {
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      type: 'language',
      context_window: 128000,
      max_tokens: 16384,
      supported_parameters: ['tools'],
      pricing: { input: '0.0000025', output: '0.00001' },
      modalities: { input: ['text'], output: ['text'] },
    },
  ],
}

describe('gateway models API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()

    const fakeKv = createFakeKv()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('setResponseHeader', vi.fn())
    vi.stubGlobal('useKV', () => fakeKv)
    vi.stubGlobal('useStorage', () => createFakeCache())
    vi.stubGlobal('getValidatedRouterParams', async (
      event: { params: unknown },
      parser: (params: unknown) => unknown,
    ) => parser(event.params))
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('useUnauthorizedError', vi.fn(() => {
      throw new Error('Unauthorized')
    }))
  })

  it('rejects unauthenticated requests', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const handler = await getHandler()

    await expect(handler({
      params: { gateway: 'vercel' },
    } as never)).rejects.toThrow('Unauthorized')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid gateway param', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const handler = await getHandler()

    await expect(handler({
      params: { gateway: 'not-a-gateway' },
    } as never)).rejects.toThrow('Invalid request parameters')
  })

  it('rejects a cloudflare request when no credentials are stored', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.doMock('~~/server/utils/gateways/cloudflare', () => ({
      getCloudflareGatewayCredentials: vi.fn(async () => undefined),
    }))

    const handler = await getHandler()

    await expect(handler({
      params: { gateway: 'cloudflare' },
    } as never)).rejects.toMatchObject({
      message: 'Cloudflare AI Gateway credentials not found',
      status: 401,
    })
  })

  it('returns a normalized cloudflare catalog fetched with the account\'s own token',
    async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{
            schema_version: '2.4',
            id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
            name: 'Llama 3.3 70B Instruct FP8 Fast',
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
                supported_parameters: {
                  tools: { type: 'boolean' },
                },
                pricing: [
                  { type: 'completion', unit: 'token', cost_usd: '0.0000009' },
                ],
              },
            ],
          }],
        }),
      })

      vi.stubGlobal('fetch', fetchMock)
      vi.doMock('~~/server/utils/gateways/cloudflare', () => ({
        getCloudflareGatewayCredentials: vi.fn(async () => ({
          accountId: 'account-1',
          apiKey: 'cf-token',
        })),
      }))

      const handler = await getHandler()

      const response = await handler({
        params: { gateway: 'cloudflare' },
      } as never)

      expect(response).toEqual({
        gateway: 'cloudflare',
        models: [{
          id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          name: 'Llama 3.3 70B Instruct FP8 Fast',
          description: undefined,
          contextLength: 24000,
          maxOutputTokens: 4096,
          pricing: { input: '0.0000002', output: '0.0000009' },
          modalities: { input: ['text'], output: ['text'] },
          supportsTools: true,
        }],
      })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/account-1/ai/models/search?format=openrouter',
        { headers: { Authorization: 'Bearer cf-token' } },
      )
    })

  it('caches the cloudflare catalog per account, isolated from other accounts',
    async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: 'model-a', name: 'Model A' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: 'model-b', name: 'Model B' }],
          }),
        })

      const cache = createFakeCache()

      vi.stubGlobal('fetch', fetchMock)
      vi.stubGlobal('useStorage', () => cache)

      let accountId = 'account-1'

      vi.doMock('~~/server/utils/gateways/cloudflare', () => ({
        getCloudflareGatewayCredentials: vi.fn(async () => ({
          accountId,
          apiKey: `token-${accountId}`,
        })),
      }))

      const handler = await getHandler()

      const first = await handler({
        params: { gateway: 'cloudflare' },
      } as never)
      const second = await handler({
        params: { gateway: 'cloudflare' },
      } as never)

      accountId = 'account-2'

      const third = await handler({
        params: { gateway: 'cloudflare' },
      } as never)

      expect(first.models[0]?.id).toBe('model-a')
      expect(second.models[0]?.id).toBe('model-a')
      expect(third.models[0]?.id).toBe('model-b')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

  it('caches the cloudflare catalog per apiKey, so a guessed accountId with a different key never shares a catalog',
    async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: 'model-a', name: 'Model A' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: 'model-b', name: 'Model B' }],
          }),
        })

      const cache = createFakeCache()

      vi.stubGlobal('fetch', fetchMock)
      vi.stubGlobal('useStorage', () => cache)

      let apiKey = 'genuine-owner-token'

      vi.doMock('~~/server/utils/gateways/cloudflare', () => ({
        getCloudflareGatewayCredentials: vi.fn(async () => ({
          accountId: 'account-1',
          apiKey,
        })),
      }))

      const handler = await getHandler()

      const genuineOwnerResponse = await handler({
        params: { gateway: 'cloudflare' },
      } as never)

      apiKey = 'attacker-fake-token'

      const guessedAccountResponse = await handler({
        params: { gateway: 'cloudflare' },
      } as never)

      expect(genuineOwnerResponse.models[0]?.id).toBe('model-a')
      expect(guessedAccountResponse.models[0]?.id).toBe('model-b')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

  it('returns a normalized catalog for a valid gateway', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => vercelCatalogPayload,
    })

    vi.stubGlobal('fetch', fetchMock)

    const handler = await getHandler()

    const response = await handler({
      params: { gateway: 'vercel' },
    } as never)

    expect(response).toEqual({
      gateway: 'vercel',
      models: [
        {
          id: 'openai/gpt-4o',
          name: 'GPT-4o',
          description: undefined,
          contextLength: 128000,
          maxOutputTokens: 16384,
          pricing: { input: '0.0000025', output: '0.00001' },
          modalities: { input: ['text'], output: ['text'] },
          supportsTools: true,
        },
      ],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('serves the second request within the TTL from cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => vercelCatalogPayload,
    })

    vi.stubGlobal('fetch', fetchMock)

    const cache = createFakeCache()

    vi.stubGlobal('useStorage', () => cache)

    const handler = await getHandler()

    const first = await handler({ params: { gateway: 'vercel' } } as never)
    const second = await handler({ params: { gateway: 'vercel' } } as never)

    expect(first).toEqual(second)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('serves a stale cached catalog when the upstream fetch fails',
    async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service unavailable',
      })

      vi.stubGlobal('fetch', fetchMock)

      const cache = createFakeCache()
      const staleModels = [{
        id: 'openai/gpt-4o',
        name: 'GPT-4o (stale)',
      }]

      await cache.setItem('gateway-catalog:vercel', {
        models: staleModels,
        cachedAt: Date.now() - (2 * 60 * 60 * 1000),
      })

      vi.stubGlobal('useStorage', () => cache)

      const handler = await getHandler()

      const response = await handler({
        params: { gateway: 'vercel' },
      } as never)

      expect(response).toEqual({ gateway: 'vercel', models: staleModels })
      expect(mocks.loggerSet).toHaveBeenCalledWith(
        expect.objectContaining({
          gatewayCatalogFetch: {
            gateway: 'vercel',
            servedStale: true,
          },
        }),
      )
    })

  it('propagates a clean error when there is no cache and the fetch fails',
    async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service unavailable',
      })

      vi.stubGlobal('fetch', fetchMock)
      vi.stubGlobal('useStorage', () => createFakeCache())

      const handler = await getHandler()

      await expect(handler({
        params: { gateway: 'vercel' },
      } as never)).rejects.toThrow(
        'Failed to fetch Vercel AI Gateway model catalog',
      )
    })

  it('returns 429 once the per-user rate limit is exceeded', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => vercelCatalogPayload,
    })
    const setResponseHeaderMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('setResponseHeader', setResponseHeaderMock)

    const handler = await getHandler()

    for (let call = 0; call < 20; call++) {
      await handler({ params: { gateway: 'vercel' } } as never)
    }

    await expect(handler({
      params: { gateway: 'vercel' },
    } as never)).rejects.toMatchObject({
      message: 'Too many requests',
      status: 429,
    })
    expect(setResponseHeaderMock).toHaveBeenCalledWith(
      expect.anything(),
      'Retry-After',
      expect.any(Number),
    )
  })
})
