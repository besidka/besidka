import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONNECTOR_ICON_ROUTES_PER_MINUTE } from '#shared/utils/connectors-policy'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { createSkillsRouteEvent } from '../../setup/helpers/skills-route'
import type { SkillsRouteEvent } from '../../setup/helpers/skills-route'
import {
  PNG_BYTES,
  createFakeIconKv,
} from '../../setup/helpers/connector-icon-kv'
import type { FakeIconKv } from '../../setup/helpers/connector-icon-kv'

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

vi.mock('nuxt/server', async () => {
  const { connectorsNuxtServerMockFactory } = await import(
    '../../setup/helpers/connectors-oauth'
  )

  return await connectorsNuxtServerMockFactory()
})

vi.mock('~~/server/utils/features/guards', () => ({
  requireFeature: async (_event: unknown, flag: string) => {
    if (!mocks.flags.has(flag)) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }

    return { active: true }
  },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: vi.fn() }),
}))

const ROUTE = '~~/server/api/v1/connectors/registry/icon.get'
const ENTRY_ID = 'app.linear/linear@1.0.2'

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number }
  }

  throw new Error('Expected a rejection')
}

function jsonBody(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })
}

describe('GET /api/v1/connectors/registry/icon', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeIconKv
  let userId: number
  const fetchMock = vi.fn()

  function requestedUrls(): string[] {
    return fetchMock.mock.calls.map(call => String(call[0]))
  }

  async function addServer(
    patch: Partial<typeof schema.mcpRegistryServers.$inferInsert> = {},
  ) {
    await testDb.db.insert(schema.mcpRegistryServers).values({
      id: ENTRY_ID,
      name: 'app.linear/linear',
      title: 'Linear',
      description: 'Issues',
      remoteUrl: 'https://mcp.linear.app/mcp',
      remoteType: 'streamable-http',
      headerNames: [],
      status: 'active',
      registryUpdatedAt: new Date(0),
      syncedAt: new Date(0),
      ...patch,
    })
  }

  async function request(
    query: Record<string, string> = { id: ENTRY_ID },
  ): Promise<Response> {
    const handler = (await import(ROUTE)).default as (
      event: SkillsRouteEvent,
    ) => Promise<Response>

    return await handler(createSkillsRouteEvent({ query }))
  }

  beforeEach(async () => {
    mocks.flags = new Set(['connectors', 'connectors.registry'])
    testDb = createMemoryExtractionTestDb()
    kv = createFakeIconKv()
    userId = await seedUser(testDb.db, null)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)

      if (url.startsWith('https://registry.modelcontextprotocol.io/')) {
        return jsonBody({
          server: {
            icons: [{
              src: 'https://static.linear.app/icon-256.png',
              mimeType: 'image/png',
            }],
          },
        })
      }

      return new Response(PNG_BYTES)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useUserSession', async () => {
      return { user: { id: String(userId) } }
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('serves the registry icon of an entry with safe headers', async () => {
    await addServer()

    const response = await request()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control'))
      .toBe('private, max-age=86400')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cross-origin-resource-policy'))
      .toBe('same-origin')
    expect(response.headers.get('content-security-policy'))
      .toBe('default-src \'none\'; sandbox')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES)
    expect(requestedUrls()).toEqual([
      'https://registry.modelcontextprotocol.io/v0.1/servers/'
      + 'app.linear%2Flinear/versions/latest',
      'https://static.linear.app/icon-256.png',
    ])
  })

  it('serves an SVG with a CSP that still allows inline styles, and a '
    + 'script SVG never', async () => {
    await addServer()

    const safeSvg = '<svg xmlns="http://www.w3.org/2000/svg">'
      + '<circle r="3" style="fill:#f00"/></svg>'

    fetchMock.mockImplementation(async (input: unknown) => {
      return String(input).startsWith('https://registry.modelcontextprotocol')
        ? jsonBody({ server: { icons: [{ src: 'https://cdn.example.com/a.svg' }] } })
        : new Response(safeSvg)
    })

    const response = await request()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
    expect(response.headers.get('content-security-policy'))
      .toBe('default-src \'none\'; style-src \'unsafe-inline\'; sandbox')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('rejects an SVG with script and answers 404', async () => {
    await addServer()
    fetchMock.mockImplementation(async (input: unknown) => {
      return String(input).startsWith('https://registry.modelcontextprotocol')
        ? jsonBody({ server: { icons: [{ src: 'https://cdn.example.com/a.svg' }] } })
        : new Response(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        )
    })

    expect((await request()).status).toBe(404)
  })

  it('falls back to the favicon of the entry host, taken from the row',
    async () => {
      await addServer()
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = String(input)

        if (url.startsWith('https://registry.modelcontextprotocol.io/')) {
          return jsonBody({ server: {} })
        }

        return url === 'https://mcp.linear.app/favicon.ico'
          ? new Response(PNG_BYTES)
          : new Response('no', { status: 404 })
      })

      const response = await request()

      expect(response.status).toBe(200)
      expect(requestedUrls()).toContain('https://mcp.linear.app/favicon.ico')
    })

  it('asks the network once, then serves the kept copy to anyone', async () => {
    await addServer()
    await request()

    const callsAfterFirst = fetchMock.mock.calls.length

    userId = await seedUser(testDb.db, null)

    const second = await request()

    expect(second.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterFirst)
  })

  it('fetches the host of many entries once', async () => {
    await addServer()
    await addServer({
      id: 'app.linear/other@1.0.0',
      name: 'app.linear/other',
      remoteUrl: 'https://mcp.linear.app/other',
    })
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)

      if (url.startsWith('https://registry.modelcontextprotocol.io/')) {
        return jsonBody({ server: {} })
      }

      return url === 'https://mcp.linear.app/favicon.ico'
        ? new Response(PNG_BYTES)
        : new Response('no', { status: 404 })
    })

    expect((await request()).status).toBe(200)

    const hostCalls = () => requestedUrls().filter((url) => {
      return url.startsWith('https://mcp.linear.app/')
    }).length
    const callsAfterFirst = hostCalls()

    expect((await request({ id: 'app.linear/other@1.0.0' })).status)
      .toBe(200)
    expect(hostCalls()).toBe(callsAfterFirst)
  })

  it('answers a cacheable 404 and keeps a miss when nothing resolves',
    async () => {
      await addServer()
      fetchMock.mockImplementation(async (input: unknown) => {
        return String(input).startsWith('https://registry.modelcontextprotocol')
          ? jsonBody({ server: {} })
          : new Response('no', { status: 404 })
      })

      const response = await request()

      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control'))
        .toBe('private, max-age=3600')

      const callsAfterFirst = fetchMock.mock.calls.length

      await request()

      expect(fetchMock).toHaveBeenCalledTimes(callsAfterFirst)
    })

  it('answers 404 without any request for an unknown or inactive id',
    async () => {
      await addServer({ status: 'deleted' })

      expect((await request({ id: 'nope@1.0.0' })).status).toBe(404)
      expect((await request()).status).toBe(404)
      expect(fetchMock).not.toHaveBeenCalled()
    })

  it('never takes a host or URL from the request', async () => {
    await addServer()

    const response = await request({
      id: 'evil.example@1.0.0',
      host: 'evil.example',
      url: 'https://evil.example/icon.png',
    })

    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 400 for a missing or overlong id', async () => {
    expect((await failureOf(request({}))).status).toBe(400)
    expect((await failureOf(request({ id: 'x'.repeat(300) }))).status)
      .toBe(400)
  })

  it('answers 404 when the registry flag is off and 401 without a session',
    async () => {
      await addServer()
      mocks.flags.delete('connectors.registry')

      expect((await failureOf(request())).status).toBe(404)

      vi.stubGlobal('useUserSession', async () => null)

      expect((await failureOf(request())).status).toBe(401)
      expect(fetchMock).not.toHaveBeenCalled()
    })

  it('shares the loose icon rate limit per user', async () => {
    for (let count = 0; count < CONNECTOR_ICON_ROUTES_PER_MINUTE; count++) {
      await request({ id: 'nope@1.0.0' })
    }

    expect((await failureOf(request({ id: 'nope@1.0.0' }))).status).toBe(429)
  })
})
