import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MCP_OAUTH_SCOPES } from '#shared/utils/mcp-oauth-scopes'
import {
  MCP_SERVER_DESCRIPTION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
} from '~~/config/mcp-server'

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
    url: new URL(`${origin}/.well-known/mcp/server-card.json`),
    res: { headers: new Headers() },
  }
}

async function callRoute(event: ReturnType<typeof createEvent>) {
  const siteOrigin = await import('~~/server/utils/agent-discovery/site-origin')

  vi.stubGlobal('getSiteOrigin', siteOrigin.getSiteOrigin)

  const { default: handler } = await import(
    '~~/server/routes/.well-known/mcp/server-card.json.get'
  )
  const body = await (handler as (event: unknown) => unknown)(event)

  return JSON.parse(body as string)
}

describe('GET /.well-known/mcp/server-card.json', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.runtimeConfig = { public: { baseUrl: 'https://besidka.com' } }
  })

  it('serves JSON with open CORS and a one hour cache', async () => {
    const event = createEvent()

    await callRoute(event)

    expect(event.res.headers.get('content-type'))
      .toBe('application/json; charset=utf-8')
    expect(event.res.headers.get('access-control-allow-origin')).toBe('*')
    expect(event.res.headers.get('cache-control'))
      .toBe('public, max-age=3600')
  })

  it('follows the MCP registry server card shape', async () => {
    const card = await callRoute(createEvent())

    expect(card).toEqual({
      $schema:
        'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
      name: 'com.besidka/mcp',
      title: 'Besidka',
      version: MCP_SERVER_VERSION,
      description: MCP_SERVER_DESCRIPTION,
      websiteUrl: 'https://besidka.com',
      repository: { url: 'https://github.com/besidka/besidka', source: 'github' },
      remotes: [
        { type: 'streamable-http', url: 'https://besidka.com/mcp' },
      ],
      _meta: {
        'com.besidka/authorization': expect.any(Object),
      },
    })
    expect(card.name).toBe(MCP_SERVER_NAME)
    expect(card.description.length).toBeLessThanOrEqual(100)
    expect(card.name).toMatch(/^[a-z0-9.-]+\/[a-z0-9._-]+$/)
  })

  it('declares optional OAuth for the per-user tools under a vendor key',
    async () => {
      const card = await callRoute(createEvent())
      const authorization = card._meta['com.besidka/authorization']

      expect(authorization).toMatchObject({
        required: false,
        type: 'oauth2',
        flow: 'authorization_code',
        pkce: 'S256',
        protectedResourceMetadata:
          'https://besidka.com/.well-known/oauth-protected-resource/mcp',
        authorizationServerMetadata:
          'https://besidka.com/.well-known/oauth-authorization-server',
        scopesSupported: [...MCP_OAUTH_SCOPES],
      })
      expect(Object.keys(card._meta)).toEqual(['com.besidka/authorization'])
    })

  it('falls back to the request origin when no base URL is configured',
    async () => {
      mocks.runtimeConfig = { public: { baseUrl: '' } }

      const card = await callRoute(createEvent('https://preview.besidka.dev'))

      expect(card.websiteUrl).toBe('https://preview.besidka.dev')
      expect(card.remotes[0].url).toBe('https://preview.besidka.dev/mcp')
      expect(
        card._meta['com.besidka/authorization'].protectedResourceMetadata,
      ).toBe(
        'https://preview.besidka.dev/.well-known/oauth-protected-resource/mcp',
      )
    })
})
