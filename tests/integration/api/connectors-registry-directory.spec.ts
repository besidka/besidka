import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CURATED_CONNECTORS } from '~~/config/connectors-directory'
import type { CuratedConnector } from '~~/config/connectors-directory'
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

type Handler = (event: SkillsRouteEvent) => Promise<any>

const PRESET_CARDS = (CURATED_CONNECTORS as readonly CuratedConnector[])
  .filter(entry => !!entry.presetId).length

const ROUTES = {
  home: () => import('~~/server/api/v1/connectors/registry/home.get'),
  entry: () => import('~~/server/api/v1/connectors/registry/entry.get'),
  tools: () => import('~~/server/api/v1/connectors/registry/tools.get'),
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number }
  }

  throw new Error('Expected a rejection')
}

function requestUrl(input: unknown): string {
  return input instanceof Request ? input.url : String(input)
}

describe('connector directory routes', () => {
  let testDb: MemoryExtractionTestDb
  let kv: ReturnType<typeof createFakeConnectorKv>
  let userId: number
  const fetchMock = vi.fn()

  async function addServer(
    name: string,
    patch: Partial<typeof schema.mcpRegistryServers.$inferInsert> = {},
  ) {
    await testDb.db.insert(schema.mcpRegistryServers).values({
      id: `${name}@1.0.0`,
      name,
      title: name.split('/').at(-1) ?? name,
      description: 'Send invoices and track the payments of a team',
      remoteUrl: `https://mcp.${name.replace(/\W/g, '-')}.example.com/mcp`,
      remoteType: 'streamable-http',
      headerNames: [],
      status: 'active',
      registryUpdatedAt: new Date(0),
      syncedAt: new Date(0),
      ...patch,
    })
  }

  async function call(
    route: keyof typeof ROUTES,
    query: Record<string, string> = {},
  ) {
    const run = (await ROUTES[route]()).default as Handler

    return await run(createSkillsRouteEvent({ query }))
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
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
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

  describe('GET /registry/home', () => {
    it('answers Top, New and the categories with their counts', async () => {
      await addServer('com.notion/mcp', {
        title: null,
        remoteUrl: 'https://mcp.notion.com/mcp',
        description: 'Official Notion MCP server',
      })

      for (let index = 0; index < 8; index++) {
        await addServer(`io.example/pay-${index}`, {
          registryUpdatedAt: new Date(index * 1000),
        })
      }

      const home = await call('home')

      expect(home.top.map((item: { title: string }) => item.title))
        .toEqual(['GitHub', 'Notion', 'Stripe', 'Vercel', 'Supabase', 'Sentry'])
      expect(home.topCount).toBe(PRESET_CARDS + 1)
      expect(home.new).toHaveLength(6)
      expect(home.new[0].name).toBe('io.example/pay-7')
      expect(home.newCount).toBe(7)

      const finance = home.categories.find((category: { id: string }) => {
        return category.id === 'finance-payments'
      })

      expect(finance.label).toBe('Finance & payments')
      expect(finance.count).toBeGreaterThanOrEqual(8)
      expect(finance.count).toBeLessThanOrEqual(8 + PRESET_CARDS)
      expect(finance.items).toHaveLength(6)
      expect(home.total).toBe(9 + PRESET_CARDS)
      expect(home.syncing).toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('answers syncing for an empty mirror and 404 without the flag', async () => {
      expect(await call('home')).toMatchObject({ syncing: true })

      mocks.flags.delete('connectors.registry')

      expect((await failureOf(call('home'))).status).toBe(404)
    })

    it('reads the index from KV after the first build', async () => {
      const { DIRECTORY_INDEX_KEY, resetDirectoryIndexMemo } = await import(
        '~~/server/utils/connectors/directory-index'
      )

      await addServer('io.example/pay')
      await call('home')

      expect(kv.values.has(DIRECTORY_INDEX_KEY)).toBe(true)

      resetDirectoryIndexMemo()
      await testDb.db.delete(schema.mcpRegistryServers)

      expect((await call('home')).total).toBe(1 + PRESET_CARDS)
    })
  })

  describe('GET /registry/entry', () => {
    it('answers the entry with its category label and no probe yet', async () => {
      await addServer('io.example/pay')

      const detail = await call('entry', { id: 'io.example/pay@1.0.0' })

      expect(detail).toMatchObject({
        item: { id: 'io.example/pay@1.0.0', category: 'finance-payments' },
        categoryLabel: 'Finance & payments',
        probe: null,
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('knows a key is needed from the declared header names', async () => {
      await addServer('io.example/keyed', { headerNames: ['Authorization'] })

      expect((await call('entry', { id: 'io.example/keyed@1.0.0' })).probe)
        .toMatchObject({ authKind: 'header', state: 'needs-auth' })
    })

    it('answers 404 for an entry the directory hides', async () => {
      await addServer('io.example/untitled', { title: null })

      expect((await failureOf(call('entry', {
        id: 'io.example/untitled@1.0.0',
      }))).status).toBe(404)
      expect((await failureOf(call('entry', { id: '' }))).status).toBe(400)
    })
  })

  describe('GET /registry/tools', () => {
    it('never contacts a server that needs a key', async () => {
      await addServer('io.example/keyed', { headerNames: ['X-Api-Key'] })

      expect(await call('tools', { id: 'io.example/keyed@1.0.0' }))
        .toMatchObject({ authKind: 'header', tools: [] })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('probes the stored address once and keeps the answer', async () => {
      await addServer('io.example/pay', {
        remoteUrl: 'https://mcp.pay.example.com/mcp',
      })
      fetchMock.mockImplementation(async (input: unknown) => {
        return requestUrl(input) === 'https://mcp.pay.example.com/mcp'
          ? new Response(null, { status: 401 })
          : new Response('missing', { status: 404 })
      })

      const first = await call('tools', { id: 'io.example/pay@1.0.0' })
      const requests = fetchMock.mock.calls.length
      const second = await call('tools', { id: 'io.example/pay@1.0.0' })

      expect(first).toMatchObject({ authKind: 'header', state: 'needs-auth' })
      expect(second).toEqual(first)
      expect(fetchMock).toHaveBeenCalledTimes(requests)
      expect(fetchMock.mock.calls.every((call) => {
        return requestUrl(call[0]).startsWith('https://mcp.pay.example.com/')
      })).toBe(true)
    })

    it('answers 404 for an unknown id', async () => {
      await addServer('io.example/pay')

      expect((await failureOf(call('tools', { id: 'nope@1.0.0' }))).status)
        .toBe(404)
    })
  })
})
