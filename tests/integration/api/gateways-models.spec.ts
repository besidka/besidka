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
    vi.stubGlobal('fetch', vi.fn())

    const handler = await getHandler()

    await expect(handler({
      params: { gateway: 'vercel' },
    } as never)).rejects.toThrow('Unauthorized')
  })

  it('rejects an invalid gateway param', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const handler = await getHandler()

    await expect(handler({
      params: { gateway: 'not-a-gateway' },
    } as never)).rejects.toThrow('Invalid request parameters')
  })

  it('rejects cloudflare as not yet supported', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const handler = await getHandler()

    await expect(handler({
      params: { gateway: 'cloudflare' },
    } as never)).rejects.toThrow(
      'Cloudflare AI Gateway is not yet supported',
    )
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
})
