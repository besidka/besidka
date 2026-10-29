import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MCP_OAUTH_SCOPES } from '#shared/utils/mcp-oauth-scopes'

const mocks = vi.hoisted(() => {
  return {
    runtimeConfig: { public: { baseUrl: 'https://besidka.com' } },
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

function createEvent(origin = 'https://preview.besidka.dev') {
  return {
    url: new URL(`${origin}/auth.md`),
    res: { headers: new Headers() },
  }
}

async function callRoute(event: ReturnType<typeof createEvent>) {
  const siteOrigin = await import('~~/server/utils/agent-discovery/site-origin')

  vi.stubGlobal('getSiteOrigin', siteOrigin.getSiteOrigin)

  const { default: handler } = await import('~~/server/routes/auth.md.get')

  return (handler as (event: unknown) => unknown)(event) as string
}

describe('GET /auth.md', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.runtimeConfig = { public: { baseUrl: 'https://besidka.com' } }
  })

  it('serves markdown with open CORS and a one hour cache', async () => {
    const event = createEvent()

    await callRoute(event)

    expect(event.res.headers.get('content-type'))
      .toBe('text/markdown; charset=utf-8')
    expect(event.res.headers.get('access-control-allow-origin')).toBe('*')
    expect(event.res.headers.get('cache-control'))
      .toBe('public, max-age=3600')
  })

  it('opens with an H1 that contains auth.md', async () => {
    const body = await callRoute(createEvent())

    expect(body.split('\n')[0]).toBe('# Besidka auth.md')
  })

  it('states that agentic registration is not supported', async () => {
    const body = await callRoute(createEvent())

    expect(body).toContain('does not implement agentic registration')
    expect(body).toContain('no `agent_auth` block')
    expect(body).toContain('authorization code with PKCE (S256)')
  })

  it('links the OAuth endpoints on the configured origin', async () => {
    const body = await callRoute(createEvent())

    expect(body).toContain(
      'https://besidka.com/.well-known/oauth-protected-resource/mcp',
    )
    expect(body).toContain(
      'https://besidka.com/.well-known/oauth-authorization-server',
    )
    expect(body).toContain('https://besidka.com/api/auth/oauth2/register')
    expect(body).toContain('https://besidka.com/oauth/consent')
    expect(body).not.toContain('preview.besidka.dev')
  })

  it('lists every scope the authorization server offers', async () => {
    const body = await callRoute(createEvent())

    for (const scope of MCP_OAUTH_SCOPES) {
      expect(body).toContain(`\`${scope}\``)
    }
  })

  it('falls back to the request origin when no base URL is configured',
    async () => {
      mocks.runtimeConfig = { public: { baseUrl: '' } }

      const body = await callRoute(createEvent('https://preview.besidka.dev'))

      expect(body).toContain('https://preview.besidka.dev/mcp')
      expect(body).not.toContain('https://besidka.com')
    })
})
