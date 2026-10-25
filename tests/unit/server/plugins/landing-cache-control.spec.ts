import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createApp,
  eventHandler,
  handleCacheHeaders,
  toWebHandler,
} from 'h3'
import type { H3Event } from 'h3'

const LANDING_MAX_AGE = 3600
const NITRO_CACHE_REPLAY_SNIPPETS = [
  'handleCacheHeaders(event, {',
  'event.node.res.setHeader(name, value)',
  'headers["cache-control"] = cacheControl.join(", ")',
]

interface CachedEntry {
  code: number
  headers: Record<string, string>
  body: string
}

let pinLandingRevalidation: (event: H3Event) => void
let registerPlugin: (nitroApp: unknown) => void

beforeAll(async () => {
  vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)

  const plugin = await import('~~/server/plugins/landing-cache-control')

  pinLandingRevalidation = plugin.pinLandingRevalidation as never
  registerPlugin = plugin.default as never
})

/**
 * Mirrors nitropack's `defineCachedEventHandler` replay
 * (`nitropack/dist/runtime/internal/cache.mjs`): the stored entry carries
 * `cache-control: max-age=<maxAge>` for `swr: false`, `handleCacheHeaders`
 * answers conditional requests, and every stored header is replayed through
 * `event.node.res.setHeader`. The real module cannot be loaded in vitest
 * because it imports `#nitro-internal-virtual/*`, so a drift guard below
 * checks the upstream source still has this shape.
 */
function createCachedLandingHandler(
  store: Map<string, CachedEntry>,
  renderLandingHtml: () => string,
) {
  return eventHandler((event) => {
    let entry = store.get('landing')

    if (!entry) {
      const body = renderLandingHtml()

      entry = {
        code: 200,
        body,
        headers: {
          'content-type': 'text/html',
          'etag': `W/"${body.length}"`,
          'last-modified': new Date(0).toUTCString(),
          'cache-control': `max-age=${LANDING_MAX_AGE}`,
        },
      }
      store.set('landing', entry)
    }

    const isNotModified = handleCacheHeaders(event, {
      modifiedTime: new Date(entry.headers['last-modified']),
      etag: entry.headers.etag,
      maxAge: LANDING_MAX_AGE,
    })

    if (isNotModified) {
      return
    }

    event.node.res.statusCode = entry.code

    for (const [name, value] of Object.entries(entry.headers)) {
      event.node.res.setHeader(name, value)
    }

    return entry.body
  })
}

function createServer(
  handler: ReturnType<typeof eventHandler>,
  withPlugin = true,
) {
  const app = createApp({
    onRequest: (event) => {
      if (withPlugin) {
        pinLandingRevalidation(event)
      }
    },
  })

  app.use(handler)

  return toWebHandler(app)
}

function createLandingServer(withPlugin = true) {
  const store = new Map<string, CachedEntry>()
  const renderLandingHtml = vi.fn(() => '<html>landing</html>')
  const handler = createCachedLandingHandler(store, renderLandingHtml)

  return {
    renderLandingHtml,
    server: createServer(handler, withPlugin),
  }
}

describe('landing cache control plugin', () => {
  it('registers the pin on the nitro request hook', () => {
    const hook = vi.fn()

    registerPlugin({ hooks: { hook } })

    expect(hook).toHaveBeenCalledWith('request', pinLandingRevalidation)
  })

  it('shows the nitro replay would otherwise send max-age', async () => {
    const { server } = createLandingServer(false)
    const response = await server(new Request('http://localhost/'))

    expect(response.headers.get('cache-control')).toBe(
      `max-age=${LANDING_MAX_AGE}`,
    )
  })

  it('sends no-cache on a cache miss for the landing page', async () => {
    const { server, renderLandingHtml } = createLandingServer()
    const response = await server(new Request('http://localhost/'))

    expect(renderLandingHtml).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(await response.text()).toBe('<html>landing</html>')
  })

  it('sends no-cache on a cache hit served from the stored entry',
    async () => {
      const { server, renderLandingHtml } = createLandingServer()

      await server(new Request('http://localhost/'))

      const response = await server(new Request('http://localhost/'))

      expect(renderLandingHtml).toHaveBeenCalledTimes(1)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-cache')
      expect(await response.text()).toBe('<html>landing</html>')
    })

  it('sends no-cache on a 304 revalidation response', async () => {
    const { server } = createLandingServer()
    const first = await server(new Request('http://localhost/'))
    const etag = first.headers.get('etag') as string
    const revalidated = await server(new Request('http://localhost/', {
      headers: { 'if-none-match': etag },
    }))

    expect(etag).toBeTruthy()
    expect(revalidated.status).toBe(304)
    expect(revalidated.headers.get('cache-control')).toBe('no-cache')
  })

  it('also pins the landing page when a query string is present',
    async () => {
      const { server } = createLandingServer()
      const response = await server(
        new Request('http://localhost/?utm_source=test'),
      )

      expect(response.headers.get('cache-control')).toBe('no-cache')
    })

  it('leaves other paths on the nitro cache headers', async () => {
    const { server } = createLandingServer()
    const response = await server(new Request('http://localhost/byok'))

    expect(response.headers.get('cache-control')).toBe(
      `max-age=${LANDING_MAX_AGE}`,
    )
  })

  it('does not rewrite non-freshness cache-control values on the landing page',
    async () => {
      const handler = eventHandler((event) => {
        event.node.res.setHeader('cache-control', 'private, no-store')

        return 'ok'
      })
      const response = await createServer(handler)(
        new Request('http://localhost/'),
      )

      expect(response.headers.get('cache-control')).toBe('private, no-store')
    })

  it('keeps the replica aligned with the installed nitropack cache source',
    async () => {
      const { default: cacheSource } = await import(
        'nitropack/runtime/internal/cache?raw'
      )

      for (const snippet of NITRO_CACHE_REPLAY_SNIPPETS) {
        expect(cacheSource).toContain(snippet)
      }
    })
})
