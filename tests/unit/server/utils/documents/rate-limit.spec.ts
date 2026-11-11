import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOCUMENT_RENDER_RATE_LIMIT_PER_MINUTE } from '#shared/utils/documents'

const mocks = vi.hoisted(() => ({
  logger: { set: vi.fn() },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

const { enforceDocumentRateLimit } = await import(
  '~~/server/utils/documents/rate-limit'
)

const USER_ID = 42

function createEvent() {
  return {
    context: {},
    res: { headers: new Headers() },
  } as unknown as Parameters<typeof enforceDocumentRateLimit>[0]
}

function createKv(options: { failPut?: boolean, failGet?: boolean } = {}) {
  const store = new Map<string, string>()

  return {
    store,
    get: vi.fn(async (key: string) => {
      if (options.failGet) {
        throw new Error('KV read failed')
      }

      return store.get(key) ?? null
    }),
    put: vi.fn(async (key: string, value: string) => {
      if (options.failPut) {
        throw new Error('KV write limit: 1 write per second per key')
      }

      store.set(key, value)
    }),
  }
}

function storedCountKey(kind: 'file' | 'render'): string {
  return `documents-${kind}-rate-limit:${USER_ID}`
}

describe('enforceDocumentRateLimit', () => {
  beforeEach(() => {
    mocks.logger.set.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('allows calls under the limit and counts them in KV', async () => {
    const kv = createKv()

    vi.stubGlobal('useKV', () => kv)

    await enforceDocumentRateLimit(createEvent(), USER_ID, 'file')
    await enforceDocumentRateLimit(createEvent(), USER_ID, 'file')

    expect(JSON.parse(kv.store.get(storedCountKey('file'))!).count).toBe(2)
    expect(mocks.logger.set).not.toHaveBeenCalled()
  })

  it('answers 429 with Retry-After once the stored count is at the limit',
    async () => {
      const kv = createKv()

      vi.stubGlobal('useKV', () => kv)
      kv.store.set(storedCountKey('render'), JSON.stringify({
        key: String(USER_ID),
        count: DOCUMENT_RENDER_RATE_LIMIT_PER_MINUTE,
        lastRequest: Date.now(),
        windowStart: Date.now(),
      }))

      const event = createEvent()
      const exception = await enforceDocumentRateLimit(
        event,
        USER_ID,
        'render',
      ).then(() => null, error => error)

      expect(exception).toMatchObject({ status: 429 })
      expect(Number(event.res.headers.get('Retry-After'))).toBeGreaterThan(0)
      expect(kv.put).not.toHaveBeenCalled()
    })

  it('keeps a separate bucket per kind', async () => {
    const kv = createKv()

    vi.stubGlobal('useKV', () => kv)
    kv.store.set(storedCountKey('render'), JSON.stringify({
      key: String(USER_ID),
      count: DOCUMENT_RENDER_RATE_LIMIT_PER_MINUTE,
      lastRequest: Date.now(),
      windowStart: Date.now(),
    }))

    await expect(enforceDocumentRateLimit(createEvent(), USER_ID, 'file'))
      .resolves.toBeUndefined()
  })

  it('fails open when the counter write is refused', async () => {
    const kv = createKv({ failPut: true })

    vi.stubGlobal('useKV', () => kv)

    await expect(enforceDocumentRateLimit(createEvent(), USER_ID, 'file'))
      .resolves.toBeUndefined()
    expect(mocks.logger.set).toHaveBeenCalledWith({
      attributes: {
        documents: {
          rateLimit: { kind: 'file', failedOpen: true },
          rateLimitError: 'KV write limit: 1 write per second per key',
        },
      },
    })
  })

  it('fails open when the counter cannot be read', async () => {
    vi.stubGlobal('useKV', () => createKv({ failGet: true }))

    await expect(enforceDocumentRateLimit(createEvent(), USER_ID, 'render'))
      .resolves.toBeUndefined()
    expect(JSON.stringify(mocks.logger.set.mock.calls))
      .toContain('"failedOpen":true')
  })

  it('fails open when the KV binding itself throws', async () => {
    vi.stubGlobal('useKV', () => {
      throw new Error('binding missing')
    })

    await expect(enforceDocumentRateLimit(createEvent(), USER_ID, 'file'))
      .resolves.toBeUndefined()
  })

  it('lets three near-simultaneous uploads of one turn through when the '
    + 'second write is refused', async () => {
    const kv = createKv()

    vi.stubGlobal('useKV', () => kv)
    kv.put
      .mockImplementationOnce(async (key: string, value: string) => {
        kv.store.set(key, value)
      })
      .mockRejectedValueOnce(new Error('KV write limit'))
      .mockRejectedValueOnce(new Error('KV write limit'))

    for (let call = 0; call < 3; call += 1) {
      await expect(enforceDocumentRateLimit(createEvent(), USER_ID, 'file'))
        .resolves.toBeUndefined()
    }
  })
})
