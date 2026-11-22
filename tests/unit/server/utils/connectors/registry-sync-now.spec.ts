import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  REGISTRY_SYNC_NOW_LOCK_SECONDS,
  REGISTRY_SYNC_NOW_MAX_PAGES,
} from '#shared/utils/connectors-policy'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import { createFakeConnectorKv } from '../../../../setup/helpers/connectors-oauth'
import {
  createRegistryFetch,
  jsonResponse,
  pagedRegistryFetch,
  registryEntry,
} from '../../../../fixtures/mcp-registry/builders'

const {
  REGISTRY_SYNC_NOW_LOCK_KEY,
  readRegistrySyncStatus,
  runRegistrySyncNow,
} = await import('~~/server/utils/connectors/registry-sync-now')
const { REGISTRY_PROGRESS_KEY } = await import(
  '~~/server/utils/connectors/registry-sync'
)

const NOW = new Date('2026-11-15T12:00:00.000Z')

describe('registry sync now', () => {
  let testDb: MemoryExtractionTestDb
  let kv: ReturnType<typeof createFakeConnectorKv>

  beforeEach(() => {
    testDb = createMemoryExtractionTestDb()
    kv = createFakeConnectorKv()
  })

  afterEach(() => {
    testDb.close()
  })

  function run(fetchImpl: typeof fetch) {
    return runRegistrySyncNow({
      db: testDb.db,
      kv: kv as never,
      now: NOW,
      fetchImpl,
    })
  }

  it('reads an empty status', async () => {
    expect(await readRegistrySyncStatus(testDb.db, kv as never)).toEqual({
      rows: 0,
      lastSyncedAt: null,
      hasUnfinishedRun: false,
      isRunning: false,
    })
  })

  it('fills the table like the cron and reports the status', async () => {
    const { fetchImpl } = pagedRegistryFetch([[
      registryEntry({ name: 'io.example/alpha' }),
      registryEntry({ name: 'io.example/beta' }),
    ]])

    const result = await run(fetchImpl)

    expect(result).toMatchObject({
      outcome: 'completed',
      pages: 1,
      upserted: 2,
      rows: 2,
      lastSyncedAt: NOW.toISOString(),
      hasUnfinishedRun: false,
      isRunning: false,
    })
    expect(await testDb.db.select().from(schema.mcpRegistryServers))
      .toHaveLength(2)
  })

  it('stops at the page cap, keeps the cursor and continues on the next run',
    async () => {
      const pages = Array.from({
        length: REGISTRY_SYNC_NOW_MAX_PAGES + 2,
      }, (_page, index) => {
        return [registryEntry({ name: `io.example/tool-${index}` })]
      })
      const { calls, fetchImpl } = pagedRegistryFetch(pages)

      const first = await run(fetchImpl)

      expect(first).toMatchObject({
        outcome: 'partial',
        pages: REGISTRY_SYNC_NOW_MAX_PAGES,
        rows: REGISTRY_SYNC_NOW_MAX_PAGES,
        hasUnfinishedRun: true,
      })
      expect(calls).toHaveLength(REGISTRY_SYNC_NOW_MAX_PAGES)
      expect(kv.values.has(REGISTRY_PROGRESS_KEY)).toBe(true)

      const second = await run(fetchImpl)

      expect(second).toMatchObject({
        outcome: 'completed',
        pages: 2,
        rows: REGISTRY_SYNC_NOW_MAX_PAGES + 2,
        hasUnfinishedRun: false,
      })
    })

  it('answers busy without fetching while the lock is held', async () => {
    const { calls, fetchImpl } = pagedRegistryFetch([[
      registryEntry({ name: 'io.example/alpha' }),
    ]])

    await kv.put(REGISTRY_SYNC_NOW_LOCK_KEY, '1', { expirationTtl: 120 })

    expect(await run(fetchImpl)).toMatchObject({
      outcome: 'busy',
      isRunning: true,
      rows: 0,
    })
    expect(calls).toHaveLength(0)
  })

  it('takes the lock for the run and releases it after a failure', async () => {
    let lockDuringRun: string | null = null
    const { fetchImpl } = createRegistryFetch(() => {
      lockDuringRun = kv.values.get(REGISTRY_SYNC_NOW_LOCK_KEY) ?? null

      return jsonResponse({ title: 'Bad Gateway' }, 502)
    })

    const result = await run(fetchImpl)

    expect(lockDuringRun).toBe('1')
    expect(result.outcome).toBe('failed')
    expect(result.error).toBeTruthy()
    expect(kv.values.has(REGISTRY_SYNC_NOW_LOCK_KEY)).toBe(false)
    expect(kv.ttls.get(REGISTRY_SYNC_NOW_LOCK_KEY))
      .toBe(REGISTRY_SYNC_NOW_LOCK_SECONDS)
  })
})
