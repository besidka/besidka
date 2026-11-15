import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REGISTRY_PAGE_SIZE,
  REGISTRY_PAGES_PER_RUN,
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
  registryPage,
} from '../../../../fixtures/mcp-registry/builders'

const {
  REGISTRY_ERASURES_KEY,
  REGISTRY_FULL_PASS_KEY,
  REGISTRY_PROGRESS_KEY,
  REGISTRY_UPDATED_SINCE_KEY,
  hashRegistryName,
  syncMcpRegistry,
} = await import('~~/server/utils/connectors/registry-sync')

const NOW = new Date('2026-11-15T12:00:00.000Z')
const HOUR = 60 * 60 * 1000

describe('syncMcpRegistry', () => {
  let testDb: MemoryExtractionTestDb
  let kv: ReturnType<typeof createFakeConnectorKv>

  beforeEach(() => {
    testDb = createMemoryExtractionTestDb()
    kv = createFakeConnectorKv()
  })

  afterEach(() => {
    testDb.close()
  })

  function run(
    fetchImpl: typeof fetch,
    options: { now?: Date, clock?: () => number } = {},
  ) {
    return syncMcpRegistry({
      db: testDb.db,
      kv: kv as never,
      now: options.now ?? NOW,
      fetchImpl,
      clock: options.clock,
    })
  }

  async function rows() {
    return await testDb.db.select().from(schema.mcpRegistryServers)
  }

  async function names() {
    return (await rows()).map(row => row.name).sort()
  }

  it('fills the table from a first full run and saves the watermark', async () => {
    const { calls, fetchImpl } = pagedRegistryFetch([[
      registryEntry({
        name: 'io.example/alpha',
        title: 'Alpha',
        updatedAt: '2026-11-09T00:00:00.000Z',
      }),
      registryEntry({
        name: 'io.example/beta',
        updatedAt: '2026-11-11T00:00:00.000Z',
      }),
    ]])

    const result = await run(fetchImpl)

    expect(result).toMatchObject({
      outcome: 'completed',
      mode: 'full',
      pages: 1,
      upserted: 2,
      skipped: 0,
      swept: 0,
    })
    expect(await names()).toEqual(['io.example/alpha', 'io.example/beta'])
    expect((await rows()).find(row => row.name === 'io.example/alpha'))
      .toMatchObject({
        title: 'Alpha',
        syncedAt: new Date(NOW.getTime()),
      })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url.origin).toBe('https://registry.modelcontextprotocol.io')
    expect(calls[0]!.url.pathname).toBe('/v0.1/servers')
    expect(calls[0]!.url.searchParams.get('limit')).toBe(String(REGISTRY_PAGE_SIZE))
    expect(calls[0]!.url.searchParams.get('version')).toBe('latest')
    expect(calls[0]!.url.searchParams.has('updated_since')).toBe(false)
    expect(kv.values.get(REGISTRY_FULL_PASS_KEY)).toBe(NOW.toISOString())
    expect(kv.values.get(REGISTRY_UPDATED_SINCE_KEY))
      .toBe(new Date(NOW.getTime() - 5 * 60 * 1000).toISOString())
    expect(kv.values.has(REGISTRY_PROGRESS_KEY)).toBe(false)
  })

  it('follows the cursor across pages', async () => {
    const { calls, fetchImpl } = pagedRegistryFetch([
      [registryEntry({ name: 'io.example/one' })],
      [registryEntry({ name: 'io.example/two' })],
      [registryEntry({ name: 'io.example/three' })],
    ])

    const result = await run(fetchImpl)

    expect(result).toMatchObject({ outcome: 'completed', pages: 3, upserted: 3 })
    expect(calls.map(call => call.url.searchParams.get('cursor')))
      .toEqual([null, '1', '2'])
    expect(await names()).toHaveLength(3)
  })

  it('runs incrementally from the watermark within a day', async () => {
    await run(pagedRegistryFetch([[
      registryEntry({ name: 'io.example/alpha' }),
      registryEntry({ name: 'io.example/beta' }),
    ]]).fetchImpl)

    const { calls, fetchImpl } = pagedRegistryFetch([[
      registryEntry({
        name: 'io.example/alpha',
        title: 'Alpha v2',
        version: '2.0.0',
        updatedAt: '2026-11-15T12:30:00.000Z',
      }),
      registryEntry({ name: 'io.example/beta', status: 'deleted' }),
      registryEntry({ name: 'io.example/gamma' }),
    ]])

    const result = await run(fetchImpl, {
      now: new Date(NOW.getTime() + HOUR),
    })

    expect(result).toMatchObject({
      outcome: 'completed',
      mode: 'incremental',
      upserted: 2,
      deleted: 1,
      swept: 0,
    })
    expect(calls[0]!.url.searchParams.get('updated_since'))
      .toBe(new Date(NOW.getTime() - 5 * 60 * 1000).toISOString())
    expect(await names()).toEqual(['io.example/alpha', 'io.example/gamma'])
    expect((await rows()).filter(row => row.name === 'io.example/alpha'))
      .toEqual([expect.objectContaining({
        id: 'io.example/alpha@2.0.0',
        title: 'Alpha v2',
      })])
    expect(kv.values.get(REGISTRY_UPDATED_SINCE_KEY))
      .toBe('2026-11-15T12:30:00.000Z')
  })

  it('keeps the watermark when an incremental run returns nothing', async () => {
    await run(pagedRegistryFetch([[
      registryEntry({ name: 'io.example/alpha' }),
    ]]).fetchImpl)

    const watermark = kv.values.get(REGISTRY_UPDATED_SINCE_KEY)
    const { fetchImpl } = pagedRegistryFetch([[]])

    await run(fetchImpl, { now: new Date(NOW.getTime() + HOUR) })

    expect(kv.values.get(REGISTRY_UPDATED_SINCE_KEY)).toBe(watermark)
    expect(await names()).toEqual(['io.example/alpha'])
  })

  it('removes the row of an entry that turns invalid', async () => {
    await run(pagedRegistryFetch([[
      registryEntry({ name: 'io.example/alpha' }),
      registryEntry({ name: 'io.example/beta' }),
      registryEntry({ name: 'io.example/gamma' }),
    ]]).fetchImpl)

    const { fetchImpl } = pagedRegistryFetch([[
      registryEntry({
        name: 'io.example/alpha',
        remotes: [{ type: 'sse', url: 'https://sse.example.com/sse' }],
      }),
      registryEntry({
        name: 'io.example/beta',
        remotes: [{
          type: 'streamable-http',
          url: 'https://{tenant}.example.com/mcp',
        }],
      }),
      registryEntry({
        name: 'io.example/gamma',
        remotes: [{
          type: 'streamable-http',
          url: 'https://127.0.0.1/mcp',
        }],
      }),
    ]])

    const result = await run(fetchImpl, {
      now: new Date(NOW.getTime() + HOUR),
    })

    expect(result.skipped).toBe(3)
    expect(result.skippedByReason).toEqual({
      'no-remote': 1,
      'template': 1,
      'unsafe-url': 1,
    })
    expect(await names()).toEqual([])
  })

  it('skips and removes names on the erasure list', async () => {
    kv.values.set(
      REGISTRY_ERASURES_KEY,
      JSON.stringify([await hashRegistryName('io.github.someone/tool')]),
    )

    const first = await run(pagedRegistryFetch([[
      registryEntry({ name: 'io.github.someone/tool' }),
      registryEntry({ name: 'io.example/other' }),
    ]]).fetchImpl)

    expect(first.skippedByReason).toEqual({ erased: 1 })
    expect(await names()).toEqual(['io.example/other'])
  })

  it('counts a bad entry and still stores the rest of the page', async () => {
    const result = await run(pagedRegistryFetch([[
      'not an entry',
      registryEntry({ name: 'io.example/ok' }),
    ]]).fetchImpl)

    expect(result).toMatchObject({ outcome: 'completed', upserted: 1 })
    expect(result.skippedByReason).toEqual({ shape: 1 })
  })

  it('writes single-row inserts only, never one multi-row insert', async () => {
    const batch = vi.spyOn(testDb.db, 'batch')
    const entries = Array.from({ length: 60 }, (_value, index) => {
      return registryEntry({ name: `io.example/server-${index}` })
    })

    await run(pagedRegistryFetch([entries]).fetchImpl)

    expect(batch.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(await rows()).toHaveLength(60)
  })

  describe('caps and resuming', () => {
    function endlessRegistry() {
      return createRegistryFetch((call) => {
        const cursor = Number(call.url.searchParams.get('cursor') ?? 0)

        return jsonResponse(registryPage(
          [registryEntry({ name: `io.example/page-${cursor}` })],
          String(cursor + 1),
        ))
      })
    }

    it('reads at most 20 pages, saves the cursor and never sweeps', async () => {
      await testDb.db.insert(schema.mcpRegistryServers).values({
        id: 'io.example/stale@1.0.0',
        name: 'io.example/stale',
        description: 'stale',
        remoteUrl: 'https://stale.example.com/mcp',
        remoteType: 'streamable-http',
        headerNames: [],
        status: 'active',
        registryUpdatedAt: new Date(0),
        syncedAt: new Date(0),
      })

      const { calls, fetchImpl } = endlessRegistry()
      const result = await run(fetchImpl)

      expect(result).toMatchObject({
        outcome: 'partial',
        pages: REGISTRY_PAGES_PER_RUN,
        swept: 0,
      })
      expect(calls).toHaveLength(REGISTRY_PAGES_PER_RUN)
      expect(JSON.parse(kv.values.get(REGISTRY_PROGRESS_KEY)!)).toMatchObject({
        mode: 'full',
        cursor: String(REGISTRY_PAGES_PER_RUN),
      })
      expect(kv.values.has(REGISTRY_FULL_PASS_KEY)).toBe(false)
      expect(await names()).toContain('io.example/stale')
    })

    it('continues the next hour from the saved cursor and sweeps at the end', async () => {
      await testDb.db.insert(schema.mcpRegistryServers).values({
        id: 'io.example/stale@1.0.0',
        name: 'io.example/stale',
        description: 'stale',
        remoteUrl: 'https://stale.example.com/mcp',
        remoteType: 'streamable-http',
        headerNames: [],
        status: 'active',
        registryUpdatedAt: new Date(0),
        syncedAt: new Date(0),
      })

      await run(endlessRegistry().fetchImpl)

      const { calls, fetchImpl } = createRegistryFetch(() => {
        return jsonResponse(registryPage([
          registryEntry({ name: 'io.example/last' }),
        ]))
      })
      const result = await run(fetchImpl, {
        now: new Date(NOW.getTime() + HOUR),
      })

      expect(calls[0]!.url.searchParams.get('cursor'))
        .toBe(String(REGISTRY_PAGES_PER_RUN))
      expect(result).toMatchObject({ outcome: 'completed', mode: 'full', swept: 1 })
      expect(await names()).not.toContain('io.example/stale')
      expect(await names()).toContain('io.example/last')
      expect(await names()).toContain('io.example/page-0')
      expect(kv.values.get(REGISTRY_FULL_PASS_KEY)).toBe(NOW.toISOString())
      expect(kv.values.has(REGISTRY_PROGRESS_KEY)).toBe(false)
    })

    it('stops at the wall-clock budget', async () => {
      let ticks = 0
      const { calls, fetchImpl } = endlessRegistry()
      const result = await run(fetchImpl, {
        clock: () => {
          ticks += 1

          return ticks * 2 * 60 * 1000
        },
      })

      expect(result.outcome).toBe('partial')
      expect(calls.length).toBeLessThan(REGISTRY_PAGES_PER_RUN)
      expect(calls.length).toBeGreaterThanOrEqual(1)
    })

    it('starts a new full pass after 24 hours and sweeps what it did not see', async () => {
      await run(pagedRegistryFetch([[
        registryEntry({ name: 'io.example/stays' }),
        registryEntry({ name: 'io.example/vanishes' }),
      ]]).fetchImpl)

      const { calls, fetchImpl } = pagedRegistryFetch([[
        registryEntry({ name: 'io.example/stays' }),
      ]])
      const result = await run(fetchImpl, {
        now: new Date(NOW.getTime() + 25 * HOUR),
      })

      expect(result).toMatchObject({ mode: 'full', swept: 1 })
      expect(calls[0]!.url.searchParams.has('updated_since')).toBe(false)
      expect(await names()).toEqual(['io.example/stays'])
    })

    it('aborts a sweep that would delete more than half of the rows', async () => {
      await run(pagedRegistryFetch([[
        registryEntry({ name: 'io.example/a' }),
        registryEntry({ name: 'io.example/b' }),
        registryEntry({ name: 'io.example/c' }),
      ]]).fetchImpl)

      const result = await run(pagedRegistryFetch([[
        registryEntry({ name: 'io.example/a' }),
      ]]).fetchImpl, { now: new Date(NOW.getTime() + 25 * HOUR) })

      expect(result).toMatchObject({
        outcome: 'failed',
        sweepAborted: { stale: 2, total: 3 },
      })
      expect(await names()).toEqual([
        'io.example/a',
        'io.example/b',
        'io.example/c',
      ])
      expect(kv.values.get(REGISTRY_FULL_PASS_KEY)).toBe(NOW.toISOString())
    })

    it('sweeps exactly half of the rows', async () => {
      await run(pagedRegistryFetch([[
        registryEntry({ name: 'io.example/a' }),
        registryEntry({ name: 'io.example/b' }),
      ]]).fetchImpl)

      const result = await run(pagedRegistryFetch([[
        registryEntry({ name: 'io.example/a' }),
      ]]).fetchImpl, { now: new Date(NOW.getTime() + 25 * HOUR) })

      expect(result).toMatchObject({ outcome: 'completed', swept: 1 })
    })

    it('does not sweep when a full pass returns no entries', async () => {
      await run(pagedRegistryFetch([[
        registryEntry({ name: 'io.example/stays' }),
      ]]).fetchImpl)

      const result = await run(pagedRegistryFetch([[]]).fetchImpl, {
        now: new Date(NOW.getTime() + 25 * HOUR),
      })

      expect(result.outcome).toBe('failed')
      expect(await names()).toEqual(['io.example/stays'])
      expect(kv.values.get(REGISTRY_FULL_PASS_KEY)).toBe(NOW.toISOString())
    })
  })

  describe('watermark and cursor limits', () => {
    it('never moves the watermark past the start of the run', async () => {
      await run(pagedRegistryFetch([[
        registryEntry({ name: 'io.example/alpha' }),
      ]]).fetchImpl)

      await run(pagedRegistryFetch([[
        registryEntry({
          name: 'io.example/future',
          updatedAt: '2030-01-01T00:00:00.000Z',
        }),
      ]]).fetchImpl, { now: new Date(NOW.getTime() + HOUR) })

      expect(kv.values.get(REGISTRY_UPDATED_SINCE_KEY))
        .toBe(new Date(NOW.getTime() + HOUR).toISOString())
      expect((await rows()).find(row => row.name === 'io.example/future')!
        .registryUpdatedAt).toEqual(new Date('2030-01-01T00:00:00.000Z'))
    })

    it('fails on a nextCursor over 512 characters and writes nothing', async () => {
      const { fetchImpl } = createRegistryFetch(() => {
        return jsonResponse(registryPage(
          [registryEntry({ name: 'io.example/first' })],
          'c'.repeat(513),
        ))
      })
      const result = await run(fetchImpl)

      expect(result).toMatchObject({ outcome: 'failed', pages: 0 })
      expect(await rows()).toEqual([])
      expect(JSON.parse(kv.values.get(REGISTRY_PROGRESS_KEY)!).cursor)
        .toBeNull()
    })

    it('accepts a nextCursor of exactly 512 characters', async () => {
      const { fetchImpl } = createRegistryFetch((call) => {
        return call.url.searchParams.has('cursor')
          ? jsonResponse(registryPage([]))
          : jsonResponse(registryPage(
            [registryEntry({ name: 'io.example/first' })],
            'c'.repeat(512),
          ))
      })
      const result = await run(fetchImpl)

      expect(result.pages).toBe(2)
    })
  })

  describe('failure', () => {
    it('keeps old rows, the saved cursor and the watermark on a 5xx', async () => {
      await run(pagedRegistryFetch([[
        registryEntry({ name: 'io.example/alpha' }),
      ]]).fetchImpl)

      const watermark = kv.values.get(REGISTRY_UPDATED_SINCE_KEY)
      const { fetchImpl } = createRegistryFetch(() => {
        return new Response('upstream down', { status: 503 })
      })
      const result = await run(fetchImpl, {
        now: new Date(NOW.getTime() + HOUR),
      })

      expect(result.outcome).toBe('failed')
      expect(result.error).toContain('503')
      expect(await names()).toEqual(['io.example/alpha'])
      expect(kv.values.get(REGISTRY_UPDATED_SINCE_KEY)).toBe(watermark)
    })

    it('keeps the cursor of the last page that was written', async () => {
      const { fetchImpl } = createRegistryFetch((call) => {
        const cursor = call.url.searchParams.get('cursor')

        return cursor
          ? new Response('boom', { status: 502 })
          : jsonResponse(registryPage(
            [registryEntry({ name: 'io.example/first' })],
            'next-page',
          ))
      })
      const result = await run(fetchImpl)

      expect(result).toMatchObject({ outcome: 'failed', pages: 1 })
      expect(JSON.parse(kv.values.get(REGISTRY_PROGRESS_KEY)!).cursor)
        .toBe('next-page')
      expect(await names()).toEqual(['io.example/first'])
    })

    it('drops a saved cursor the registry rejects and restarts next run', async () => {
      kv.values.set(REGISTRY_PROGRESS_KEY, JSON.stringify({
        mode: 'full',
        startedAt: NOW.toISOString(),
        updatedSince: null,
        cursor: 'expired-cursor',
        maxUpdatedAt: null,
      }))

      const rejected = await run(createRegistryFetch(() => {
        return new Response('bad cursor', { status: 400 })
      }).fetchImpl)

      expect(rejected.outcome).toBe('failed')
      expect(kv.values.has(REGISTRY_PROGRESS_KEY)).toBe(false)

      const { calls, fetchImpl } = pagedRegistryFetch([[
        registryEntry({ name: 'io.example/fresh' }),
      ]])

      await run(fetchImpl)

      expect(calls[0]!.url.searchParams.has('cursor')).toBe(false)
      expect(await names()).toEqual(['io.example/fresh'])
    })

    it('does not throw on a network error or an unknown page shape', async () => {
      const network = createRegistryFetch(() => {
        throw new Error('connect ECONNRESET')
      })
      const shape = createRegistryFetch(() => jsonResponse({ nope: true }))
      const notJson = createRegistryFetch(() => new Response('<html>'))

      for (const { fetchImpl } of [network, shape, notJson]) {
        const result = await run(fetchImpl)

        expect(result.outcome).toBe('failed')
        expect(result.error).toBeTruthy()
      }

      expect(await rows()).toEqual([])
    })

    it('does not throw when KV is down', async () => {
      kv.get.mockRejectedValue(new Error('KV unavailable'))

      const result = await run(pagedRegistryFetch([[]]).fetchImpl)

      expect(result.outcome).toBe('failed')
    })
  })
})
