import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    runtimeConfig: { public: { baseUrl: 'https://besidka.com' } },
    handler: vi.fn(),
  }
})

vi.mock('#app/nuxt', () => {
  return {
    useRuntimeConfig: () => {
      return mocks.runtimeConfig
    },
  }
})

vi.mock('nuxt/server', () => {
  return {
    defineEventHandler: (handler: unknown) => {
      return handler
    },
  }
})

const betterAuthMetadata = {
  resource: 'https://besidka.com/mcp',
  authorization_servers: ['https://besidka.com'],
  scopes_supported: ['openid', 'chats:read'],
  bearer_methods_supported: ['header'],
}

function createEvent() {
  return {
    req: new Request('https://besidka.com/.well-known/oauth-protected-resource'),
  }
}

async function callRoute(event: ReturnType<typeof createEvent>) {
  vi.stubGlobal('useServerAuth', () => {
    return { handler: mocks.handler }
  })
  vi.stubGlobal('useRuntimeConfig', () => {
    return mocks.runtimeConfig
  })

  const { default: handler } = await import(
    '~~/server/routes/.well-known/oauth-protected-resource/index.get'
  )

  return (handler as (event: unknown) => Promise<Response>)(event)
}

describe('GET /.well-known/oauth-protected-resource', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.runtimeConfig = { public: { baseUrl: 'https://besidka.com' } }
    mocks.handler.mockReset()
    mocks.handler.mockResolvedValue(
      Response.json(betterAuthMetadata, {
        headers: { 'cache-control': 'public, max-age=900' },
      }),
    )
  })

  it('sets the resource to the site origin and keeps the rest', async () => {
    const response = await callRoute(createEvent())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ...betterAuthMetadata,
      resource: 'https://besidka.com',
    })
  })

  it('keeps the content-type and cache headers', async () => {
    const response = await callRoute(createEvent())

    expect(response.headers.get('content-type'))
      .toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('public, max-age=900')
  })

  it('forwards the original request to Better Auth', async () => {
    const event = createEvent()

    await callRoute(event)

    expect(mocks.handler).toHaveBeenCalledWith(event.req)
  })

  it('normalises a configured site URL with a path to its origin', async () => {
    mocks.runtimeConfig = {
      public: { baseUrl: 'https://preview.besidka.dev/' },
    }

    const response = await callRoute(createEvent())

    expect((await response.json()).resource)
      .toBe('https://preview.besidka.dev')
  })

  it('falls back to the production origin without a site URL', async () => {
    mocks.runtimeConfig = { public: { baseUrl: '' } }

    const response = await callRoute(createEvent())

    expect((await response.json()).resource).toBe('https://besidka.com')
  })

  it('passes a non-200 response through unchanged', async () => {
    const upstream = new Response('nope', { status: 404 })

    mocks.handler.mockResolvedValue(upstream)

    expect(await callRoute(createEvent())).toBe(upstream)
  })

  it('passes a non-JSON response through unchanged', async () => {
    const upstream = new Response('<html></html>', {
      headers: { 'content-type': 'text/html' },
    })

    mocks.handler.mockResolvedValue(upstream)

    expect(await callRoute(createEvent())).toBe(upstream)
  })

  it('passes an unparseable JSON body through unchanged', async () => {
    const upstream = new Response('{broken', {
      headers: { 'content-type': 'application/json' },
    })

    mocks.handler.mockResolvedValue(upstream)

    expect(await callRoute(createEvent())).toBe(upstream)
  })
})
