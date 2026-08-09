import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enforceKeysRateLimit } from '../../../server/utils/keys-rate-limit'

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
}))

const ALL_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'moonshotai',
  'qwen',
  'vercel-gateway',
  'cloudflare-gateway',
  'openrouter',
]

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

function createDbMock(rows: Array<{ provider: string }>) {
  const findMany = vi.fn().mockImplementation(async () => rows)

  return {
    db: {
      query: {
        keys: { findMany },
      },
    },
    spies: { findMany },
  }
}

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/keys/index.get'
  )

  return module.default
}

describe('keys summary API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()

    const fakeKv = createFakeKv()

    vi.stubGlobal('defineEventHandler', (handler: any) => handler)
    vi.stubGlobal('enforceKeysRateLimit', enforceKeysRateLimit)
    vi.stubGlobal('useKV', () => fakeKv)
    vi.stubGlobal('setResponseHeader', vi.fn())
    vi.stubGlobal('createError', (input: any) => {
      const exception = new Error(input.statusMessage || input.message)

      Object.assign(exception, input)

      return exception
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw (globalThis as any).createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
      })
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
  })

  it('rejects unauthenticated requests', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    const dbMock = createDbMock([])

    vi.stubGlobal('useDb', () => dbMock.db)

    const handler = await getHandler()

    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 401,
    })
    expect(dbMock.spies.findMany).not.toHaveBeenCalled()
  })

  it('reports all 10 providers with hasKey false when none are set',
    async () => {
      const dbMock = createDbMock([])

      vi.stubGlobal('useDb', () => dbMock.db)

      const handler = await getHandler()
      const response = await handler({} as any)

      expect(response.keys).toHaveLength(10)
      expect(response.keys.map((entry: { provider: string }) => {
        return entry.provider
      }).sort()).toEqual([...ALL_PROVIDERS].sort())
      expect(response.keys.every((entry: { hasKey: boolean }) => {
        return entry.hasKey === false
      })).toBe(true)
    })

  it('reports hasKey true only for providers with a stored row',
    async () => {
      const dbMock = createDbMock([
        { provider: 'openai' },
        { provider: 'vercel-gateway' },
      ])

      vi.stubGlobal('useDb', () => dbMock.db)

      const handler = await getHandler()
      const response = await handler({} as any)

      const byProvider = new Map(
        response.keys.map((entry: {
          provider: string
          hasKey: boolean
        }) => [entry.provider, entry.hasKey]),
      )

      expect(byProvider.get('openai')).toBe(true)
      expect(byProvider.get('vercel-gateway')).toBe(true)
      expect(byProvider.get('openrouter')).toBe(false)
      expect(byProvider.get('cloudflare-gateway')).toBe(false)
      expect(byProvider.get('anthropic')).toBe(false)
    })

  it('never returns secret material, only provider and hasKey',
    async () => {
      const dbMock = createDbMock([{ provider: 'openai' }])

      vi.stubGlobal('useDb', () => dbMock.db)

      const handler = await getHandler()
      const response = await handler({} as any)

      for (const entry of response.keys) {
        expect(Object.keys(entry).sort()).toEqual(['hasKey', 'provider'])
      }

      expect(JSON.stringify(response)).not.toMatch(/apiKey|secret-value/i)
    })

  it('only selects the provider column, never apiKey', async () => {
    const dbMock = createDbMock([])

    vi.stubGlobal('useDb', () => dbMock.db)

    const handler = await getHandler()

    await handler({} as any)

    expect(dbMock.spies.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: { provider: true },
      }),
    )
  })

  it('returns 429 once the rate limit is exceeded', async () => {
    const dbMock = createDbMock([])

    vi.stubGlobal('useDb', () => dbMock.db)

    const handler = await getHandler()

    for (let call = 0; call < 30; call++) {
      await handler({} as any)
    }

    await expect(handler({} as any)).rejects.toMatchObject({
      message: 'Too many requests',
      status: 429,
    })
  })
})
