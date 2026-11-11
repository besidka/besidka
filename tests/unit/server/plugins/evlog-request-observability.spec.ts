import { beforeAll, describe, expect, it, vi } from 'vitest'

let moveMcpContextToAttributes: (event: Record<string, unknown>) => void
let toLoggedPath: (path: unknown) => unknown
let enrich: (context: Record<string, any>) => void

beforeAll(async () => {
  vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
  vi.stubGlobal('attachCloudflareMeta', vi.fn())

  const plugin = await import('~~/server/plugins/evlog-request-observability')

  moveMcpContextToAttributes = plugin.moveMcpContextToAttributes
  toLoggedPath = plugin.toLoggedPath

  const hooks: Record<string, (context: Record<string, any>) => void> = {}

  ;(plugin.default as unknown as (app: unknown) => void)({
    hooks: {
      hook: (name: string, handler: (context: Record<string, any>) => void) => {
        hooks[name] = handler
      },
    },
  })
  enrich = hooks['evlog:enrich']!
})

function run(mcp: unknown, attributes?: Record<string, unknown>) {
  const event: Record<string, unknown> = { mcp, attributes }

  moveMcpContextToAttributes(event)

  return event
}

describe('moveMcpContextToAttributes', () => {
  it('moves the mcp object under attributes and removes the root key', () => {
    const event = run({
      transport: 'streamable-http',
      route: '/mcp',
      method: 'tools/call',
      tool: 'list_models',
      request_id: 7,
    }, { existing: true })

    expect(event.mcp).toBeUndefined()
    expect(event.attributes).toEqual({
      existing: true,
      mcp: {
        transport: 'streamable-http',
        route: '/mcp',
        method: 'tools/call',
        tool: 'list_models',
        request_id: 7,
      },
    })
  })

  it('drops the client-chosen session id', () => {
    const event = run({ route: '/mcp', session_id: 'abc-123' })

    expect(event.attributes).toEqual({ mcp: { route: '/mcp' } })
  })

  it('truncates long strings to 120 characters', () => {
    const event = run({ tool: 'x'.repeat(5000) })
    const { mcp } = event.attributes as { mcp: { tool: string } }

    expect(mcp.tool).toHaveLength(120)
  })

  it('caps arrays at 10 items and truncates their strings', () => {
    const event = run({
      tools: Array.from({ length: 100 }, () => {
        return 'y'.repeat(500)
      }),
      request_ids: Array.from({ length: 100 }, (_item, index) => {
        return index
      }),
    })
    const { mcp } = event.attributes as {
      mcp: { tools: string[], request_ids: number[] }
    }

    expect(mcp.tools).toHaveLength(10)
    expect(mcp.tools.every((tool) => {
      return tool.length === 120
    })).toBe(true)
    expect(mcp.request_ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('drops values that are not scalars or arrays of scalars', () => {
    const event = run({
      nested: { deep: 'value' },
      nothing: null,
      mixed: ['a', { x: 1 }, 2],
    })

    expect(event.attributes).toEqual({ mcp: { mixed: ['a', 2] } })
  })

  it('does nothing when there is no mcp context', () => {
    const event = run(undefined)

    expect(event.attributes).toBeUndefined()
    expect('mcp' in event && event.mcp).toBeFalsy()
  })
})

describe('admin path query stripping', () => {
  it('drops the query string from admin API paths only', () => {
    expect(toLoggedPath('/api/v1/admin/users/search?q=jane'))
      .toBe('/api/v1/admin/users/search')
    expect(toLoggedPath('/api/v1/files?offset=10'))
      .toBe('/api/v1/files?offset=10')
    expect(toLoggedPath(undefined)).toBeUndefined()
  })

  it('keeps the search text out of the wide event path and message', () => {
    const context = {
      request: {
        method: 'GET',
        path: '/api/v1/admin/users/search?q=jane',
      },
      headers: {},
      event: { path: '/api/v1/admin/users/search?q=jane' },
    }

    enrich(context)

    expect(context.event).toMatchObject({
      path: '/api/v1/admin/users/search',
      message: 'GET /api/v1/admin/users/search',
    })
    expect(JSON.stringify(context.event)).not.toContain('jane')
  })
})

describe('artifact share token redaction', () => {
  const TOKEN = 'Q2hhbmdlTWVQbGVhc2VJdHNBU2VjcmV0VG9rZW4xMjM0NQ'

  it('replaces the token of a public artifact link with the route pattern',
    async () => {
      const { redactArtifactSharePath } = await import(
        '~~/server/utils/artifacts/share-redaction'
      )

      expect(redactArtifactSharePath(`/artifacts/${TOKEN}`))
        .toBe('/artifacts/[token]')
      expect(redactArtifactSharePath(`/artifacts/${TOKEN}/_payload.json?x=1`))
        .toBe('/artifacts/[token]/_payload.json?x=1')
      expect(redactArtifactSharePath(
        `GET https://besidka.com/artifacts/${TOKEN}`,
      )).toBe('GET https://besidka.com/artifacts/[token]')
      expect(redactArtifactSharePath(`https://besidka.com/artifacts/${TOKEN}#x`))
        .toBe('https://besidka.com/artifacts/[token]#x')
      expect(redactArtifactSharePath(`Failed on /Artifacts/${TOKEN} x`))
        .toBe('Failed on /artifacts/[token] x')
      expect(redactArtifactSharePath(42)).toBe(42)
      expect(redactArtifactSharePath('/data/files')).toBe('/data/files')
    })

  it('replaces the token of a percent-encoded link', async () => {
    const { redactArtifactSharePath } = await import(
      '~~/server/utils/artifacts/share-redaction'
    )

    expect(redactArtifactSharePath(`/signup?next=%2Fartifacts%2F${TOKEN}`))
      .toBe('/signup?next=%2Fartifacts%2F[token]')
    expect(redactArtifactSharePath(`/signin?next=%2fartifacts%2f${TOKEN}&x=1`))
      .toBe('/signin?next=%2fartifacts%2f[token]&x=1')
    expect(redactArtifactSharePath(`/signin?next=%252Fartifacts%252F${TOKEN}`))
      .toBe('/signin?next=%252Fartifacts%252F[token]')
    expect(redactArtifactSharePath(`x=%25252fArtifacts%25252f${TOKEN}`))
      .toBe('x=%25252fartifacts%25252f[token]')
    expect(redactArtifactSharePath(
      `x?url=https%3A%2F%2Fb.com%2Fartifacts%2F${TOKEN}`,
    )).toBe('x?url=https%3A%2F%2Fb.com%2Fartifacts%2F[token]')
  })

  it('leaves artifact API paths and the bare page path alone', async () => {
    const { redactArtifactSharePath } = await import(
      '~~/server/utils/artifacts/share-redaction'
    )

    expect(redactArtifactSharePath('/api/v1/artifacts/Abc123Def456Ghi7/shares'))
      .toBe('/api/v1/artifacts/Abc123Def456Ghi7/shares')
    expect(redactArtifactSharePath('/chats/artifacts')).toBe('/chats/artifacts')
    expect(redactArtifactSharePath('/artifacts')).toBe('/artifacts')
  })

  it('redacts a browser-ingested error that carries the page address', () => {
    const context = {
      request: { method: 'POST', path: '/api/_evlog/ingest' },
      headers: { 'cf-ray': 'ray-2' },
      event: {
        source: 'client',
        level: 'error',
        message: `Unhandled error on https://besidka.com/artifacts/${TOKEN}`,
        attributes: {
          clientError: {
            route: `/artifacts/${TOKEN}`,
            stack: `at onMounted (https://besidka.com/artifacts/${TOKEN}:1:1)`,
          },
          client: { href: `https://besidka.com/artifacts/${TOKEN}` },
        },
      } as Record<string, unknown>,
    }

    enrich(context)

    expect(JSON.stringify(context)).not.toContain(TOKEN)
    expect(context.event.attributes).toMatchObject({
      clientError: { route: '/artifacts/[token]' },
      client: { href: 'https://besidka.com/artifacts/[token]' },
    })
  })

  it('keeps the token out of every drained field of a page request', () => {
    const context = {
      request: { method: 'GET', path: `/artifacts/${TOKEN}` },
      headers: { 'x-besidka-artifact-share': TOKEN, 'cf-ray': 'ray-1' },
      event: {
        path: `/artifacts/${TOKEN}`,
        error: {
          message: `Render failed for /artifacts/${TOKEN}`,
          stack: `at render (/artifacts/${TOKEN})`,
        },
        attributes: { client: { url: `https://besidka.com/artifacts/${TOKEN}#top` } },
      } as Record<string, unknown>,
    }

    enrich(context)

    expect(context.event).toMatchObject({
      path: '/artifacts/[token]',
      message: 'GET /artifacts/[token]',
      requestMeta: { cfRay: 'ray-1' },
    })
    expect(context.request.path).toBe('/artifacts/[token]')
    expect(JSON.stringify(context.event)).not.toContain(TOKEN)
    expect(JSON.stringify(context.event)).not.toContain(
      'x-besidka-artifact-share',
    )
    expect(context.headers).toEqual({ 'cf-ray': 'ray-1' })
    expect(JSON.stringify(context)).not.toContain(TOKEN)
  })
})

describe('artifact viewer storage key redaction', () => {
  const KEY = 'jane.doe@example.com'

  it('keeps the storage key out of every drained field', () => {
    const context = {
      request: {
        method: 'PUT',
        path: `/api/v1/artifacts/ArtifactId1/storage/${KEY}`,
      },
      headers: {},
      event: {
        path: `/api/v1/artifacts/ArtifactId1/storage/${KEY}`,
        error: {
          message: `Failed /api/v1/artifacts/ArtifactId1/storage/${KEY}`,
        },
      } as Record<string, unknown>,
    }

    enrich(context)

    expect(context.event).toMatchObject({
      path: '/api/v1/artifacts/ArtifactId1/storage/[key]',
      message: 'PUT /api/v1/artifacts/ArtifactId1/storage/[key]',
    })
    expect(context.request.path)
      .toBe('/api/v1/artifacts/ArtifactId1/storage/[key]')
    expect(JSON.stringify(context)).not.toContain(KEY)
  })

  it('strips a query string after the key and leaves other paths alone', () => {
    const context = {
      request: {
        method: 'DELETE',
        path: `/api/v1/artifacts/ArtifactId1/storage/${KEY}?x=1`,
      },
      headers: {},
      event: {} as Record<string, unknown>,
    }

    enrich(context)

    expect(context.event.message)
      .toBe('DELETE /api/v1/artifacts/ArtifactId1/storage/[key]')

    const other = {
      request: { method: 'GET', path: '/api/v1/artifacts/ArtifactId1/storage' },
      headers: {},
      event: {} as Record<string, unknown>,
    }

    enrich(other)

    expect(other.event.message)
      .toBe('GET /api/v1/artifacts/ArtifactId1/storage')
  })
})
