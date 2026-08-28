import { beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
})

describe('ssr html no-store plugin', () => {
  it('sets private, no-store when the response has no cache-control',
    async () => {
      const { applyNoStoreHeader } = await import(
        '../../../server/plugins/ssr-html-no-store'
      )

      const response = { headers: { 'content-type': 'text/html' } }
      const context = { event: { context: {} } }

      applyNoStoreHeader(response as never, context as never)

      expect(response.headers).toEqual({
        'content-type': 'text/html',
        'cache-control': 'private, no-store',
      })
    })

  it('leaves an existing cache-control untouched', async () => {
    const { applyNoStoreHeader } = await import(
      '../../../server/plugins/ssr-html-no-store'
    )

    const response = { headers: { 'cache-control': 's-maxage=3600' } }
    const context = { event: { context: {} } }

    applyNoStoreHeader(response as never, context as never)

    expect(response.headers).toEqual({ 'cache-control': 's-maxage=3600' })
  })

  it('treats cache-control case-insensitively', async () => {
    const { applyNoStoreHeader } = await import(
      '../../../server/plugins/ssr-html-no-store'
    )

    const response = { headers: { 'Cache-Control': 's-maxage=3600' } }
    const context = { event: { context: {} } }

    applyNoStoreHeader(response as never, context as never)

    expect(response.headers).toEqual({ 'Cache-Control': 's-maxage=3600' })
  })

  it('skips cached routes', async () => {
    const { applyNoStoreHeader } = await import(
      '../../../server/plugins/ssr-html-no-store'
    )

    const response = { headers: { 'content-type': 'text/html' } }
    const context = { event: { context: { cache: { options: {} } } } }

    applyNoStoreHeader(response as never, context as never)

    expect(response.headers['cache-control']).toBeUndefined()
  })
})
