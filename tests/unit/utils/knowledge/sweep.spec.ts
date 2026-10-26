import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sweepProjectKnowledge } from '~~/server/utils/knowledge/sweep'
import {
  knowledgeItemTextKey,
  knowledgePackIndexKey,
  knowledgePackKey,
} from '~~/server/utils/knowledge/storage-keys'
import { createKnowledgeTestDb } from '../../../setup/helpers/knowledge-db'
import type { KnowledgeTestDb } from '../../../setup/helpers/knowledge-db'

const NOW = new Date('2026-10-25T12:00:00.000Z')
const OLD = new Date(NOW.getTime() - 2 * 60 * 60 * 1000)
const YOUNG = new Date(NOW.getTime() - 10 * 60 * 1000)
const OWNER = 1
const STRANGER = 2
const PROJECT = 10

interface FakeObject {
  uploaded: Date
}

function createFakeBucket(initialKeys: Record<string, Date> = {}) {
  const objects = new Map<string, FakeObject>()
  const listPrefixes: string[] = []
  const deleteCalls: string[][] = []
  let inFlight = 0
  let maxInFlight = 0

  for (const [key, uploaded] of Object.entries(initialKeys)) {
    objects.set(key, { uploaded })
  }

  async function track<T>(action: () => T): Promise<T> {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await Promise.resolve()

    const value = action()

    inFlight--

    return value
  }

  const list = vi.fn(async (options: {
    prefix: string
    cursor?: string
    limit: number
  }) => {
    return track(() => {
      listPrefixes.push(options.prefix)

      const matching = [...objects.keys()]
        .filter((key) => {
          return key.startsWith(options.prefix)
            && (!options.cursor || key > options.cursor)
        })
        .sort()
      const page = matching.slice(0, options.limit)
      const truncated = matching.length > page.length

      return {
        objects: page.map((key) => {
          return { key, uploaded: objects.get(key)!.uploaded }
        }),
        truncated,
        cursor: truncated ? page[page.length - 1] : undefined,
      }
    })
  })
  const deleteKeys = vi.fn(async (keys: string[]) => {
    return track(() => {
      deleteCalls.push([...keys])

      for (const key of keys) {
        objects.delete(key)
      }
    })
  })

  return {
    bucket: { list, delete: deleteKeys },
    list,
    deleteKeys,
    listPrefixes,
    deleteCalls,
    has: (key: string) => objects.has(key),
    put: (key: string, uploaded: Date) => {
      objects.set(key, { uploaded })
    },
    keys: () => [...objects.keys()].sort(),
    maxInFlight: () => maxInFlight,
  }
}

