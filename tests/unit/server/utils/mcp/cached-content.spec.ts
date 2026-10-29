import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publicPageSlugs } from '~~/server/utils/mcp/pages'

const mocks = vi.hoisted(() => {
  return {
    queryCollection: vi.fn(),
  }
})

vi.mock('@nuxt/content/server', () => {
  return { queryCollection: mocks.queryCollection }
})

interface RegisteredCache {
  options: {
    getKey: (...args: unknown[]) => string
    swr: boolean
    maxAge: number
    group: string
    name: string
    validate?: (entry: { value?: unknown }) => boolean
  }
  fn: (...args: unknown[]) => Promise<unknown>
}

const registered: RegisteredCache[] = []

async function loadModule() {
  vi.resetModules()
  registered.length = 0
  vi.stubGlobal(
    'defineCachedFunction',
    (fn: RegisteredCache['fn'], options: RegisteredCache['options']) => {
      registered.push({ fn, options })

      return fn
    },
  )

  return await import('~~/server/utils/mcp/cached-content')
}

function createEvent(requestId: string) {
  return {
    context: { requestId },
    node: { req: { headers: { 'cf-ray': requestId } } },
  }
}

describe('mcp cached content', () => {
  beforeEach(() => {
    mocks.queryCollection.mockReset()
  })

  it('registers the guide index and the page record caches', async () => {
    await loadModule()

    expect(registered.map((cache) => {
      return cache.options.name
    })).toEqual(['mcp-key-guide-index', 'mcp-public-page'])
  })

  it('gives the guide index one constant key whatever the request', async () => {
    const { keyGuideIndexCacheOptions } = await loadModule()
    const keys = new Set([
      keyGuideIndexCacheOptions.getKey(),
      registered[0].options.getKey(createEvent('a')),
      registered[0].options.getKey(createEvent('b'), { id: 'x' }),
      registered[0].options.getKey(createEvent('c'), 'z', 99),
    ])

    expect([...keys]).toEqual(['all'])
  })

  it('keys the page record by slug and ignores the event', async () => {
    await loadModule()

    const { getKey } = registered[1].options

    expect(getKey(createEvent('a'), 'byok')).toBe('byok')
    expect(getKey(createEvent('b'), 'byok')).toBe('byok')

    const keys = publicPageSlugs.map((slug) => {
      return getKey(createEvent('c'), slug)
    })

    expect(new Set(keys).size).toBe(publicPageSlugs.length)
  })

  it('never writes a no-TTL entry and expires after one hour', async () => {
    await loadModule()

    for (const cache of registered) {
      expect(cache.options.swr).toBe(false)
      expect(cache.options.maxAge).toBe(3600)
      expect(cache.options.group).toBe('mcp')
    }
  })

  it('does not cache a page that is not published', async () => {
    await loadModule()

    const { validate } = registered[1].options

    expect(validate?.({ value: null })).toBe(false)
    expect(validate?.({ value: { title: 'Terms' } })).toBe(true)
  })

  it('selects the guide index columns through queryCollection', async () => {
    const all = vi.fn(async () => [{ path: '/guides/a', provider: 'a' }])
    const select = vi.fn(() => {
      return { all }
    })

    mocks.queryCollection.mockReturnValue({ select })

    const { getKeyGuideIndex } = await loadModule()
    const event = createEvent('a')

    await expect(getKeyGuideIndex(event as never)).resolves.toEqual([
      { path: '/guides/a', provider: 'a' },
    ])
    expect(mocks.queryCollection).toHaveBeenCalledWith(event, 'keyGuides')
    expect(select).toHaveBeenCalledWith('path', 'provider', 'title')
  })

  it('queries the legal collection for a legal page slug', async () => {
    const first = vi.fn(async () => {
      return { title: 'Privacy' }
    })
    const path = vi.fn(() => {
      return { first }
    })

    mocks.queryCollection.mockReturnValue({ path })

    const { getPublicPageRecord } = await loadModule()
    const event = createEvent('a')

    await getPublicPageRecord(event as never, 'privacy-policy')

    expect(mocks.queryCollection).toHaveBeenCalledWith(event, 'legal')
    expect(path).toHaveBeenCalledWith('/legal/privacy-policy')
  })

  it('queries the guides collection for a guide page slug', async () => {
    const first = vi.fn(async () => {
      return { title: 'BYOK' }
    })
    const path = vi.fn(() => {
      return { first }
    })

    mocks.queryCollection.mockReturnValue({ path })

    const { getPublicPageRecord } = await loadModule()
    const event = createEvent('a')

    await getPublicPageRecord(event as never, 'byok')

    expect(mocks.queryCollection).toHaveBeenCalledWith(event, 'guides')
    expect(path).toHaveBeenCalledWith('/guides/byok')
  })
})
