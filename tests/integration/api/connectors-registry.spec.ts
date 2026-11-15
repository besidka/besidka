import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REGISTRY_SEARCH_MAX_CURSOR,
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
import {
  createFakeConnectorKv,
  fakeDecrypt,
  fakeEncrypt,
} from '../../setup/helpers/connectors-oauth'

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
    vi.stubGlobal('useEncryptText', vi.fn(async (plain: string) => {
      return fakeEncrypt(plain)
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async (cipher: string) => {
      return fakeDecrypt(cipher)
    }))
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
    ['too short', { q: 'a' }],
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
      total: 0,
      syncing: true,
    })
  })

  it('answers no items and no syncing when nothing matches', async () => {
    await addServer('io.example/linear')

    expect(await search({ q: 'zzzz' })).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
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
        publisher: 'Example',
        isAdded: false,
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

  describe('browse mode (no search text)', () => {
    it('lists the directory for a missing or blank q: letter titles, then '
      + 'symbols and untitled, by name ignoring case, no featured presets', async () => {
      await addServer('io.example/zebra', { title: 'Zebra' })
      await addServer('io.example/alpha', { title: 'Alpha' })
      await addServer('io.example/untitled-a')
      await addServer('io.example/symbol', { title: '$Symbol' })
      await addServer('io.example/lower', { title: 'bravo' })
      await addServer('app.linear/linear', {
        title: 'Linear',
        remoteUrl: 'https://mcp.linear.app/mcp',
      })

      const missing = await search()
      const blank = await search({ q: '   ' })

      expect(missing.items.map(item => item.name)).toEqual([
        'io.example/alpha',
        'io.example/lower',
        'io.example/zebra',
        'io.example/symbol',
        'io.example/untitled-a',
      ])
      expect(blank.items.map(item => item.name))
        .toEqual(missing.items.map(item => item.name))
      expect(missing.total).toBe(5)
    })

    it('pages the whole directory and counts only on the first page', async () => {
      for (let index = 0; index < REGISTRY_SEARCH_PAGE_SIZE + 3; index++) {
        await addServer(`io.example/tool-${String(index).padStart(2, '0')}`, {
          title: `Tool ${String(index).padStart(2, '0')}`,
        })
      }

      const first = await search()
      const second = await search({ cursor: String(first.nextCursor) })

      expect(first.items).toHaveLength(REGISTRY_SEARCH_PAGE_SIZE)
      expect(first.total).toBe(REGISTRY_SEARCH_PAGE_SIZE + 3)
      expect(second.items).toHaveLength(3)
      expect(second.total).toBeNull()
      expect(second.nextCursor).toBeNull()
    })

    it('answers syncing for an empty table and 404 when the flag is off', async () => {
      expect(await search()).toMatchObject({ items: [], syncing: true })

      mocks.flags.delete('connectors.registry')

      expect((await failureOf(search())).status).toBe(404)
    })

    it('stops offering Show more where the next cursor would pass the cap',
      async () => {
        const cap = REGISTRY_SEARCH_MAX_CURSOR
        const pageSize = REGISTRY_SEARCH_PAGE_SIZE
        const total = cap + pageSize + 5

        for (let start = 0; start < total; start += 50) {
          await testDb.db.insert(schema.mcpRegistryServers).values(
            Array.from({
              length: Math.min(50, total - start),
            }, (_row, index) => {
              const number = String(start + index).padStart(5, '0')

              return {
                id: `io.example/bulk-${number}@1.0.0`,
                name: `io.example/bulk-${number}`,
                title: `Bulk ${number}`,
                description: 'Bulk entry',
                remoteUrl: `https://mcp.bulk${number}.example.com/mcp`,
                remoteType: 'streamable-http' as const,
                headerNames: [],
                status: 'active',
                registryUpdatedAt: new Date(0),
                syncedAt: new Date(0),
              }
            }),
          )
        }

        const beforeCap = await search({ cursor: String(cap - pageSize) })
        const atCap = await search({ cursor: String(cap) })

        expect(beforeCap.nextCursor).toBe(cap)
        expect(atCap.items).toHaveLength(pageSize)
        expect(atCap.nextCursor).toBeNull()
      })

    it('bounds the cursor at the cap', async () => {
      await addServer('io.example/one')

      expect((await search({ cursor: String(REGISTRY_SEARCH_MAX_CURSOR) }))
        .items).toEqual([])
      expect((await failureOf(search({
        cursor: String(REGISTRY_SEARCH_MAX_CURSOR + 1),
      }))).status).toBe(400)
    })
  })

  describe('isAdded', () => {
    async function addUserConnector(url: string, owner: number = userId) {
      const { createConnector } = await import(
        '~~/server/utils/connectors/store'
      )

      await createConnector(testDb.db, {
        userId: owner,
        title: 'Mine',
        url,
        slugBase: 'mine',
        createdVia: 'app',
      })
    }

    it('marks only an entry whose exact URL the user has', async () => {
      await addServer('io.example/one', {
        remoteUrl: 'https://mcp.gateway.example.com/one',
      })
      await addServer('io.example/two', {
        remoteUrl: 'https://mcp.gateway.example.com/two',
      })
      await addUserConnector('https://mcp.gateway.example.com/one')

      const result = await search({ q: 'io.example' })

      expect(result.items.map(item => [item.name, item.isAdded])).toEqual([
        ['io.example/one', true],
        ['io.example/two', false],
      ])
    })

    it('ignores the connectors of another user', async () => {
      await addServer('io.example/one', {
        remoteUrl: 'https://mcp.gateway.example.com/one',
      })
      await addUserConnector(
        'https://mcp.gateway.example.com/one',
        await seedUser(testDb.db, null),
      )

      expect((await search({ q: 'io.example' })).items[0]?.isAdded)
        .toBe(false)
    })
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
