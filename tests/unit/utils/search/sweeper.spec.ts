import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSearchIndexTestDb } from '../../../setup/helpers/search-index-db'

const mocks = vi.hoisted(() => ({
  encodePublicId: vi.fn((id: number) => `pub-${id}`),
  decodePublicId: vi.fn((publicId: string) => {
    const match = /^pub-(\d+)$/.exec(publicId)

    return match ? Number(match[1]) : Number.NaN
  }),
}))

vi.mock(
  '~~/server/utils/custom-db-types',
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('~~/server/utils/custom-db-types')
    >()

    return {
      ...actual,
      encodePublicId: mocks.encodePublicId,
      decodePublicId: mocks.decodePublicId,
    }
  },
)

function createFakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    store,
  }
}

async function importSweeper() {
  return import('../../../../server/utils/search/sweeper')
}

describe('sweepMessageSearchIndex', () => {
  let testDb: ReturnType<typeof createSearchIndexTestDb>
  let logger: { set: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.encodePublicId.mockImplementation((id: number) => `pub-${id}`)
    mocks.decodePublicId.mockImplementation((publicId: string) => {
      const match = /^pub-(\d+)$/.exec(publicId)

      return match ? Number(match[1]) : Number.NaN
    })
    testDb = createSearchIndexTestDb()
    logger = { set: vi.fn() }
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('backfills only unindexed messages, respecting the cursor bound', async () => {
    testDb.insertChat({ id: 1, userId: 7 })
    testDb.insertMessage({
      id: 1, chatId: 1, parts: [{ type: 'text', text: 'first' }],
    })
    testDb.insertMessage({
      id: 2, chatId: 1, parts: [{ type: 'text', text: 'second' }],
    })
    testDb.insertMessage({
      id: 3, chatId: 1, parts: [{ type: 'text', text: 'third' }],
    })
    testDb.sqlite.exec(
      'insert into message_search(rowid, owner, body, body_stem)'
      + ' values (1, \'u7\', \'first\', \'first\')',
    )

    const kv = createFakeKv({ 'search-index:sweep-cursor': '1' })

    vi.stubGlobal('useKV', () => kv)

    const { sweepMessageSearchIndex } = await importSweeper()
    const result = await sweepMessageSearchIndex({
      batchSize: 10,
      maxRuntimeMs: 20000,
      logger,
      db: testDb.db,
    })

    expect(result.backfilledCount).toBe(2)
    expect(result.emptyBodyBackfilledCount).toBe(0)

    const indexedRows = testDb.sqlite.prepare(
      'select rowid, body from message_search order by rowid asc',
    ).all() as Array<{ rowid: number, body: string }>

    expect(indexedRows).toEqual([
      { rowid: 1, body: 'first' },
      { rowid: 2, body: 'second' },
      { rowid: 3, body: 'third' },
    ])
  })

  it('resets the cursor to 0 when a pass returns fewer than batchSize', async () => {
    testDb.insertChat({ id: 1, userId: 7 })
    testDb.insertMessage({ id: 1, chatId: 1, parts: [] })

    const kv = createFakeKv()

    vi.stubGlobal('useKV', () => kv)

    const { sweepMessageSearchIndex } = await importSweeper()
    const result = await sweepMessageSearchIndex({
      batchSize: 10,
      maxRuntimeMs: 20000,
      logger,
      db: testDb.db,
    })

    expect(result.nextCursor).toBe(0)
    expect(kv.put).toHaveBeenCalledWith('search-index:sweep-cursor', '0')
  })

  it('advances the cursor to the highest processed id on a full page', async () => {
    testDb.insertChat({ id: 1, userId: 7 })

    for (let id = 1; id <= 3; id++) {
      testDb.insertMessage({ id, chatId: 1, parts: [] })
    }

    const kv = createFakeKv()

    vi.stubGlobal('useKV', () => kv)

    const { sweepMessageSearchIndex } = await importSweeper()
    const result = await sweepMessageSearchIndex({
      batchSize: 3,
      maxRuntimeMs: 20000,
      logger,
      db: testDb.db,
    })

    expect(result.nextCursor).toBe(3)
    expect(kv.put).toHaveBeenCalledWith('search-index:sweep-cursor', '3')
  })

  it('finds and deletes orphan FTS rows whose messages row is gone', async () => {
    testDb.sqlite.exec(
      'insert into message_search(rowid, owner, body, body_stem)'
      + ' values (99, \'u7\', \'orphan\', \'orphan\')',
    )

    const kv = createFakeKv()

    vi.stubGlobal('useKV', () => kv)

    const { sweepMessageSearchIndex } = await importSweeper()
    const result = await sweepMessageSearchIndex({
      batchSize: 10,
      maxRuntimeMs: 20000,
      logger,
      db: testDb.db,
    })

    expect(result.garbageCollectedCount).toBe(1)

    const remaining = testDb.sqlite.prepare(
      'select rowid from message_search',
    ).all()

    expect(remaining).toEqual([])
  })

  it('short-circuits the backfill pass once maxRuntimeMs is exceeded '
    + 'and does not advance the cursor past unprocessed rows', async () => {
    testDb.insertChat({ id: 1, userId: 7 })
    testDb.insertChat({ id: 2, userId: 8 })
    testDb.insertMessage({ id: 6, chatId: 1, parts: [] })
    testDb.insertMessage({ id: 7, chatId: 2, parts: [] })

    const kv = createFakeKv({ 'search-index:sweep-cursor': '5' })

    vi.stubGlobal('useKV', () => kv)

    let dateNowCallCount = 0

    vi.spyOn(Date, 'now').mockImplementation(() => {
      dateNowCallCount += 1

      return dateNowCallCount === 1 ? 0 : 5000
    })

    const { sweepMessageSearchIndex } = await importSweeper()
    const result = await sweepMessageSearchIndex({
      batchSize: 10,
      maxRuntimeMs: 1000,
      logger,
      db: testDb.db,
    })

    expect(result.hasMore).toBe(true)
    expect(result.backfilledCount).toBe(0)
    expect(result.nextCursor).toBe(5)
    expect(kv.put).toHaveBeenCalledWith('search-index:sweep-cursor', '5')

    vi.restoreAllMocks()
  })

  it('never throws even when the db read fails', async () => {
    const kv = createFakeKv()

    vi.stubGlobal('useKV', () => kv)

    const brokenDb = {
      all: vi.fn().mockRejectedValue(new Error('db exploded')),
    } as unknown as typeof testDb.db

    const { sweepMessageSearchIndex } = await importSweeper()

    await expect(sweepMessageSearchIndex({
      batchSize: 10,
      maxRuntimeMs: 20000,
      logger,
      db: brokenDb,
    })).resolves.toEqual(expect.objectContaining({
      backfilledCount: 0,
      garbageCollectedCount: 0,
    }))

    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      messageSearchSweep: expect.objectContaining({
        phase: 'sweep-run',
      }),
    }))
  })
})
