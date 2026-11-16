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
    const segment = name.split('/').at(-1) ?? name

    await testDb.db.insert(schema.mcpRegistryServers).values({
      id: `${name}@1.0.0`,
      name,
      title: segment.charAt(0).toUpperCase() + segment.slice(1),
      description: `The ${segment} server for the tests`,
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

  function names(result: { items: Array<{ name: string }> }) {
    return result.items
      .map(item => item.name)
      .filter(name => !name.startsWith('preset/'))
  }

  beforeEach(async () => {
    const { resetDirectoryIndexMemo } = await import(
      '~~/server/utils/connectors/directory-index'
    )

    resetDirectoryIndexMemo()
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
    ['an unknown category', { category: 'weather-control' }],
    ['an unknown view', { view: 'popular' }],
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
      description: 'Take notes and keep them in one place',
      remoteUrl: 'https://mcp.notes.example.com/mcp',
      headerNames: ['Authorization'],
    })

    const result = await search({ q: 'notes' })

    expect(result.items[0]).toEqual({
      id: 'io.example/notes@1.0.0',
      name: 'io.example/notes',
      title: 'Notes',
      description: 'Take notes and keep them in one place',
      remoteUrl: 'https://mcp.notes.example.com/mcp',
      host: 'mcp.notes.example.com',
      authHint: 'header',
      presetId: null,
      publisher: 'example.io',
      isOfficial: false,
      isCurated: false,
      category: 'docs-knowledge',
      isAdded: false,
      addedConnectorId: null,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('marks an entry whose URL equals a preset and gives it its curated '
    + 'title', async () => {
    await addServer('app.linear/linear', {
      title: null,
      remoteUrl: 'https://mcp.linear.app/mcp',
    })

    expect((await search({ q: 'linear' })).items[0]).toMatchObject({
      title: 'Linear',
      presetId: 'linear',
      isOfficial: true,
      isCurated: true,
    })
  })

  it('ranks title, title prefix, title words, name, then description', async () => {
    await addServer('io.example/zz-description', {
      title: 'Zeta',
      description: 'Works with gamma rays and more',
    })
    await addServer('io.example/gamma-name', { title: 'Something' })
    await addServer('io.example/words', { title: 'Big Gamma Tool' })
    await addServer('io.example/prefix', { title: 'Gammatron' })
    await addServer('io.example/exact', { title: 'Gamma' })
    await addServer('io.example/deleted-gamma', { status: 'deleted' })

    expect(names(await search({ q: 'gamma' }))).toEqual([
      'io.example/exact',
      'io.example/prefix',
      'io.example/words',
      'io.example/gamma-name',
      'io.example/zz-description',
    ])
  })

  it('ignores accents, case and a missing space or hyphen', async () => {
    await addServer('io.example/verif', { title: 'Vérif Entreprise' })
    await addServer('io.example/hf', { title: 'Hugging-Face Hub' })

    expect(names(await search({ q: 'VERIF' }))).toEqual(['io.example/verif'])
    expect(names(await search({ q: 'huggingface' }))).toEqual(['io.example/hf'])
    expect(names(await search({ q: 'hugging face' }))).toEqual(['io.example/hf'])
  })

  it('treats percent, underscore and backslash as plain text', async () => {
    await addServer('io.example/plain', { title: 'Plain thing' })

    expect((await search({ q: '%%' })).items).toEqual([])
    expect((await search({ q: '__' })).items).toEqual([])
    expect((await search({ q: '\\x' })).items).toEqual([])
  })

  it('hides entries without a title or with a short description, and '
    + 'collapses duplicate addresses', async () => {
    await addServer('io.example/untitled', { title: null })
    await addServer('io.example/short', { description: 'Too short' })
    await addServer('io.example/tunnel', {
      remoteUrl: 'https://abc.trycloudflare.com/mcp',
    })
    await addServer('io.example/first', {
      remoteUrl: 'https://mcp.same.example.com/mcp',
    })
    await addServer('com.example/second', {
      remoteUrl: 'https://mcp.same.example.com/mcp/',
      registryUpdatedAt: new Date(1000),
    })

    expect(names(await search({ q: 'io.example' }))).toEqual([])
    expect(names(await search())).toEqual(['com.example/second'])
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
    expect(first.total).toBe(REGISTRY_SEARCH_PAGE_SIZE + 5)

    const second = await search({
      q: 'tool',
      cursor: String(first.nextCursor),
    })

    expect(second.items).toHaveLength(5)
    expect(second.total).toBeNull()
    expect(second.nextCursor).toBeNull()
    expect(second.items[0].name).toBe('io.example/tool-20')
  })

  it('bounds the cursor at the cap', async () => {
    await addServer('io.example/one')

    expect((await search({ cursor: String(REGISTRY_SEARCH_MAX_CURSOR) }))
      .items).toEqual([])
    expect((await failureOf(search({
      cursor: String(REGISTRY_SEARCH_MAX_CURSOR + 1),
    }))).status).toBe(400)
  })

  describe('views', () => {
    it('lists curated entries first, then letter titles before symbols', async () => {
      await addServer('io.example/zebra', { title: 'Zebra' })
      await addServer('io.example/alpha', { title: 'alpha' })
      await addServer('io.example/symbol', { title: '$Symbol' })
      await addServer('com.notion/mcp', {
        title: null,
        remoteUrl: 'https://mcp.notion.com/mcp',
        description: 'Official Notion MCP server',
      })

      const result = await search()

      expect(result.items.map(item => item.title)).toEqual([
        'GitHub',
        'Notion',
        'alpha',
        'Zebra',
        '$Symbol',
      ])
    })

    it('lists Top as the curated list and New by registry update time', async () => {
      await addServer('io.example/old', {
        registryUpdatedAt: new Date(1_000_000),
      })
      await addServer('io.example/fresh', {
        registryUpdatedAt: new Date(9_000_000),
      })
      await addServer('com.figma.mcp/mcp', {
        title: 'Figma MCP Server',
        remoteUrl: 'https://mcp.figma.com/mcp',
        registryUpdatedAt: new Date(0),
      })

      expect((await search({ view: 'top' })).items.map(item => item.title))
        .toEqual(['GitHub', 'Figma'])
      expect(names(await search({ view: 'new' })))
        .toEqual(['io.example/fresh', 'io.example/old'])
    })

    it('lists one category and searches inside it', async () => {
      await addServer('io.example/pay', {
        title: 'Invoice helper',
        description: 'Send invoices and track payments',
      })
      await addServer('io.example/repo', {
        title: 'Repo helper',
        description: 'Review pull requests in your repository',
      })

      expect(names(await search({ category: 'finance-payments' })))
        .toEqual(['io.example/pay'])
      expect(names(await search({ q: 'helper', category: 'developer-tools' })))
        .toEqual(['io.example/repo'])
    })
  })

  describe('isAdded', () => {
    async function addUserConnector(url: string, owner: number = userId) {
      const { createConnector } = await import(
        '~~/server/utils/connectors/store'
      )

      return await createConnector(testDb.db, {
        userId: owner,
        title: 'Mine',
        url,
        slugBase: 'mine',
        createdVia: 'app',
      })
    }

    it('marks only an entry whose address the user has, with its id', async () => {
      await addServer('io.example/one', {
        remoteUrl: 'https://mcp.gateway.example.com/one',
      })
      await addServer('io.example/two', {
        remoteUrl: 'https://mcp.gateway.example.com/two',
      })

      const connector = await addUserConnector(
        'https://mcp.gateway.example.com/one',
      )
      const result = await search({ q: 'io.example' })

      expect(result.items.map(item => [
        item.name,
        item.isAdded,
        item.addedConnectorId,
      ])).toEqual([
        ['io.example/one', true, connector.id],
        ['io.example/two', false, null],
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

  it('limits each user to 60 directory requests a minute', async () => {
    await addServer('io.example/linear')

    for (let count = 0; count < REGISTRY_SEARCHES_PER_MINUTE; count++) {
      await search({ q: 'linear' })
    }

    const blocked = await failureOf(search({ q: 'linear' }))

    expect(blocked.status).toBe(429)

    userId = await seedUser(testDb.db, null)

    expect(names(await search({ q: 'linear' }))).toHaveLength(1)
  })
})
