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
  createRegistryFetch,
  jsonResponse,
  registryEntry,
  registryPage,
} from '../../fixtures/mcp-registry/builders'

const SCHEDULED_TIME = Date.UTC(2026, 10, 15, 12, 0, 0)
const REGISTRY_CRON = '0 * * * *'

function createLoggerDouble(wideEvent: unknown = undefined) {
  const set = vi.fn()
  const emit = vi.fn().mockReturnValue(wideEvent)
  const createLogger = vi.fn().mockReturnValue({ set, emit })

  return { set, emit, createLogger }
}

async function importPlugin() {
  return import('../../../server/plugins/mcp-registry-sync')
}

describe('mcp registry sync plugin', () => {
  let testDb: MemoryExtractionTestDb
  let kv: ReturnType<typeof createFakeConnectorKv>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    testDb = createMemoryExtractionTestDb()
    kv = createFakeConnectorKv()
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  function registryReturning(entries: unknown[]) {
    return createRegistryFetch(() => jsonResponse(registryPage(entries)))
  }

  it('mirrors the registry, logs the counts and emits 200', async () => {
    const { set, emit, createLogger } = createLoggerDouble()
    const { runMcpRegistrySyncJob } = await importPlugin()
    const { fetchImpl } = registryReturning([
      registryEntry({ name: 'io.example/one' }),
      registryEntry({
        name: 'io.example/two',
        remotes: [{ type: 'sse', url: 'https://sse.example.com/sse' }],
      }),
    ])

    await runMcpRegistrySyncJob({
      controller: { cron: REGISTRY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: testDb.db,
      kv: kv as never,
      fetchImpl,
    })

    expect(createLogger).toHaveBeenCalledWith({
      method: 'CRON',
      path: '/internal/jobs/mcp-registry-sync',
      requestId: `mcp-registry-sync-${SCHEDULED_TIME}`,
    })
    expect(set).toHaveBeenCalledWith({
      attributes: {
        registry: expect.objectContaining({
          outcome: 'completed',
          mode: 'full',
          pages: 1,
          upserted: 1,
          skipped: 1,
        }),
      },
    })
    expect(emit).toHaveBeenCalledWith({ status: 200 })
    expect(
      (await testDb.db.select().from(schema.mcpRegistryServers))
        .map(row => row.name),
    ).toEqual(['io.example/one'])
  })

  it('emits 500 without throwing when the registry is down', async () => {
    const { emit, createLogger } = createLoggerDouble()
    const { runMcpRegistrySyncJob } = await importPlugin()
    const { fetchImpl } = createRegistryFetch(() => {
      return new Response('down', { status: 503 })
    })

    await expect(runMcpRegistrySyncJob({
      controller: { cron: REGISTRY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: testDb.db,
      kv: kv as never,
      fetchImpl,
    })).resolves.toBeUndefined()

    expect(emit).toHaveBeenCalledWith({ status: 500 })
  })

  it('emits 500 without throwing when a binding is missing', async () => {
    const { emit, createLogger } = createLoggerDouble()
    const { runMcpRegistrySyncJob } = await importPlugin()

    vi.stubGlobal('useKV', () => {
      throw new Error('KV binding missing')
    })

    await expect(runMcpRegistrySyncJob({
      controller: { cron: REGISTRY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: testDb.db,
    })).resolves.toBeUndefined()

    expect(emit).toHaveBeenCalledWith({ status: 500 })
  })

  it('runs on the hourly cron and not on another one', async () => {
    const hooks = new Map<string, (context: unknown) => Promise<void>>()
    const plugin = (await importPlugin()).default as unknown as (
      nitroApp: { hooks: { hook: (name: string, handler: never) => void } },
    ) => void
    const fetchSpy = vi.fn(async () => jsonResponse(registryPage([])))

    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)

    plugin({
      hooks: {
        hook: (name: string, handler: never) => {
          hooks.set(name, handler)
        },
      },
    })

    await hooks.get('cloudflare:scheduled')!({
      controller: { cron: '*/5 * * * *', scheduledTime: SCHEDULED_TIME },
    })

    expect(fetchSpy).not.toHaveBeenCalled()

    await hooks.get('cloudflare:scheduled')!({
      controller: { cron: REGISTRY_CRON, scheduledTime: SCHEDULED_TIME },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0]![0])).toContain(
      'https://registry.modelcontextprotocol.io/v0.1/servers?',
    )
  })
})
