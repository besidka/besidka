import { beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
})

describe('ssr html no-store plugin', () => {
  it('sets private, no-store when the response has no cache-control',
    async () => {
      const { applyDocumentCacheControl } = await import(
        '../../../server/plugins/ssr-html-no-store'
      )

      const response = { headers: { 'content-type': 'text/html' } }
      const context = { event: { path: '/signin', context: {} } }

      applyDocumentCacheControl(response as never, context as never)

      expect(response.headers).toEqual({
        'content-type': 'text/html',
        'cache-control': 'private, no-store',
      })
    })

  it('leaves an existing cache-control untouched', async () => {
    const { applyDocumentCacheControl } = await import(
      '../../../server/plugins/ssr-html-no-store'
    )

    const response = { headers: { 'cache-control': 's-maxage=3600' } }
    const context = { event: { path: '/signin', context: {} } }

    applyDocumentCacheControl(response as never, context as never)

    expect(response.headers).toEqual({ 'cache-control': 's-maxage=3600' })
  })

  it('treats cache-control case-insensitively', async () => {
    const { applyDocumentCacheControl } = await import(
      '../../../server/plugins/ssr-html-no-store'
    )

    const response = { headers: { 'Cache-Control': 's-maxage=3600' } }
    const context = { event: { path: '/signin', context: {} } }

    applyDocumentCacheControl(response as never, context as never)

    expect(response.headers).toEqual({ 'Cache-Control': 's-maxage=3600' })
  })

  it('skips cached routes', async () => {
    const { applyDocumentCacheControl } = await import(
      '../../../server/plugins/ssr-html-no-store'
    )

    const response = { headers: { 'content-type': 'text/html' } }
    const context = {
      event: { path: '/', context: { cache: { options: {} } } },
    }

    applyDocumentCacheControl(response as never, context as never)

    expect(response.headers['cache-control']).toBeUndefined()
  })

  it('sets no-cache for the privacy policy page', async () => {
    const { applyDocumentCacheControl } = await import(
      '../../../server/plugins/ssr-html-no-store'
    )

    const response = { headers: { 'content-type': 'text/html' } }
    const context = { event: { path: '/privacy-policy', context: {} } }

    applyDocumentCacheControl(response as never, context as never)

    expect(response.headers['cache-control']).toBe('no-cache')
  })

  it('sets no-cache for the terms page with a trailing slash',
    async () => {
      const { applyDocumentCacheControl } = await import(
        '../../../server/plugins/ssr-html-no-store'
      )

      const response = { headers: { 'content-type': 'text/html' } }
      const context = { event: { path: '/terms-of-use/', context: {} } }

      applyDocumentCacheControl(response as never, context as never)

      expect(response.headers['cache-control']).toBe('no-cache')
    })

  it('sets no-cache for the cookie policy page with a query string',
    async () => {
      const { applyDocumentCacheControl } = await import(
        '../../../server/plugins/ssr-html-no-store'
      )

      const response = { headers: { 'content-type': 'text/html' } }
      const context = { event: { path: '/cookie-policy?x=1', context: {} } }

      applyDocumentCacheControl(response as never, context as never)

      expect(response.headers['cache-control']).toBe('no-cache')
    })

  it('sets no-cache for a shared chat page', async () => {
    const { applyDocumentCacheControl } = await import(
      '../../../server/plugins/ssr-html-no-store'
    )

    const response = { headers: { 'content-type': 'text/html' } }
    const context = { event: { path: '/shared/abc123', context: {} } }

    applyDocumentCacheControl(response as never, context as never)

    expect(response.headers['cache-control']).toBe('no-cache')
  })

  it('sets private, no-store for a path that only looks shared-like',
    async () => {
      const { applyDocumentCacheControl } = await import(
        '../../../server/plugins/ssr-html-no-store'
      )

      const response = { headers: { 'content-type': 'text/html' } }
      const context = { event: { path: '/sharedx', context: {} } }

      applyDocumentCacheControl(response as never, context as never)

      expect(response.headers['cache-control']).toBe('private, no-store')
    })

  it('sets private, no-store for other app routes', async () => {
    const { applyDocumentCacheControl } = await import(
      '../../../server/plugins/ssr-html-no-store'
    )

    const response = { headers: { 'content-type': 'text/html' } }
    const context = { event: { path: '/chats/new', context: {} } }

    applyDocumentCacheControl(response as never, context as never)

    expect(response.headers['cache-control']).toBe('private, no-store')
  })

  it('sets private, no-store for /shared with no trailing segment',
    async () => {
      const { applyDocumentCacheControl } = await import(
        '../../../server/plugins/ssr-html-no-store'
      )

      const response = { headers: { 'content-type': 'text/html' } }
      const context = { event: { path: '/shared', context: {} } }

      applyDocumentCacheControl(response as never, context as never)

      expect(response.headers['cache-control']).toBe('private, no-store')
    })
})