describe('sweepProjectKnowledge', () => {
  let testDb: KnowledgeTestDb

  function sweep(
    fake: ReturnType<typeof createFakeBucket>,
    overrides: Partial<Parameters<typeof sweepProjectKnowledge>[0]> = {},
  ) {
    return sweepProjectKnowledge({
      batchSize: 1000,
      maxRuntimeMs: 20000,
      now: NOW,
      db: testDb.db,
      storage: fake.bucket,
      ...overrides,
    })
  }

  beforeEach(() => {
    testDb = createKnowledgeTestDb()
  })

  afterEach(() => {
    testDb.close()
    vi.useRealTimers()
  })

  describe('item text objects', () => {
    it('deletes the object of an item whose row is gone and keeps live ones', async () => {
      testDb.insertProject({ id: PROJECT, userId: OWNER })
      testDb.insertItem({ id: 1, userId: OWNER, projectId: PROJECT })

      const liveKey = knowledgeItemTextKey(OWNER, PROJECT, 1)
      const orphanKey = knowledgeItemTextKey(OWNER, PROJECT, 2)
      const fake = createFakeBucket({
        [liveKey]: OLD,
        [orphanKey]: OLD,
      })
      const result = await sweep(fake)

      expect(fake.has(liveKey)).toBe(true)
      expect(fake.has(orphanKey)).toBe(false)
      expect(fake.deleteKeys).toHaveBeenCalledTimes(1)
      expect(fake.deleteKeys).toHaveBeenCalledWith([orphanKey])
      expect(result.orphanItemObjectsDeleted).toBe(1)
      expect(result.orphanProjectObjectsDeleted).toBe(0)
      expect(result.scannedCount).toBe(2)
    })

    it('deletes an object whose item row belongs to another project or user', async () => {
      testDb.insertProject({ id: PROJECT, userId: OWNER })
      testDb.insertProject({ id: 11, userId: OWNER })
      testDb.insertItem({ id: 1, userId: OWNER, projectId: 11 })
      testDb.insertItem({ id: 2, userId: STRANGER, projectId: PROJECT })

      const wrongProjectKey = knowledgeItemTextKey(OWNER, PROJECT, 1)
      const wrongUserKey = knowledgeItemTextKey(OWNER, PROJECT, 2)
      const fake = createFakeBucket({
        [wrongProjectKey]: OLD,
        [wrongUserKey]: OLD,
      })

      await sweep(fake)

      expect(fake.keys()).toEqual([])
    })

    it('treats an item deleted by a file cascade as gone', async () => {
      testDb.insertProject({ id: PROJECT, userId: OWNER })
      testDb.insertFile({ id: 5, userId: OWNER })

      const itemId = testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        kind: 'file',
        fileId: 5,
      })
      const key = knowledgeItemTextKey(OWNER, PROJECT, itemId)
      const fake = createFakeBucket({ [key]: OLD })

      await sweep(fake)

      expect(fake.has(key)).toBe(true)

      testDb.sqlite.prepare('delete from files where id = 5').run()
      testDb.sqlite
        .prepare('delete from project_knowledge_items where file_id = 5')
        .run()

      await sweep(fake)

      expect(fake.has(key)).toBe(false)
    })

    it('looks items up in chunks that fit the bound-parameter limit', async () => {
      testDb.insertProject({ id: PROJECT, userId: OWNER })

      const keys: Record<string, Date> = {}

      for (let itemId = 1; itemId <= 250; itemId++) {
        keys[knowledgeItemTextKey(OWNER, PROJECT, itemId)] = OLD

        if (itemId % 2 === 0) {
          testDb.insertItem({ id: itemId, userId: OWNER, projectId: PROJECT })
        }
      }

      const fake = createFakeBucket(keys)
      const allSpy = vi.spyOn(testDb.db, 'all')
      const result = await sweep(fake)

      expect(result.orphanItemObjectsDeleted).toBe(125)
      expect(fake.keys()).toHaveLength(125)

      for (const [query] of allSpy.mock.calls) {
        const { params } = (testDb.db as any).dialect.sqlToQuery(query)

        expect(params.length).toBeLessThanOrEqual(90)
      }
    })
  })

  describe('project objects', () => {
    it('deletes every matching object of a project that no longer exists', async () => {
      const itemKey = knowledgeItemTextKey(OWNER, 99, 1)
      const packKey = knowledgePackKey(OWNER, 99, 3)
      const indexKey = knowledgePackIndexKey(OWNER, 99, 3)
      const fake = createFakeBucket({
        [itemKey]: OLD,
        [packKey]: OLD,
        [indexKey]: OLD,
      })
      const result = await sweep(fake)

      expect(fake.keys()).toEqual([])
      expect(result.orphanProjectObjectsDeleted).toBe(3)
      expect(result.orphanItemObjectsDeleted).toBe(0)
    })

    it('deletes objects filed under a user that does not own the project', async () => {
      testDb.insertProject({ id: PROJECT, userId: OWNER })
      testDb.insertItem({ id: 1, userId: STRANGER, projectId: PROJECT })

      const key = knowledgeItemTextKey(STRANGER, PROJECT, 1)
      const fake = createFakeBucket({ [key]: OLD })

      await sweep(fake)

      expect(fake.has(key)).toBe(false)
    })

    it('leaves other projects of the same user alone', async () => {
      testDb.insertProject({ id: PROJECT, userId: OWNER })
      testDb.insertItem({ id: 1, userId: OWNER, projectId: PROJECT })

      const liveKey = knowledgeItemTextKey(OWNER, PROJECT, 1)
      const goneKey = knowledgeItemTextKey(OWNER, 99, 2)
      const fake = createFakeBucket({
        [liveKey]: OLD,
        [goneKey]: OLD,
      })

      await sweep(fake)

      expect(fake.keys()).toEqual([liveKey])
    })
  })

  describe('safety rails', () => {
    it('counts and leaves keys that do not match a known shape', async () => {
      const foreignKeys = [
        'knowledge/u1/p10/notes.txt',
        'knowledge/u1/p10/items/abc.md',
        'knowledge/u1/p10/items/007.md',
        'knowledge/u1/p10/items/1.md.bak',
        'knowledge/u1/p10/items/1/extra.md',
        'knowledge/u1/p10/pack/v1.txt',
        'knowledge/u1/p10/pack/v0.jsonl.gz',
        'knowledge/u1/p10/pack/v1.jsonl',
        'knowledge/u0/p10/items/1.md',
        'knowledge/ux/p10/items/1.md',
        'knowledge/u1/items/1.md',
        'knowledge/u1/p10/pack/../items/1.md',
        'knowledge/u99999999999999999999/p1/items/1.md',
        'knowledge/readme.txt',
      ]
      const keys: Record<string, Date> = {}

      for (const key of foreignKeys) {
        keys[key] = OLD
      }

      const fake = createFakeBucket(keys)
      const result = await sweep(fake)

      expect(fake.keys()).toEqual([...foreignKeys].sort())
      expect(fake.deleteKeys).not.toHaveBeenCalled()
      expect(result.unrecognizedCount).toBe(foreignKeys.length)
      expect(result.orphanItemObjectsDeleted).toBe(0)
      expect(result.orphanProjectObjectsDeleted).toBe(0)
    })

    it('never touches objects younger than the grace window', async () => {
      const youngOrphanItem = knowledgeItemTextKey(OWNER, 99, 1)
      const youngOrphanPack = knowledgePackKey(OWNER, 99, 1)
      const oldOrphanItem = knowledgeItemTextKey(OWNER, 99, 2)
      const fake = createFakeBucket({
        [youngOrphanItem]: YOUNG,
        [youngOrphanPack]: YOUNG,
        [oldOrphanItem]: OLD,
      })
      const result = await sweep(fake)

      expect(fake.keys()).toEqual([youngOrphanItem, youngOrphanPack].sort())
      expect(result.youngSkippedCount).toBe(2)
      expect(result.orphanProjectObjectsDeleted).toBe(1)
    })

    it('treats the grace boundary as inclusive and honours a custom grace', async () => {
      const key = knowledgeItemTextKey(OWNER, 99, 1)
      const fake = createFakeBucket({ [key]: YOUNG })

      await sweep(fake, { graceMs: 11 * 60 * 1000 })

      expect(fake.has(key)).toBe(true)

      await sweep(fake, { graceMs: 10 * 60 * 1000 })

      expect(fake.has(key)).toBe(false)
    })

    it('treats an object without an upload time as young', async () => {
      const key = knowledgeItemTextKey(OWNER, 99, 1)
      const fake = createFakeBucket({ [key]: OLD })

      fake.list.mockResolvedValueOnce({
        objects: [{ key }],
        truncated: false,
        cursor: undefined,
      })

      const result = await sweep(fake)

      expect(fake.deleteKeys).not.toHaveBeenCalled()
      expect(result.youngSkippedCount).toBe(1)
    })

    it('only lists under the knowledge prefix', async () => {
      const fake = createFakeBucket({
        'files/photo.png': OLD,
        'other/knowledge/u1/p10/items/1.md': OLD,
      })

      await sweep(fake)

      expect(fake.listPrefixes[0]).toBe('knowledge/')
      expect(fake.keys()).toEqual([
        'files/photo.png',
        'other/knowledge/u1/p10/items/1.md',
      ])
    })
  })

  describe('pack versions', () => {
    function putPacks(
      fake: ReturnType<typeof createFakeBucket>,
      versions: number[],
      uploaded: Date = OLD,
    ): void {
      for (const version of versions) {
        fake.put(knowledgePackKey(OWNER, PROJECT, version), uploaded)
        fake.put(knowledgePackIndexKey(OWNER, PROJECT, version), uploaded)
      }
    }

    function packVersionsLeft(
      fake: ReturnType<typeof createFakeBucket>,
    ): number[] {
      const versions = new Set<number>()

      for (const key of fake.keys()) {
        const match = /\/pack\/v(\d+)\./.exec(key)

        if (match) {
          versions.add(Number(match[1]))
        }
      }

      return [...versions].sort((first, second) => first - second)
    }

    it('keeps the two newest versions and deletes the rest', async () => {
      testDb.insertProject({
        id: PROJECT,
        userId: OWNER,
        knowledgePackVersion: 5,
      })

      const fake = createFakeBucket()

      putPacks(fake, [1, 2, 3, 4, 5])

      const result = await sweep(fake)

      expect(packVersionsLeft(fake)).toEqual([4, 5])
      expect(result.stalePackObjectsDeleted).toBe(6)
    })

    it('keeps the next-lower existing version when versions skip numbers', async () => {
      testDb.insertProject({
        id: PROJECT,
        userId: OWNER,
        knowledgePackVersion: 9,
      })

      const fake = createFakeBucket()

      putPacks(fake, [2, 6, 9])

      await sweep(fake)

      expect(packVersionsLeft(fake)).toEqual([6, 9])
    })

    it('never deletes a version at or above the recorded pack version', async () => {
      testDb.insertProject({
        id: PROJECT,
        userId: OWNER,
        knowledgePackVersion: 3,
      })

      const fake = createFakeBucket()

      putPacks(fake, [1, 2, 3, 4, 5])

      await sweep(fake)

      expect(packVersionsLeft(fake)).toEqual([2, 3, 4, 5])
    })

    it('keeps the previous pack even when a newer build is in flight', async () => {
      testDb.insertProject({
        id: PROJECT,
        userId: OWNER,
        knowledgePackVersion: 4,
      })

      const fake = createFakeBucket()

      putPacks(fake, [2, 3, 4, 5])

      await sweep(fake)

      expect(packVersionsLeft(fake)).toEqual([3, 4, 5])
    })

    it('keeps every pack of a project that has no recorded pack version', async () => {
      testDb.insertProject({
        id: PROJECT,
        userId: OWNER,
        knowledgePackVersion: null,
      })

      const fake = createFakeBucket()

      putPacks(fake, [1, 2, 3, 4])

      const result = await sweep(fake)

      expect(packVersionsLeft(fake)).toEqual([1, 2, 3, 4])
      expect(result.stalePackObjectsDeleted).toBe(0)
    })

    it('leaves young stale packs for a later run', async () => {
      testDb.insertProject({
        id: PROJECT,
        userId: OWNER,
        knowledgePackVersion: 5,
      })

      const fake = createFakeBucket()

      putPacks(fake, [1, 2], YOUNG)
      putPacks(fake, [3, 4, 5], OLD)

      const result = await sweep(fake)

      expect(packVersionsLeft(fake)).toEqual([1, 2, 4, 5])
      expect(result.stalePackObjectsDeleted).toBe(2)
      expect(result.youngSkippedCount).toBeGreaterThan(0)
    })

    it('lists a project pack prefix once per run however many pages hold it', async () => {
      testDb.insertProject({
        id: PROJECT,
        userId: OWNER,
        knowledgePackVersion: 6,
      })

      const fake = createFakeBucket()

      putPacks(fake, [1, 2, 3, 4, 5, 6])

      await sweep(fake, { batchSize: 3 })

      const packListings = fake.listPrefixes.filter((prefix) => {
        return prefix.endsWith('/pack/')
      })

      expect(packListings).toHaveLength(1)
      expect(packVersionsLeft(fake)).toEqual([5, 6])
    })

    it('does not delete pack objects that match no pack shape', async () => {
      testDb.insertProject({
        id: PROJECT,
        userId: OWNER,
        knowledgePackVersion: 5,
      })

      const fake = createFakeBucket({
        'knowledge/u1/p10/pack/v1.jsonl': OLD,
        'knowledge/u1/p10/pack/v1.txt': OLD,
      })

      putPacks(fake, [1, 2, 3, 4, 5])
      await sweep(fake)

      expect(fake.has('knowledge/u1/p10/pack/v1.jsonl')).toBe(true)
      expect(fake.has('knowledge/u1/p10/pack/v1.txt')).toBe(true)
    })
  })

  describe('paging, ordering and bounds', () => {
    it('works through every page and keeps R2 calls sequential', async () => {
      testDb.insertProject({ id: PROJECT, userId: OWNER })

      const keys: Record<string, Date> = {}

      for (let itemId = 1; itemId <= 25; itemId++) {
        keys[knowledgeItemTextKey(OWNER, PROJECT, itemId)] = OLD

        if (itemId <= 10) {
          testDb.insertItem({ id: itemId, userId: OWNER, projectId: PROJECT })
        }
      }

      const fake = createFakeBucket(keys)
      const result = await sweep(fake, { batchSize: 7 })

      expect(result.pagesScanned).toBe(4)
      expect(result.scannedCount).toBe(25)
      expect(result.orphanItemObjectsDeleted).toBe(15)
      expect(fake.keys()).toHaveLength(10)
      expect(fake.maxInFlight()).toBe(1)
      expect(result.hasMore).toBe(false)
    })

    it('never asks R2 for more than 1000 objects per page', async () => {
      const fake = createFakeBucket()

      await sweep(fake, { batchSize: 50_000 })

      expect(fake.list.mock.calls[0]?.[0].limit).toBe(1000)
    })

    it('batches deletes into one call per page', async () => {
      const keys: Record<string, Date> = {}

      for (let itemId = 1; itemId <= 30; itemId++) {
        keys[knowledgeItemTextKey(OWNER, 99, itemId)] = OLD
      }

      const fake = createFakeBucket(keys)

      await sweep(fake, { batchSize: 1000 })

      expect(fake.deleteKeys).toHaveBeenCalledTimes(1)
      expect(fake.deleteCalls[0]).toHaveLength(30)
    })

    it('stops at the runtime limit and reports that more remains', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)

      const keys: Record<string, Date> = {}

      for (let itemId = 1; itemId <= 20; itemId++) {
        keys[knowledgeItemTextKey(OWNER, 99, itemId)] = OLD
      }

      const fake = createFakeBucket(keys)

      fake.list.mockImplementation(async (options) => {
        vi.advanceTimersByTime(600)

        const matching = Object.keys(keys).sort().filter((key) => {
          return !options.cursor || key > options.cursor
        })
        const page = matching.slice(0, options.limit)
        const truncated = matching.length > page.length

        return {
          objects: page.map((key) => {
            return { key, uploaded: OLD }
          }),
          truncated,
          cursor: truncated ? page[page.length - 1] : undefined,
        }
      })

      const result = await sweep(fake, { batchSize: 5, maxRuntimeMs: 1000 })

      expect(result.pagesScanned).toBe(2)
      expect(result.hasMore).toBe(true)
    })

    it('reports more remaining when R2 truncates without a cursor', async () => {
      const fake = createFakeBucket()

      fake.list.mockResolvedValueOnce({
        objects: [],
        truncated: true,
        cursor: undefined,
      })

      const result = await sweep(fake)

      expect(result.hasMore).toBe(true)
      expect(fake.list).toHaveBeenCalledTimes(1)
    })

    it('stops cleanly and counts the keys when a delete fails', async () => {
      const keys: Record<string, Date> = {}

      for (let itemId = 1; itemId <= 4; itemId++) {
        keys[knowledgeItemTextKey(OWNER, 99, itemId)] = OLD
      }

      const fake = createFakeBucket(keys)
      const logger = { set: vi.fn() }

      fake.deleteKeys.mockRejectedValueOnce(new Error('R2 unavailable'))

      const result = await sweep(fake, { logger })

      expect(result.failedDeleteCount).toBe(4)
      expect(result.orphanProjectObjectsDeleted).toBe(0)
      expect(result.hasMore).toBe(true)
      expect(fake.keys()).toHaveLength(4)
      expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
        attributes: {
          knowledgeSweepDeleteFailure: expect.objectContaining({
            keyCount: 4,
          }),
        },
      }))
    })

    it('is a no-op on an empty bucket', async () => {
      const fake = createFakeBucket()
      const result = await sweep(fake)

      expect(result).toMatchObject({
        pagesScanned: 1,
        scannedCount: 0,
        hasMore: false,
        failedDeleteCount: 0,
      })
      expect(fake.deleteKeys).not.toHaveBeenCalled()
    })
  })

  describe('listing cursor kept in KV', () => {
    const CURSOR_KEY = 'knowledge-sweep-cursor'

    function createFakeKv() {
      const values = new Map<string, string>()

      return {
        values,
        get: vi.fn(async (key: string) => {
          return values.get(key) ?? null
        }),
        put: vi.fn(async (key: string, value: string) => {
          values.set(key, value)
        }),
        delete: vi.fn(async (key: string) => {
          values.delete(key)
        }),
      }
    }

    function orphanKeys(count: number): Record<string, Date> {
      const keys: Record<string, Date> = {}

      for (let itemId = 1; itemId <= count; itemId++) {
        keys[knowledgeItemTextKey(OWNER, 99, itemId)] = OLD
      }

      return keys
    }

    function slowList(fake: ReturnType<typeof createFakeBucket>) {
      fake.list.mockImplementation(async (options) => {
        vi.advanceTimersByTime(600)

        const matching = fake.keys().filter((key) => {
          return !options.cursor || key > options.cursor
        })
        const page = matching.slice(0, options.limit)
        const truncated = matching.length > page.length

        return {
          objects: page.map((key) => {
            return { key, uploaded: OLD }
          }),
          truncated,
          cursor: truncated ? page[page.length - 1] : undefined,
        }
      })
    }

    let kv: ReturnType<typeof createFakeKv>

    beforeEach(() => {
      kv = createFakeKv()
      vi.stubGlobal('useKV', () => kv)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('keeps the cursor for 6 hours when a run stops at its runtime limit', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)

      const fake = createFakeBucket(orphanKeys(20))

      slowList(fake)

      const result = await sweep(fake, { batchSize: 5, maxRuntimeMs: 1000 })

      expect(result.hasMore).toBe(true)
      expect(kv.put).toHaveBeenCalledTimes(1)
      expect(kv.put).toHaveBeenCalledWith(
        CURSOR_KEY,
        expect.any(String),
        { expirationTtl: 6 * 60 * 60 },
      )
      expect(kv.values.get(CURSOR_KEY)).toMatch(
        /^knowledge\/u1\/p99\/items\/\d+\.md$/,
      )
    })

    it('resumes from the stored cursor and clears it when the listing finishes', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)

      const fake = createFakeBucket(orphanKeys(20))

      slowList(fake)
      await sweep(fake, { batchSize: 5, maxRuntimeMs: 1000 })

      const storedCursor = kv.values.get(CURSOR_KEY)

      fake.list.mockClear()

      const result = await sweep(fake, { batchSize: 5, maxRuntimeMs: 1000 })

      expect(storedCursor).toBeDefined()
      expect(fake.list.mock.calls[0]![0].cursor).toBe(storedCursor)
      expect(result.pagesScanned).toBeGreaterThanOrEqual(1)
    })

    it('eventually covers a bucket larger than one run budget', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)

      const fake = createFakeBucket(orphanKeys(30))
      let runs = 0

      slowList(fake)

      while (fake.keys().length > 0 && runs < 10) {
        await sweep(fake, { batchSize: 5, maxRuntimeMs: 1000 })
        runs++
      }

      expect(fake.keys()).toEqual([])
      expect(runs).toBeGreaterThan(1)

      await sweep(fake, { batchSize: 5, maxRuntimeMs: 1000 })

      expect(kv.values.has(CURSOR_KEY)).toBe(false)
    })

    it('clears the cursor when a listing finishes within the budget', async () => {
      kv.values.set(CURSOR_KEY, 'stale')

      const fake = createFakeBucket()

      await sweep(fake)

      expect(kv.put).not.toHaveBeenCalled()
      expect(kv.delete).toHaveBeenCalledWith(CURSOR_KEY)
      expect(kv.values.has(CURSOR_KEY)).toBe(false)
    })

    it('starts from the beginning when no cursor is stored', async () => {
      const fake = createFakeBucket()

      await sweep(fake)

      expect(fake.list.mock.calls[0]![0].cursor).toBeUndefined()
    })

    it('starts from the beginning and logs when KV cannot be read', async () => {
      kv.get.mockRejectedValueOnce(new Error('KV down'))

      const fake = createFakeBucket()
      const logger = { set: vi.fn() }
      const result = await sweep(fake, { logger })

      expect(fake.list.mock.calls[0]![0].cursor).toBeUndefined()
      expect(result.hasMore).toBe(false)
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          knowledgeSweepCursor: { operation: 'read', error: 'KV down' },
        },
      })
    })

    it('still finishes the run when the cursor cannot be written', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      kv.put.mockRejectedValue(new Error('KV down'))

      const fake = createFakeBucket(orphanKeys(20))
      const logger = { set: vi.fn() }

      slowList(fake)

      const result = await sweep(fake, {
        batchSize: 5,
        maxRuntimeMs: 1000,
        logger,
      })

      expect(result.hasMore).toBe(true)
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          knowledgeSweepCursor: { operation: 'write', error: 'KV down' },
        },
      })
    })

    it('resets the cursor after a failed delete so the next run starts over', async () => {
      const fake = createFakeBucket(orphanKeys(4))

      fake.deleteKeys.mockRejectedValueOnce(new Error('R2 unavailable'))

      const result = await sweep(fake)

      expect(result.hasMore).toBe(true)
      expect(kv.put).not.toHaveBeenCalled()
      expect(kv.delete).toHaveBeenCalledWith(CURSOR_KEY)
    })

    it('moves on to the next page when a delete fails instead of starting over', async () => {
      const fake = createFakeBucket(orphanKeys(6))
      const logger = { set: vi.fn() }

      fake.deleteKeys.mockRejectedValueOnce(new Error('R2 unavailable'))

      const result = await sweep(fake, { batchSize: 3, logger })

      expect(result.pagesScanned).toBe(2)
      expect(result.failedDeleteCount).toBe(3)
      expect(result.orphanProjectObjectsDeleted).toBe(3)
      expect(result.hasMore).toBe(true)
      expect(fake.keys()).toHaveLength(3)
      expect(kv.put).not.toHaveBeenCalled()
      expect(kv.delete).toHaveBeenCalledWith(CURSOR_KEY)
    })

    it('skips a page that throws and keeps sweeping the rest', async () => {
      const fake = createFakeBucket(orphanKeys(6))
      const logger = { set: vi.fn() }

      vi.spyOn(testDb.db, 'all').mockRejectedValueOnce(new Error('D1 down'))

      const result = await sweep(fake, { batchSize: 3, logger })

      expect(result.pagesScanned).toBe(2)
      expect(result.hasMore).toBe(true)
      expect(fake.keys()).toHaveLength(3)
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          knowledgeSweepPageFailure: { error: 'D1 down' },
        },
      })
    })

    it('ends the run after three failed pages and keeps the cursor past them', async () => {
      const fake = createFakeBucket(orphanKeys(12))

      fake.deleteKeys.mockRejectedValue(new Error('R2 unavailable'))

      const result = await sweep(fake, { batchSize: 2 })

      expect(result.pagesScanned).toBe(3)
      expect(result.hasMore).toBe(true)
      expect(kv.values.get(CURSOR_KEY)).toBe(fake.keys()[5])
    })

    it('advances the cursor past a page cut short by the runtime limit', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)

      const fake = createFakeBucket()
      const projectIds = [10, 11, 12, 13]

      for (const projectId of projectIds) {
        testDb.insertProject({
          id: projectId,
          userId: OWNER,
          knowledgePackVersion: 5,
        })

        for (let version = 1; version <= 5; version++) {
          fake.put(knowledgePackKey(OWNER, projectId, version), OLD)
        }
      }

      const originalList = fake.list.getMockImplementation()!

      fake.list.mockImplementation(async (options) => {
        vi.advanceTimersByTime(600)

        return originalList(options)
      })

      const result = await sweep(fake, { batchSize: 15, maxRuntimeMs: 1000 })
      const firstPage = await fake.list.mock.results[0]!.value

      expect(result.hasMore).toBe(true)
      expect(firstPage.cursor).toBeDefined()
      expect(kv.values.get(CURSOR_KEY)).toBe(firstPage.cursor)

      fake.list.mockClear()
      await sweep(fake, { batchSize: 15, maxRuntimeMs: 1000 })

      expect(fake.list.mock.calls[0]![0].cursor).toBe(firstPage.cursor)
    })

    it('does not keep a cursor when R2 truncates without one', async () => {
      const fake = createFakeBucket()

      kv.values.set(CURSOR_KEY, 'stale')
      fake.list.mockResolvedValueOnce({
        objects: [],
        truncated: true,
        cursor: undefined,
      })

      const result = await sweep(fake)

      expect(result.hasMore).toBe(true)
      expect(kv.put).not.toHaveBeenCalled()
      expect(kv.values.has(CURSOR_KEY)).toBe(false)
    })
  })

  describe('unscreened knowledge re-screening', () => {
    it('runs the re-screen pass before the R2 pass and reports it',
      async () => {
        const queue = {
          put: vi.fn(),
          delete: vi.fn(),
          list: vi.fn(async () => ({ keys: [] })),
        }
        const result = await sweep(createFakeBucket(), {
          unscreenedQueue: queue,
        })

        expect(queue.list).toHaveBeenCalledWith({
          prefix: 'knowledge-unscreened:',
          limit: 10,
        })
        expect(result.rescreen).toEqual({
          listed: 0,
          clean: 0,
          flagged: 0,
          dropped: 0,
          deferred: 0,
        })
      })

    it('still collects R2 garbage when the re-screen pass fails',
      async () => {
        testDb.insertProject({ id: PROJECT, userId: OWNER })

        const orphanKey = knowledgeItemTextKey(OWNER, PROJECT, 2)
        const fake = createFakeBucket({ [orphanKey]: OLD })
        const logger = { set: vi.fn() }
        const result = await sweep(fake, {
          logger,
          unscreenedQueue: {
            put: vi.fn(),
            delete: vi.fn(),
            list: vi.fn(async () => {
              throw new Error('KV unavailable')
            }),
          },
        })

        expect(result.rescreen).toBeNull()
        expect(result.orphanItemObjectsDeleted).toBe(1)
        expect(logger.set).toHaveBeenCalledWith({
          attributes: {
            knowledgeRescreenFailure: { error: 'KV unavailable' },
          },
        })
      })
  })
})
