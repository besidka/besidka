import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { createFakeConnectorKv } from '../../setup/helpers/connectors-oauth'
import {
  pagedRegistryFetch,
  registryEntry,
} from '../../fixtures/mcp-registry/builders'

const mocks = vi.hoisted(() => ({
  isAdmin: true,
  requireAdmin: vi.fn(),
  logger: { set: vi.fn() },
}))

vi.mock('nuxt/server', () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRequestHeader: () => undefined,
  getRequestURL: () => new URL('https://besidka.com/api/v1/admin/connectors'),
}))

vi.mock('~~/server/utils/features/guards', () => ({
  requireAdmin: mocks.requireAdmin,
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

const STATUS_ROUTE = '~~/server/api/v1/admin/connectors/registry/index.get'
const SYNC_ROUTE = '~~/server/api/v1/admin/connectors/registry/sync.post'

type Handler = (event: unknown) => Promise<any>

function createEvent() {
  return { context: {}, res: { headers: new Headers() } }
}

async function callRoute(path: string) {
  return await ((await import(path)).default as Handler)(createEvent())
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number }
  }

  throw new Error('Expected a rejection')
}

describe('admin connector registry routes', () => {
  let testDb: MemoryExtractionTestDb
  let kv: ReturnType<typeof createFakeConnectorKv>

  beforeEach(() => {
    mocks.isAdmin = true
    mocks.requireAdmin.mockReset()
    mocks.requireAdmin.mockImplementation(async () => {
      if (!mocks.isAdmin) {
        throw Object.assign(new Error('Not found'), { status: 404 })
      }

      return { userId: 1, config: { featuresRolloutEnabled: false } }
    })
    testDb = createMemoryExtractionTestDb()
    kv = createFakeConnectorKv()
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('assertNotCrossSiteRequest', vi.fn())
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('refuses a non-admin on both routes and never touches the registry',
    async () => {
      const { fetchImpl, calls } = pagedRegistryFetch([[
        registryEntry({ name: 'io.example/alpha' }),
      ]])

      vi.stubGlobal('fetch', fetchImpl)
      mocks.isAdmin = false

      expect((await failureOf(callRoute(SYNC_ROUTE))).status).toBe(404)
      expect((await failureOf(callRoute(STATUS_ROUTE))).status).toBe(404)
      expect(calls).toHaveLength(0)
      expect(await testDb.db.select().from(schema.mcpRegistryServers))
        .toHaveLength(0)
      expect(kv.put).not.toHaveBeenCalled()
    })

  it('lets an admin run Sync now, uncached, and read the status', async () => {
    const { fetchImpl } = pagedRegistryFetch([[
      registryEntry({ name: 'io.example/alpha' }),
      registryEntry({ name: 'io.example/beta' }),
    ]])

    vi.stubGlobal('fetch', fetchImpl)

    const before = await callRoute(STATUS_ROUTE)

    expect(before).toMatchObject({ rows: 0, isRunning: false })

    const event = createEvent()
    const result = await ((await import(SYNC_ROUTE)).default as Handler)(event)

    expect(result).toMatchObject({
      outcome: 'completed',
      upserted: 2,
      rows: 2,
    })
    expect(event.res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.logger.set).toHaveBeenCalledWith({
      attributes: {
        registry: {
          syncNow: expect.objectContaining({
            outcome: 'completed',
            rows: 2,
          }),
        },
      },
    })
    expect(await callRoute(STATUS_ROUTE)).toMatchObject({ rows: 2 })
  })
})
