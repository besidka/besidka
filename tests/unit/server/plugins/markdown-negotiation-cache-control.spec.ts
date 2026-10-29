import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

let pinNegotiatedMarkdownRevalidation: (event: H3Event) => void
let registerPlugin: (nitroApp: unknown) => void

beforeAll(async () => {
  vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)

  const plugin = await import(
    '~~/server/plugins/markdown-negotiation-cache-control'
  )

  pinNegotiatedMarkdownRevalidation
    = plugin.pinNegotiatedMarkdownRevalidation as never
  registerPlugin = plugin.default as never
})

function createEvent(path: string, headers: Record<string, string>) {
  const responseHeaders = new Map(Object.entries(headers))

  return {
    path,
    responseHeaders,
    node: {
      res: {
        getHeader: (name: string) => {
          return responseHeaders.get(name)
        },
        setHeader: (name: string, value: string) => {
          responseHeaders.set(name, value)
        },
      },
    },
  }
}

function run(path: string, headers: Record<string, string>) {
  const event = createEvent(path, headers)

  pinNegotiatedMarkdownRevalidation(event as unknown as H3Event)

  return event.responseHeaders.get('cache-control')
}

const COPIED_FROM_TWIN = 'max-age=3600'

describe('markdown negotiation cache control plugin', () => {
  it('registers on the nitro beforeResponse hook', () => {
    const hook = vi.fn()

    registerPlugin({ hooks: { hook } })

    expect(hook).toHaveBeenCalledWith(
      'beforeResponse',
      pinNegotiatedMarkdownRevalidation,
    )
  })

  it('forces no-cache on markdown negotiated at an HTML url', () => {
    expect(run('/byok', {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': COPIED_FROM_TWIN,
    })).toBe('no-cache')
  })

  it('forces no-cache when the negotiated response had no cache-control',
    () => {
      expect(run('/memory?x=1', {
        'content-type': 'text/markdown',
      })).toBe('no-cache')
    })

  it('keeps the twin cache headers on a .md url', () => {
    expect(run('/raw/guides/byok.md', {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': COPIED_FROM_TWIN,
    })).toBe(COPIED_FROM_TWIN)
    expect(run('/sitemap.md', {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': COPIED_FROM_TWIN,
    })).toBe(COPIED_FROM_TWIN)
  })

  it('keeps the twin cache headers under /raw/', () => {
    expect(run('/raw/index', {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': COPIED_FROM_TWIN,
    })).toBe(COPIED_FROM_TWIN)
  })

  it('leaves HTML and other content types alone', () => {
    expect(run('/byok', {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
    })).toBe('private, no-store')
    expect(run('/api/v1/stats', {
      'content-type': 'application/json',
      'cache-control': COPIED_FROM_TWIN,
    })).toBe(COPIED_FROM_TWIN)
    expect(run('/byok', {})).toBeUndefined()
  })
})
