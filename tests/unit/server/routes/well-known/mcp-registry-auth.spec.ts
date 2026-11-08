import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MCP_REGISTRY_PUBLIC_KEY } from '~~/config/mcp-server'

vi.mock('nuxt/server', () => {
  return {
    defineEventHandler: (handler: unknown) => {
      return handler
    },
  }
})

function createEvent() {
  return {
    url: new URL('https://besidka.com/.well-known/mcp-registry-auth'),
    res: { headers: new Headers() },
  }
}

async function callRoute(event: ReturnType<typeof createEvent>) {
  const { default: handler } = await import(
    '~~/server/routes/.well-known/mcp-registry-auth.get'
  )

  return (handler as (event: unknown) => unknown)(event) as string
}

describe('GET /.well-known/mcp-registry-auth', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('serves plain text that is cacheable for an hour', async () => {
    const event = createEvent()

    await callRoute(event)

    expect(event.res.headers.get('content-type'))
      .toBe('text/plain; charset=utf-8')
    expect(event.res.headers.get('cache-control'))
      .toBe('public, max-age=3600')
  })

  it('serves the MCP Registry DNS-style proof without a trailing newline',
    async () => {
      const body = await callRoute(createEvent())

      expect(body).toBe(
        'v=MCPv1; k=ed25519; p=U7zqIcZTIY1E3EQXsOqYxriQ/shVOnJePLONkfe97E0=',
      )
    })

  it('pins the published Ed25519 public key as 32 raw bytes', () => {
    const rawKey = Buffer.from(MCP_REGISTRY_PUBLIC_KEY, 'base64')

    expect(rawKey.byteLength).toBe(32)
    expect(rawKey.toString('base64')).toBe(MCP_REGISTRY_PUBLIC_KEY)
  })
})
