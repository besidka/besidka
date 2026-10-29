import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    url: new URL(`${origin}/.well-known/ai-catalog.json`),
    res: { headers: new Headers() },
  }
}

async function callRoute(event: ReturnType<typeof createEvent>) {
  const siteOrigin = await import('~~/server/utils/agent-discovery/site-origin')

  vi.stubGlobal('getSiteOrigin', siteOrigin.getSiteOrigin)
  vi.stubGlobal('getSiteHostname', siteOrigin.getSiteHostname)
  vi.stubGlobal('getSiteDidWebIdentifier', siteOrigin.getSiteDidWebIdentifier)

  const { default: handler } = await import(
    '~~/server/routes/.well-known/ai-catalog.json.get'
  )
  const body = await (handler as (event: unknown) => unknown)(event)

  return JSON.parse(body as string)
}

describe('GET /.well-known/ai-catalog.json', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.runtimeConfig = { public: { baseUrl: 'https://besidka.com' } }
  })

  it('serves the ARD media type with open CORS', async () => {
    const event = createEvent()

    await callRoute(event)

    expect(event.res.headers.get('content-type'))
      .toBe('application/ai-catalog+json; charset=utf-8')
    expect(event.res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('derives the host identifier from the configured site URL', async () => {
    const catalog = await callRoute(createEvent())

    expect(catalog.specVersion).toBe('1.0')
    expect(catalog.host).toEqual({
      displayName: 'Besidka',
      identifier: 'did:web:besidka.com',
    })
  })

  it('lists the skills index, llms.txt and the MCP card as absolute URLs',
    async () => {
      const catalog = await callRoute(createEvent())
      const urls = catalog.entries.map((entry: { url: string }) => {
        return entry.url
      })

      expect(urls).toEqual([
        'https://besidka.com/.well-known/agent-skills/index.json',
        'https://besidka.com/llms.txt',
        'https://besidka.com/.well-known/mcp/server-card.json',
      ])
    })

  it('describes the MCP server entry', async () => {
    const catalog = await callRoute(createEvent())
    const entry = catalog.entries[2]

    expect(entry.identifier).toBe('urn:air:besidka.com:mcp:besidka')
    expect(entry.type).toBe('application/json')
    expect(entry.displayName).toContain('OAuth-protected')
    expect(entry.representativeQueries).toContain(
      'Which models does Besidka support and what do they cost?',
    )
  })

  it('gives every entry a urn:air identifier, a media type and 2 to 5 queries',
    async () => {
      const catalog = await callRoute(createEvent())

      expect(catalog.entries.length).toBeGreaterThan(0)

      for (const entry of catalog.entries) {
        expect(entry.identifier)
          .toMatch(/^urn:air:besidka\.com:[a-z-]+:[a-z-]+$/)
        expect(entry.displayName).toBeTruthy()
        expect(entry.type).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/)
        expect(entry.representativeQueries.length).toBeGreaterThanOrEqual(2)
        expect(entry.representativeQueries.length).toBeLessThanOrEqual(5)
      }
    })

  it('falls back to the request origin when no base URL is configured',
    async () => {
      mocks.runtimeConfig = { public: { baseUrl: '' } }

      const catalog = await callRoute(createEvent('https://preview.besidka.dev'))

      expect(catalog.host.identifier).toBe('did:web:preview.besidka.dev')
      expect(catalog.entries[1].url)
        .toBe('https://preview.besidka.dev/llms.txt')
    })

  it('percent-encodes a port in the did:web identifier', async () => {
    mocks.runtimeConfig = { public: { baseUrl: '' } }

    const catalog = await callRoute(createEvent('http://localhost:3000'))

    expect(catalog.host.identifier).toBe('did:web:localhost%3A3000')
    expect(catalog.entries[0].identifier)
      .toBe('urn:air:localhost:skills:index')
  })
})
