import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  ARTIFACT_STORAGE_BODY_MAX_BYTES,
  ARTIFACT_STORAGE_MAX_BYTES,
  ARTIFACT_STORAGE_MAX_KEYS,
  ARTIFACT_STORAGE_MAX_VALUE_BYTES,
  ARTIFACT_STORAGE_WRITE_LIMIT,
} from '#shared/utils/artifacts'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { createMemoryBlobStore } from '../../setup/helpers/artifacts-store'
import type { MemoryBlobStore } from '../../setup/helpers/artifacts-store'

const mocks = vi.hoisted(() => ({
  featureActive: true,
  requireFeature: vi.fn(),
  logger: { set: vi.fn() },
  sessionUserId: 0,
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/features/guards', () => ({
  requireFeature: mocks.requireFeature,
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

const { createArtifact, decodeArtifactId } = await import(
  '~~/server/utils/artifacts/store'
)
const { serializeArtifactStorageValue } = await import(
  '~~/server/utils/artifacts/viewer-storage'
)

async function importHandler(path: string) {
  const module = await import(path)

  return module.default as (event: unknown) => Promise<any>
}

const handlers = {
  list: () => importHandler(
    '../../../server/api/v1/artifacts/[id]/storage/index.get',
  ),
  put: () => importHandler(
    '../../../server/api/v1/artifacts/[id]/storage/[key].put',
  ),
  remove: () => importHandler(
    '../../../server/api/v1/artifacts/[id]/storage/[key].delete',
  ),
  reset: () => importHandler(
    '../../../server/api/v1/artifacts/[id]/storage/index.delete',
  ),
}

type HandlerName = keyof typeof handlers

function createEvent(input: {
  params?: Record<string, string>
  body?: unknown
} = {}) {
  return {
    context: {},
    params: input.params ?? {},
    body: input.body,
    res: { headers: new Headers() },
  }
}

function createMemoryKv() {
  const entries = new Map<string, string>()

  return {
    entries,
    get: vi.fn(async (key: string) => {
      return entries.get(key) ?? null
    }),
    put: vi.fn(async (key: string, value: string) => {
      entries.set(key, value)
    }),
  }
}

function byteString(bytes: number): string {
  return 'x'.repeat(bytes)
}

const SERIALIZED_QUOTES_BYTES = 2
const MAX_VALUE_STRING_BYTES
  = ARTIFACT_STORAGE_MAX_VALUE_BYTES - SERIALIZED_QUOTES_BYTES

describe('artifact viewer storage API', () => {
  let testDb: MemoryExtractionTestDb
  let blobStore: MemoryBlobStore
  let kv: ReturnType<typeof createMemoryKv>
  let ownerId: number
  let strangerId: number
  let artifactId: string
  let internalId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    blobStore = createMemoryBlobStore()
    kv = createMemoryKv()
    ownerId = await seedUser(testDb.db)
    strangerId = await seedUser(testDb.db)
    mocks.sessionUserId = ownerId
    mocks.featureActive = true
    mocks.requireFeature.mockReset()
    mocks.requireFeature.mockImplementation(async () => {
      if (!mocks.featureActive) {
        throw Object.assign(new Error('Not found'), { status: 404 })
      }

      return { active: true }
    })

    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useUserSession', async () => {
      return mocks.sessionUserId
        ? { user: { id: String(mocks.sessionUserId) } }
        : null
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
    vi.stubGlobal('getRequestHeader', (_event: unknown, name: string) => {
      return name === 'content-length' ? '100' : undefined
    })
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      validate: (value: unknown) => unknown,
    ) => validate(event.body))

    const created = await createArtifact({
      db: testDb.db,
      storage: blobStore,
      userId: ownerId,
      kind: 'html',
      title: 'Photosynthesis quiz',
      content: '<p>Question 1</p>',
      createdVia: 'chat',
      createdBy: 'model',
    })

    artifactId = created.artifactId
    internalId = decodeArtifactId(artifactId) as number
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  async function call(
    name: HandlerName,
    input: { key?: string, body?: unknown, id?: string } = {},
  ) {
    const handler = await handlers[name]()
    const event = createEvent({
      params: {
        id: input.id ?? artifactId,
        ...(input.key === undefined ? {} : { key: input.key }),
      },
      body: input.body,
    })
    const result = await handler(event)

    return { result, event }
  }

  function put(key: string, value: unknown) {
    return call('put', { key, body: { value } })
  }

  async function seedRows(
    viewerUserId: number,
    count: number,
    bytes = 10,
    artifact: number = internalId,
  ) {
    for (let index = 0; index < count; index++) {
      await testDb.db.insert(schema.artifactStorage).values({
        artifactId: artifact,
        viewerUserId,
        key: `seed-${index}`,
        value: 'seed',
        bytes,
      })
    }
  }

  async function readRows(viewerUserId: number) {
    return testDb.db
      .select()
      .from(schema.artifactStorage)
      .where(and(
        eq(schema.artifactStorage.artifactId, internalId),
        eq(schema.artifactStorage.viewerUserId, viewerUserId),
      ))
  }

  describe('saving and reading', () => {
    it('returns an empty snapshot with a private no-store header',
      async () => {
        const { result, event } = await call('list')

        expect(result).toEqual({ items: [], keys: 0, bytes: 0 })
        expect(event.res.headers.get('Cache-Control'))
          .toBe('private, no-store')
      })

    it('saves a value and reads it back sorted by key', async () => {
      const { result } = await put('score', { points: 3 })

      expect(result).toEqual({
        keys: 1,
        bytes: JSON.stringify({ points: 3 }).length,
      })

      await put('answers', ['a', 'b'])

      const { result: snapshot } = await call('list')

      expect(snapshot.items).toEqual([
        { key: 'answers', value: ['a', 'b'] },
        { key: 'score', value: { points: 3 } },
      ])
      expect(snapshot.keys).toBe(2)
      expect(snapshot.bytes).toBe(
        JSON.stringify(['a', 'b']).length
        + JSON.stringify({ points: 3 }).length,
      )
    })

    it('round-trips every JSON value type', async () => {
      const values: Record<string, unknown> = {
        text: 'hello',
        number: 42,
        zero: 0,
        flag: false,
        nothing: null,
        list: [1, 'two', { three: 3 }],
        nested: { deep: { deeper: [true] } },
        empty: '',
      }

      for (const [key, value] of Object.entries(values)) {
        await put(key, value)
      }

      const { result } = await call('list')
      const read = Object.fromEntries(result.items.map((item: {
        key: string
        value: unknown
      }) => {
        return [item.key, item.value]
      }))

      expect(read).toEqual(values)
    })

    it('accepts every character of the key alphabet', async () => {
      const key = 'Quiz.1_final:answer-2'

      await put(key, 1)

      const { result } = await call('list')

      expect(result.items).toEqual([{ key, value: 1 }])
    })

    it('replaces a value on the same key and keeps one row', async () => {
      await put('score', 'first')

      const { result } = await put('score', 'second value')
      const { result: snapshot } = await call('list')

      expect(result).toEqual({
        keys: 1,
        bytes: JSON.stringify('second value').length,
      })
      expect(snapshot.items).toEqual([
        { key: 'score', value: 'second value' },
      ])
    })

    it('stores multi-byte text by its UTF-8 size', async () => {
      const { result } = await put('euro', '€€')

      expect(result.bytes).toBe(8)
    })

    it('records the totals on the request logger', async () => {
      await put('score', 1)

      expect(mocks.logger.set).toHaveBeenCalledWith({
        attributes: { artifacts: { storageKeys: 1, storageBytes: 1 } },
      })
    })
  })

  describe('deleting', () => {
    it('deletes one key and returns the new totals', async () => {
      await put('first', 'aa')
      await put('second', 'bbb')

      const { result } = await call('remove', { key: 'first' })

      expect(result).toEqual({ keys: 1, bytes: 5 })
      expect((await call('list')).result.items).toEqual([
        { key: 'second', value: 'bbb' },
      ])
    })

    it('answers with the unchanged totals for a key that is not stored',
      async () => {
        await put('first', 'aa')

        const { result } = await call('remove', { key: 'missing' })

        expect(result).toEqual({ keys: 1, bytes: 4 })
      })

    it('resets every key of the viewer for the artifact', async () => {
      await put('first', 'aa')
      await put('second', 'bbb')

      const { result } = await call('reset')

      expect(result).toEqual({ keys: 0, bytes: 0, deleted: 2 })
      expect((await call('list')).result).toEqual({
        items: [],
        keys: 0,
        bytes: 0,
      })
    })

    it('resets nothing without error when no key is saved', async () => {
      const { result } = await call('reset')

      expect(result).toEqual({ keys: 0, bytes: 0, deleted: 0 })
    })

    it('leaves the saved progress of another artifact untouched',
      async () => {
        const second = await createArtifact({
          db: testDb.db,
          storage: blobStore,
          userId: ownerId,
          kind: 'html',
          title: 'Second',
          content: '<p>Second</p>',
          createdVia: 'chat',
          createdBy: 'model',
        })

        await put('first', 'aa')
        await call('put', {
          id: second.artifactId,
          key: 'other',
          body: { value: 'bb' },
        })
        await call('reset')

        const { result } = await call('list', { id: second.artifactId })

        expect(result.items).toEqual([{ key: 'other', value: 'bb' }])
      })
  })

  describe('limits', () => {
    it('rejects the 65th key with 413 and the used count', async () => {
      await seedRows(ownerId, ARTIFACT_STORAGE_MAX_KEYS)

      await expect(put('one-too-many', 'x')).rejects.toMatchObject({
        status: 413,
        code: 'artifact_storage_full',
        why: '64 of 64 keys are used.',
      })
      await expect(readRows(ownerId))
        .resolves.toHaveLength(ARTIFACT_STORAGE_MAX_KEYS)
    })

    it('accepts the 64th key', async () => {
      await seedRows(ownerId, ARTIFACT_STORAGE_MAX_KEYS - 1)

      const { result } = await put('last', 'x')

      expect(result.keys).toBe(ARTIFACT_STORAGE_MAX_KEYS)
    })

    it('still replaces an existing key at 64 keys', async () => {
      await seedRows(ownerId, ARTIFACT_STORAGE_MAX_KEYS)

      const { result } = await put('seed-0', 'changed')

      expect(result.keys).toBe(ARTIFACT_STORAGE_MAX_KEYS)
    })

    it('rejects one value over 32 KB with 413 and the sizes', async () => {
      await expect(put('big', byteString(MAX_VALUE_STRING_BYTES + 1)))
        .rejects.toMatchObject({
          status: 413,
          code: 'artifact_storage_full',
          why: 'The value is 33 KB; one value can be at most 32 KB.',
        })
      await expect(readRows(ownerId)).resolves.toHaveLength(0)
    })

    it('accepts one value of exactly 32 KB serialised', async () => {
      const { result } = await put('big', byteString(MAX_VALUE_STRING_BYTES))

      expect(result.bytes).toBe(ARTIFACT_STORAGE_MAX_VALUE_BYTES)
    })

    it('measures a value in UTF-8 bytes, not characters', async () => {
      const characters = Math.floor(ARTIFACT_STORAGE_MAX_VALUE_BYTES / 3) + 1

      await expect(put('euros', '€'.repeat(characters)))
        .rejects.toMatchObject({ status: 413 })
    })

    it('rejects a write that takes the total over 100 KB', async () => {
      await put('first', byteString(MAX_VALUE_STRING_BYTES))
      await put('second', byteString(MAX_VALUE_STRING_BYTES))
      await put('third', byteString(MAX_VALUE_STRING_BYTES))

      await expect(put('fourth', byteString(MAX_VALUE_STRING_BYTES)))
        .rejects.toMatchObject({
          status: 413,
          code: 'artifact_storage_full',
          why: '96 KB of 100 KB are used and this value needs 32 KB.',
        })
      await expect(readRows(ownerId)).resolves.toHaveLength(3)
    })

    it('accepts a write that lands exactly on 100 KB', async () => {
      await seedRows(
        ownerId,
        1,
        ARTIFACT_STORAGE_MAX_BYTES - 5,
      )

      const { result } = await put('fill', 'abc')

      expect(result.bytes).toBe(ARTIFACT_STORAGE_MAX_BYTES)
    })

    it('rejects a write one byte past 100 KB', async () => {
      await seedRows(
        ownerId,
        1,
        ARTIFACT_STORAGE_MAX_BYTES - 4,
      )

      await expect(put('fill', 'abc')).rejects.toMatchObject({ status: 413 })
    })

    it('frees the old size when a value is replaced', async () => {
      await put('first', byteString(MAX_VALUE_STRING_BYTES))
      await put('second', byteString(MAX_VALUE_STRING_BYTES))
      await put('third', byteString(MAX_VALUE_STRING_BYTES))

      const { result } = await put('third', 'small')

      expect(result.bytes).toBe(
        ARTIFACT_STORAGE_MAX_VALUE_BYTES * 2 + '"small"'.length,
      )
    })

    it('frees room after a delete', async () => {
      await seedRows(ownerId, ARTIFACT_STORAGE_MAX_KEYS)
      await call('remove', { key: 'seed-0' })

      const { result } = await put('fresh', 'x')

      expect(result.keys).toBe(ARTIFACT_STORAGE_MAX_KEYS)
    })

    it('counts the caps for each viewer on their own', async () => {
      await seedRows(strangerId, ARTIFACT_STORAGE_MAX_KEYS)

      const { result } = await put('mine', 'x')

      expect(result).toEqual({ keys: 1, bytes: 3 })
    })

    it('refuses a value that JSON cannot represent', () => {
      expect(() => serializeArtifactStorageValue(undefined))
        .toThrowError(expect.objectContaining({ status: 400 }))
      expect(() => serializeArtifactStorageValue(() => 1))
        .toThrowError(expect.objectContaining({ status: 400 }))
      expect(serializeArtifactStorageValue({ ok: [1] })).toBe('{"ok":[1]}')
    })
  })

  describe('parallel writes', () => {
    const TEN_KB_STRING_BYTES = 10 * 1024 - SERIALIZED_QUOTES_BYTES

    it('never lets parallel writes to different keys pass the byte cap',
      async () => {
        const outcomes = await Promise.allSettled(
          Array.from({ length: 30 }, (_item, index) => {
            return put(`key-${index}`, byteString(TEN_KB_STRING_BYTES))
          }),
        )
        const rows = await readRows(ownerId)
        const storedBytes = rows.reduce((total, row) => {
          return total + row.bytes
        }, 0)

        expect(outcomes.filter(({ status }) => {
          return status === 'fulfilled'
        })).toHaveLength(ARTIFACT_STORAGE_MAX_BYTES / (10 * 1024))
        expect(outcomes.filter(({ status }) => {
          return status === 'rejected'
        }).every((outcome) => {
          return (outcome as PromiseRejectedResult).reason.status === 413
        })).toBe(true)
        expect(storedBytes).toBeLessThanOrEqual(ARTIFACT_STORAGE_MAX_BYTES)
        expect(rows).toHaveLength(ARTIFACT_STORAGE_MAX_BYTES / (10 * 1024))
      })

    it('never lets parallel writes to different keys pass the key cap',
      async () => {
        const outcomes = await Promise.allSettled(
          Array.from({ length: 100 }, (_item, index) => {
            return put(`key-${index}`, 'x')
          }),
        )

        expect(outcomes.filter(({ status }) => {
          return status === 'fulfilled'
        })).toHaveLength(ARTIFACT_STORAGE_MAX_KEYS)
        expect(outcomes.filter(({ status }) => {
          return status === 'rejected'
        }).every((outcome) => {
          return (outcome as PromiseRejectedResult).reason.status === 413
        })).toBe(true)
        await expect(readRows(ownerId))
          .resolves.toHaveLength(ARTIFACT_STORAGE_MAX_KEYS)
      })

    it('keeps the byte cap with 60 parallel writes of 32 KB', async () => {
      const outcomes = await Promise.allSettled(
        Array.from({ length: 60 }, (_item, index) => {
          return put(`key-${index}`, byteString(MAX_VALUE_STRING_BYTES))
        }),
      )
      const rows = await readRows(ownerId)

      expect(outcomes.filter(({ status }) => {
        return status === 'fulfilled'
      })).toHaveLength(3)
      expect(rows).toHaveLength(3)
    })

    it('lets parallel writes to one key replace each other', async () => {
      const outcomes = await Promise.allSettled(
        Array.from({ length: 8 }, (_item, index) => {
          return put('same', byteString(MAX_VALUE_STRING_BYTES - index))
        }),
      )

      expect(outcomes.every(({ status }) => {
        return status === 'fulfilled'
      })).toBe(true)
      await expect(readRows(ownerId)).resolves.toHaveLength(1)
    })

    it('counts parallel writes of two viewers separately', async () => {
      await seedRows(strangerId, ARTIFACT_STORAGE_MAX_KEYS)
      await Promise.all(Array.from({ length: 5 }, (_item, index) => {
        return put(`mine-${index}`, 'x')
      }))

      await expect(readRows(ownerId)).resolves.toHaveLength(5)
      await expect(readRows(strangerId))
        .resolves.toHaveLength(ARTIFACT_STORAGE_MAX_KEYS)
    })
  })

  describe('request validation', () => {
    it.each([
      ['a space', 'bad key'],
      ['a slash', 'a/b'],
      ['a unicode letter', 'résumé'],
      ['129 characters', 'k'.repeat(129)],
      ['an empty key', ''],
      ['a single dot', '.'],
      ['two dots', '..'],
    ])('answers 400 for a key with %s', async (_label, key) => {
      await expect(put(key, 1)).rejects.toMatchObject({ status: 400 })
      await expect(call('remove', { key }))
        .rejects.toMatchObject({ status: 400 })
    })

    it('accepts a 128 character key', async () => {
      const { result } = await put('k'.repeat(128), 1)

      expect(result.keys).toBe(1)
    })

    it.each(['...', '.a', 'a.', 'a..b'])(
      'accepts the key %s that contains dots next to other characters',
      async (key) => {
        const { result } = await put(key, 1)

        expect(result.keys).toBe(1)
      },
    )

    it('answers 400 for a dot key without touching the database or KV',
      async () => {
        await expect(put('..', 1)).rejects.toMatchObject({ status: 400 })
        await expect(readRows(ownerId)).resolves.toHaveLength(0)
        expect(kv.put).not.toHaveBeenCalled()
      })

    it('answers 400 for a value JSON.stringify throws on', async () => {
      let deep: unknown = 'leaf'

      for (let depth = 0; depth < 1_000_000; depth++) {
        deep = [deep]
      }

      await expect(put('deep', deep)).rejects.toMatchObject({ status: 400 })
      await expect(readRows(ownerId)).resolves.toHaveLength(0)
    })

    it('answers 400 for a circular value', () => {
      const circular: Record<string, unknown> = {}

      circular.self = circular

      expect(() => serializeArtifactStorageValue(circular))
        .toThrowError(expect.objectContaining({ status: 400 }))
    })

    it('answers 400 for a BigInt value', () => {
      expect(() => serializeArtifactStorageValue(10n))
        .toThrowError(expect.objectContaining({ status: 400 }))
    })

    it.each([
      ['an empty body', {}],
      ['an undefined value', { value: undefined }],
      ['no body', undefined],
      ['a body that is not an object', 'text'],
    ])('answers 400 for %s', async (_label, body) => {
      await expect(call('put', { key: 'score', body }))
        .rejects.toMatchObject({ status: 400 })
      await expect(readRows(ownerId)).resolves.toHaveLength(0)
    })

    it('accepts null as an explicit value', async () => {
      const { result } = await put('cleared', null)

      expect(result).toEqual({ keys: 1, bytes: 4 })
    })

    it('answers 400 for a missing artifact id', async () => {
      await expect(call('list', { id: '' }))
        .rejects.toMatchObject({ status: 400 })
    })

    it('answers 400 on delete without a key', async () => {
      const handler = await handlers.remove()

      await expect(handler(createEvent({ params: { id: artifactId } })))
        .rejects.toMatchObject({ status: 400 })
    })
  })

  describe('write rate limit', () => {
    function exhaustLimit(
      viewerUserId: number = ownerId,
      artifact: number = internalId,
      count: number = ARTIFACT_STORAGE_WRITE_LIMIT.max,
    ) {
      const now = Date.now()

      kv.entries.set(
        `artifact-storage:${viewerUserId}:${artifact}`,
        JSON.stringify({
          key: `${viewerUserId}:${artifact}`,
          count,
          lastRequest: now,
          windowStart: now,
        }),
      )
    }

    it('answers 429 with Retry-After on the 121st save in a minute',
      async () => {
        exhaustLimit()

        const handler = await handlers.put()
        const event = createEvent({
          params: { id: artifactId, key: 'score' },
          body: { value: 1 },
        })

        await expect(handler(event)).rejects.toMatchObject({
          status: 429,
          message: 'Too many saves',
        })

        const retryAfter = Number(event.res.headers.get('Retry-After'))

        expect(retryAfter).toBeGreaterThanOrEqual(1)
        expect(retryAfter).toBeLessThanOrEqual(
          ARTIFACT_STORAGE_WRITE_LIMIT.window,
        )
        await expect(readRows(ownerId)).resolves.toHaveLength(0)
      })

    it('allows the 120th save and refuses the next', async () => {
      exhaustLimit(ownerId, internalId, ARTIFACT_STORAGE_WRITE_LIMIT.max - 1)

      await put('score', 1)

      await expect(put('score', 2)).rejects.toMatchObject({ status: 429 })
    })

    it('counts every save through the shared KV limiter', async () => {
      await put('first', 1)
      await put('second', 2)

      const stored = JSON.parse(
        kv.entries.get(`artifact-storage:${ownerId}:${internalId}`)!,
      )

      expect(stored.count).toBe(2)
    })

    it('limits delete and reset too', async () => {
      exhaustLimit()

      await expect(call('remove', { key: 'score' }))
        .rejects.toMatchObject({ status: 429 })
      await expect(call('reset')).rejects.toMatchObject({ status: 429 })
    })

    it('never limits reads', async () => {
      exhaustLimit()

      await expect(call('list')).resolves.toBeDefined()
    })

    it('limits each viewer and artifact on their own', async () => {
      exhaustLimit(strangerId, internalId)
      exhaustLimit(ownerId, internalId + 1000)

      await expect(put('score', 1)).resolves.toBeDefined()
    })
  })

  describe('request body size', () => {
    function stubContentLength(value: string | undefined) {
      vi.stubGlobal('getRequestHeader', (_event: unknown, name: string) => {
        return name === 'content-length' ? value : undefined
      })
    }

    it('answers 413 for a body over 40 KB before reading it', async () => {
      const readBody = vi.fn()

      stubContentLength(String(ARTIFACT_STORAGE_BODY_MAX_BYTES + 1))
      vi.stubGlobal('readValidatedBody', readBody)

      await expect(put('score', 1)).rejects.toMatchObject({ status: 413 })
      expect(readBody).not.toHaveBeenCalled()
      await expect(readRows(ownerId)).resolves.toHaveLength(0)
    })

    it('accepts a body of exactly 40 KB', async () => {
      stubContentLength(String(ARTIFACT_STORAGE_BODY_MAX_BYTES))

      await expect(put('score', 1)).resolves.toBeDefined()
    })

    it('answers 411 for a write without a Content-Length', async () => {
      const readBody = vi.fn()

      stubContentLength(undefined)
      vi.stubGlobal('readValidatedBody', readBody)

      await expect(put('first', 1)).rejects.toMatchObject({ status: 411 })
      expect(readBody).not.toHaveBeenCalled()
      await expect(readRows(ownerId)).resolves.toHaveLength(0)
    })

    it('answers 400 for an unreadable Content-Length', async () => {
      stubContentLength('not-a-number')

      await expect(put('second', 2)).rejects.toMatchObject({ status: 400 })
    })

    it('does not check the size on delete, reset or list', async () => {
      stubContentLength(String(ARTIFACT_STORAGE_BODY_MAX_BYTES * 10))

      await expect(call('list')).resolves.toBeDefined()
      await expect(call('remove', { key: 'score' })).resolves.toBeDefined()
      await expect(call('reset')).resolves.toBeDefined()
    })

    it('takes the write slot before the body is read', async () => {
      const readBody = vi.fn(async (
        event: { body: unknown },
        validate: (value: unknown) => unknown,
      ) => validate(event.body))

      vi.stubGlobal('readValidatedBody', readBody)

      await put('score', 1)

      const stored = JSON.parse(
        kv.entries.get(`artifact-storage:${ownerId}:${internalId}`)!,
      )

      expect(stored.count).toBe(1)
      expect(kv.put.mock.invocationCallOrder[0])
        .toBeLessThan(readBody.mock.invocationCallOrder[0]!)
    })

    it('answers 429 without reading the body when the limit is used up',
      async () => {
        const now = Date.now()
        const readBody = vi.fn()

        kv.entries.set(
          `artifact-storage:${ownerId}:${internalId}`,
          JSON.stringify({
            key: `${ownerId}:${internalId}`,
            count: ARTIFACT_STORAGE_WRITE_LIMIT.max,
            lastRequest: now,
            windowStart: now,
          }),
        )
        vi.stubGlobal('readValidatedBody', readBody)

        await expect(put('score', 1)).rejects.toMatchObject({ status: 429 })
        expect(readBody).not.toHaveBeenCalled()
      })

    it('does not take a write slot for an oversized body',
      async () => {
        stubContentLength(String(ARTIFACT_STORAGE_BODY_MAX_BYTES + 1))

        await expect(put('score', 1)).rejects.toMatchObject({ status: 413 })

        expect(kv.put).not.toHaveBeenCalled()
      })
  })

  describe('write limiter failure', () => {
    it('saves the value when the KV counter write fails', async () => {
      kv.put.mockRejectedValue(new Error('KV PUT failed: 429 Too Many'))

      const { result } = await put('score', 3)

      expect(result).toEqual({ keys: 1, bytes: 1 })
      await expect(readRows(ownerId)).resolves.toHaveLength(1)
    })

    it('notes the skipped limit on the request logger', async () => {
      kv.put.mockRejectedValue(new Error('KV PUT failed: 429 Too Many'))

      await put('score', 3)

      expect(mocks.logger.set).toHaveBeenCalledWith({
        attributes: {
          artifacts: {
            storageRateLimit: { skipped: 'kv-error', error: 'Error' },
          },
        },
      })
    })

    it('saves the value when the KV counter read fails', async () => {
      kv.get.mockRejectedValue(new TypeError('KV GET failed'))

      const { result } = await put('score', 3)

      expect(result.keys).toBe(1)
      expect(mocks.logger.set).toHaveBeenCalledWith({
        attributes: {
          artifacts: {
            storageRateLimit: { skipped: 'kv-error', error: 'TypeError' },
          },
        },
      })
    })

    it('names an unknown thrown value as unknown', async () => {
      kv.put.mockRejectedValue('boom')

      await put('score', 3)

      expect(mocks.logger.set).toHaveBeenCalledWith({
        attributes: {
          artifacts: {
            storageRateLimit: { skipped: 'kv-error', error: 'unknown' },
          },
        },
      })
    })

    it('lets delete and reset go ahead when the KV counter fails',
      async () => {
        await put('score', 1)
        kv.put.mockRejectedValue(new Error('KV PUT failed'))

        await expect(call('remove', { key: 'score' }))
          .resolves.toMatchObject({ result: { keys: 0, bytes: 0 } })
        await expect(call('reset')).resolves.toBeDefined()
        expect(mocks.logger.set).toHaveBeenCalledWith({
          attributes: {
            artifacts: {
              storageRateLimit: { skipped: 'kv-error', error: 'Error' },
            },
          },
        })
      })

    it('still enforces the byte and key caps while the limiter is down',
      async () => {
        kv.put.mockRejectedValue(new Error('KV PUT failed'))
        await seedRows(ownerId, ARTIFACT_STORAGE_MAX_KEYS)

        await expect(put('one-more', 1)).rejects.toMatchObject({
          status: 413,
        })
      })
  })

  describe('feature flag', () => {
    it('answers 404 on every route when artifacts.storage is off',
      async () => {
        mocks.featureActive = false

        for (const name of ['list', 'put', 'remove', 'reset'] as const) {
          await expect(call(name, {
            key: 'score',
            body: { value: 1 },
          })).rejects.toMatchObject({ status: 404 })
        }

        expect(mocks.requireFeature).toHaveBeenCalledWith(
          expect.anything(),
          'artifacts.storage',
        )
        await expect(readRows(ownerId)).resolves.toHaveLength(0)
      })

    it('checks the flag first, then answers 401 without a session',
      async () => {
        mocks.sessionUserId = 0

        await expect(call('list')).rejects.toMatchObject({ status: 401 })
        expect(mocks.requireFeature).toHaveBeenCalledWith(
          expect.anything(),
          'artifacts.storage',
        )
      })
  })

  describe('legal consent', () => {
    it('answers 403 with the legal-consent reason on every route',
      async () => {
        const unconsentedId = await seedUser(testDb.db, {
          termsAcceptedAt: null,
          termsVersion: null,
          ageConfirmedAt: null,
          sensitiveContentConsentAt: null,
          sensitiveContentConsentVersion: null,
        })

        mocks.sessionUserId = unconsentedId

        for (const name of ['list', 'put', 'remove', 'reset'] as const) {
          await expect(call(name, {
            key: 'score',
            body: { value: 1 },
          })).rejects.toMatchObject({
            status: 403,
            data: { reason: 'legal-consent' },
          })
        }
      })

    it('answers 403 for a user without a settings row', async () => {
      const noSettingsId = await seedUser(testDb.db, null)

      mocks.sessionUserId = noSettingsId

      await expect(call('list')).rejects.toMatchObject({
        status: 403,
        data: { reason: 'legal-consent' },
      })
    })

    it('answers 400 for a bad key before checking consent', async () => {
      const noSettingsId = await seedUser(testDb.db, null)

      mocks.sessionUserId = noSettingsId

      await expect(put('bad key', 1))
        .rejects.toMatchObject({ status: 400 })
    })
  })

  describe('isolation between viewers', () => {
    async function seedStrangerRow() {
      await testDb.db.insert(schema.artifactStorage).values({
        artifactId: internalId,
        viewerUserId: strangerId,
        key: 'secret',
        value: { stranger: true },
        bytes: 17,
      })
    }

    it('never returns the rows of another viewer', async () => {
      await seedStrangerRow()
      await put('mine', 'value')

      const { result } = await call('list')

      expect(result.items).toEqual([{ key: 'mine', value: 'value' }])
      expect(JSON.stringify(result)).not.toContain('stranger')
    })

    it('keeps the other viewer when the owner resets', async () => {
      await seedStrangerRow()
      await put('mine', 'value')

      const { result } = await call('reset')

      expect(result.deleted).toBe(1)
      await expect(readRows(ownerId)).resolves.toHaveLength(0)
      await expect(readRows(strangerId)).resolves.toHaveLength(1)
    })

    it('keeps the other viewer when the owner deletes the same key',
      async () => {
        await seedStrangerRow()
        await put('secret', 'mine')
        await call('remove', { key: 'secret' })

        await expect(readRows(strangerId)).resolves.toEqual([
          expect.objectContaining({ key: 'secret' }),
        ])
      })

    it('overwrites only the own value for a shared key', async () => {
      await seedStrangerRow()
      await put('secret', 'owner value')

      const [strangerRow] = await readRows(strangerId)

      expect(strangerRow!.value).toEqual({ stranger: true })
    })
  })

  describe('access', () => {
    it('answers 404 on every route for a signed-in non-owner', async () => {
      await put('mine', 'value')
      mocks.sessionUserId = strangerId

      for (const name of ['list', 'put', 'remove', 'reset'] as const) {
        await expect(call(name, {
          key: 'mine',
          body: { value: 'hijack' },
        })).rejects.toMatchObject({ status: 404 })
      }

      await expect(readRows(strangerId)).resolves.toHaveLength(0)
      await expect(readRows(ownerId)).resolves.toEqual([
        expect.objectContaining({ key: 'mine', value: 'value' }),
      ])
    })

    it('answers 404 for a forged and an unknown artifact id', async () => {
      await expect(call('list', { id: 'forged-id!' }))
        .rejects.toMatchObject({ status: 404 })
      await expect(call('list', { id: 'AAAAAAAAAAAAAAAA' }))
        .rejects.toMatchObject({ status: 404 })
      await expect(put('score', 1)).resolves.toBeDefined()
    })

    it('answers 451 on every route once the artifact is taken down',
      async () => {
        await put('mine', 'value')
        testDb.sqlite.prepare(
          'update artifacts set takedown_at = 1 where id = ?',
        ).run(internalId)

        for (const name of ['list', 'put', 'remove', 'reset'] as const) {
          await expect(call(name, {
            key: 'mine',
            body: { value: 'x' },
          })).rejects.toMatchObject({
            status: 451,
            code: 'artifact_taken_down',
          })
        }
      })

    it('does not read the share header for an owner', async () => {
      const readHeader = vi.fn((_event: unknown, name: string) => {
        return name === 'content-length' ? '100' : 'some-token'
      })

      vi.stubGlobal('getRequestHeader', readHeader)

      await expect(put('score', 1)).resolves.toBeDefined()
      expect(readHeader).toHaveBeenCalledWith(
        expect.anything(),
        'x-besidka-artifact-share',
      )
    })
  })
})
