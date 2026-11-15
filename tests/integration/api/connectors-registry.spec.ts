import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REGISTRY_SEARCH_PAGE_SIZE,
  REGISTRY_SEARCHES_PER_MINUTE,
} from '#shared/utils/connectors-policy'
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
import { createFakeConnectorKv } from '../../setup/helpers/connectors-oauth'

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

const ROUTE = '~~/server/api/v1/connectors/registry/index.get'

type Handler = (event: SkillsRouteEvent) => Promise<any>

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number }
  }

  throw new Error('Expected a rejection')
}

describe('GET /api/v1/connectors/registry', () => {
  let testDb: MemoryExtractionTestDb
  let kv: ReturnType<typeof createFakeConnectorKv>
  let userId: number

  async function addServer(
    name: string,
    patch: Partial<typeof schema.mcpRegistryServers.$inferInsert> = {},
  ) {
    await testDb.db.insert(schema.mcpRegistryServers).values({
      id: `${name}@1.0.0`,
      name,
      title: null,
      description: `${name} description`,
      remoteUrl: `https://mcp.${name.replace(/\W/g, '-')}.example.com/mcp`,
      remoteType: 'streamable-http',
      headerNames: [],
      status: 'active',
      registryUpdatedAt: new Date(0),
      syncedAt: new Date(0),
      ...patch,
    })
  }

  async function search(query: Record<string, string> = {}) {
    const run = (await import(ROUTE)).default as Handler

    return await run(createSkillsRouteEvent({ query }))
  }

  beforeEach(async () => {
    mocks.flags = new Set(['connectors', 'connectors.registry'])
    testDb = createMemoryExtractionTestDb()
    kv = createFakeConnectorKv()
    userId = await seedUser(testDb.db, null)
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

  it('answers 404 when the registry flag is off', async () => {
    await addServer('io.example/linear')
    mocks.flags.delete('connectors.registry')

    expect((await failureOf(search({ q: 'linear' }))).status).toBe(404)
  })

  it('answers 401 without a session, before checking the flag', async () => {
    mocks.flags.clear()
    vi.stubGlobal('useUserSession', async () => null)

    expect((await failureOf(search({ q: 'linear' }))).status).toBe(401)
  })

  it.each([
    ['missing', {}],
    ['too short', { q: 'a' }],
    ['blank', { q: '   ' }],
    ['too long', { q: 'x'.repeat(65) }],
    ['a bad cursor', { q: 'linear', cursor: '-1' }],
    ['a huge cursor', { q: 'linear', cursor: '999999' }],
    ['a text cursor', { q: 'linear', cursor: 'abc' }],
  ])('answers 400 for %s', async (_label, query) => {
    expect((await failureOf(search(query as Record<string, string>))).status)
      .toBe(400)
  })

  it('answers syncing when the table is empty', async () => {
    expect(await search({ q: 'linear' })).toEqual({
      items: [],
      nextCursor: null,
      syncing: true,
    })
  })

  it('answers no items and no syncing when nothing matches', async () => {
    await addServer('io.example/linear')

    expect(await search({ q: 'zzzz' })).toEqual({
      items: [],
      nextCursor: null,
    })
  })

  it('returns safe fields and no live registry call', async () => {
    const fetchSpy = vi.fn()

    vi.stubGlobal('fetch', fetchSpy)
    await addServer('io.example/notes', {
      title: 'Notes',
      description: 'Take notes',
      remoteUrl: 'https://mcp.notes.example.com/mcp',
      headerNames: ['Authorization'],
    })
    await addServer('io.example/open', {
      title: 'Notes open',
      remoteUrl: 'https://mcp.open.example.com/mcp',
    })

    const result = await search({ q: 'notes' })

    expect(result.items).toEqual([
      {
        id: 'io.example/notes@1.0.0',
        name: 'io.example/notes',
        title: 'Notes',
        description: 'Take notes',
        remoteUrl: 'https://mcp.notes.example.com/mcp',
        transport: 'streamable-http',
        authHint: 'header',
        presetId: null,
      },
      expect.objectContaining({
        name: 'io.example/open',
        authHint: 'unknown',
      }),
    ])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('marks an entry whose URL equals a preset', async () => {
    await addServer('app.linear/linear', {
      title: 'Linear',
      remoteUrl: 'https://mcp.linear.app/mcp',
    })

    expect((await search({ q: 'linear' })).items[0]).toMatchObject({
      presetId: 'linear',
    })
  })

  it('ranks exact name, exact title, prefix, substring, then description', async () => {
    await addServer('io.example/zz-description', {
      title: 'Zeta',
      description: 'works with gamma too',
    })
    await addServer('io.example/contains-gamma-inside', { title: 'Inside' })
    await addServer('io.example/gamma-prefix', { title: 'Prefix' })
    await addServer('io.example/other', { title: 'gamma' })
    await addServer('io.example/gamma', { title: 'Zebra' })
    await addServer('io.example/deleted-gamma', { status: 'deleted' })

    const result = await search({ q: 'Gamma' })

    expect(result.items.map(item => item.name)).toEqual([
      'io.example/gamma',
      'io.example/other',
      'io.example/gamma-prefix',
      'io.example/contains-gamma-inside',
      'io.example/zz-description',
    ])
  })

  it('treats percent, underscore and backslash literally', async () => {
    await addServer('io.example/100-percent', { description: 'up to 100% off' })
    await addServer('io.example/snake', { description: 'a_b and a\\b' })
    await addServer('io.example/plain', { description: 'axb axxb' })

    expect((await search({ q: '100%' })).items.map(item => item.name))
      .toEqual(['io.example/100-percent'])
    expect((await search({ q: 'a_b' })).items.map(item => item.name))
      .toEqual(['io.example/snake'])
    expect((await search({ q: 'a\\b' })).items.map(item => item.name))
      .toEqual(['io.example/snake'])
    expect((await search({ q: '%%' })).items).toEqual([])
    expect((await search({ q: '__' })).items).toEqual([])
  })

  it('pages with an integer cursor, 20 per page', async () => {
    for (let index = 0; index < REGISTRY_SEARCH_PAGE_SIZE + 5; index++) {
      await addServer(`io.example/tool-${String(index).padStart(2, '0')}`, {
        title: `Tool ${String(index).padStart(2, '0')}`,
      })
    }

    const first = await search({ q: 'tool' })

    expect(first.items).toHaveLength(REGISTRY_SEARCH_PAGE_SIZE)
    expect(first.nextCursor).toBe(REGISTRY_SEARCH_PAGE_SIZE)

    const second = await search({
      q: 'tool',
      cursor: String(first.nextCursor),
    })

    expect(second.items).toHaveLength(5)
    expect(second.nextCursor).toBeNull()
    expect(second.items[0].name).toBe('io.example/tool-20')
  })

  it('limits each user to 30 searches a minute', async () => {
    await addServer('io.example/linear')

    for (let count = 0; count < REGISTRY_SEARCHES_PER_MINUTE; count++) {
      await search({ q: 'linear' })
    }

    const blocked = await failureOf(search({ q: 'linear' }))

    expect(blocked.status).toBe(429)

    userId = await seedUser(testDb.db, null)

    expect((await search({ q: 'linear' })).items).toHaveLength(1)
  })
})
