import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const NITRO_CACHE_KEY_SNIPPET
  = 'const _path = event.node.req.originalUrl || event.node.req.url || event.path;'

let dropQueryFromCacheKeyUrl: (event: H3Event) => void
let registerPlugin: (nitroApp: unknown) => void

beforeAll(async () => {
  vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)

  const plugin = await import('~~/server/plugins/cache-key-without-query')

  dropQueryFromCacheKeyUrl = plugin.dropQueryFromCacheKeyUrl as never
  registerPlugin = plugin.default as never
})

function createEvent(url: string) {
  return {
    path: url,
    node: { req: { url, originalUrl: url } },
  }
}

function cacheKeyUrl(event: ReturnType<typeof createEvent>): string {
  return event.node.req.originalUrl || event.node.req.url || event.path
}

function runHook(url: string) {
  const event = createEvent(url)

  dropQueryFromCacheKeyUrl(event as unknown as H3Event)

  return event
}

describe('cache key without query plugin', () => {
  it('registers on the nitro request hook', () => {
    const hook = vi.fn()

    registerPlugin({ hooks: { hook } })

    expect(hook).toHaveBeenCalledWith('request', dropQueryFromCacheKeyUrl)
  })

  it('gives the landing page one cache key for every query string', () => {
    const keys = new Set([
      cacheKeyUrl(runHook('/')),
      cacheKeyUrl(runHook('/?x=abc')),
      cacheKeyUrl(runHook('/?x=def')),
      cacheKeyUrl(runHook('/?utm_source=reddit&utm_campaign=launch')),
    ])

    expect([...keys]).toEqual(['/'])
  })

  it('gives a raw twin one cache key for every query string', () => {
    const keys = new Set([
      cacheKeyUrl(runHook('/raw/index.md')),
      cacheKeyUrl(runHook('/raw/index.md?x=1')),
      cacheKeyUrl(runHook('/raw/guides/byok.md?x=2&y=3')),
    ])

    expect([...keys]).toEqual(['/raw/index.md', '/raw/guides/byok.md'])
  })

  it('keeps the request path so routing and rendering are unchanged', () => {
    const event = runHook('/?utm_source=reddit')

    expect(event.path).toBe('/?utm_source=reddit')
    expect(event.node.req.url).toBe('/?utm_source=reddit')
  })

  it('leaves every other path and its query string alone', () => {
    for (const url of [
      '/byok?x=1',
      '/signin?next=%2Fchats',
      '/api/v1/stats?x=1',
      '/rawx?x=1',
      '/mcp?x=1',
    ]) {
      expect(cacheKeyUrl(runHook(url))).toBe(url)
    }
  })

  it('does not touch a request without a query string', () => {
    const event = createEvent('/raw/index.md')

    dropQueryFromCacheKeyUrl(event as unknown as H3Event)

    expect(event.node.req.originalUrl).toBe('/raw/index.md')
  })

  it('keeps the key formula aligned with the installed nitropack cache source',
    async () => {
      const { default: cacheSource } = await import(
        'nitropack/runtime/internal/cache?raw'
      )

      expect(cacheSource).toContain(NITRO_CACHE_KEY_SNIPPET)
    })
})
