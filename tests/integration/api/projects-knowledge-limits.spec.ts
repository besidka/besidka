import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { KNOWLEDGE_BODY_LIMITS } from '~~/server/utils/knowledge/body'
import {
  createCommitImplementation,
  createKnowledgeApiHarness,
  knowledgeEvent,
  loadKnowledgeHandler,
} from '../../setup/helpers/knowledge-api'
import type {
  KnowledgeApiHarness,
  KnowledgeRouteName,
} from '../../setup/helpers/knowledge-api'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const mocks = vi.hoisted(() => ({
  invalidateStorageCache: vi.fn(),
  commitKnowledgeChange: vi.fn(),
  ensureKnowledgePackFresh: vi.fn(),
}))

vi.mock('evlog', () => ({
  createError: (input: {
    message: string
    status?: number
    why?: string
    fix?: string
  }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
  useLogger: () => ({ set: vi.fn() }),
  createRequestLogger: () => ({ set: vi.fn(), emit: vi.fn() }),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

vi.mock('~~/server/utils/knowledge/pack', () => ({
  commitKnowledgeChange: mocks.commitKnowledgeChange,
  ensureKnowledgePackFresh: mocks.ensureKnowledgePackFresh,
}))

const OWNER = 1
const STRANGER = 2
const PROJECT = 10
const STRANGER_PROJECT = 20
const NOTE_ID = 100
const projectPublicId = encodePublicId(PROJECT)

const BODY_ROUTES: Array<{
  route: KnowledgeRouteName
  cap: number
  needsItem: boolean
}> = [
  { route: 'itemsCreate', cap: KNOWLEDGE_BODY_LIMITS.itemsBatch, needsItem: false },
  { route: 'noteCreate', cap: KNOWLEDGE_BODY_LIMITS.note, needsItem: false },
  { route: 'notePatch', cap: KNOWLEDGE_BODY_LIMITS.note, needsItem: true },
  { route: 'commit', cap: KNOWLEDGE_BODY_LIMITS.small, needsItem: false },
  { route: 'mode', cap: KNOWLEDGE_BODY_LIMITS.small, needsItem: false },
  { route: 'itemPatch', cap: KNOWLEDGE_BODY_LIMITS.small, needsItem: true },
]

function oversizedStream(totalBytes: number): ReadableStream<Uint8Array> {
  let sent = 0

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close()

        return
      }

      const size = Math.min(64 * 1024, totalBytes - sent)

      sent += size
      controller.enqueue(new Uint8Array(size).fill(97))
    },
  })
}

describe('project knowledge request limits', () => {
  let harness: KnowledgeApiHarness

  function eventFor(
    route: KnowledgeRouteName,
    overrides: Record<string, unknown> = {},
    needsItem = false,
  ) {
    return knowledgeEvent({
      projectId: projectPublicId,
      itemId: needsItem ? encodePublicId(NOTE_ID) : undefined,
      ...overrides,
    })
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    harness = createKnowledgeApiHarness()
    harness.install()
    harness.testDb.insertProject({ id: PROJECT, userId: OWNER })
    harness.testDb.insertProject({ id: STRANGER_PROJECT, userId: STRANGER })
    harness.testDb.insertStorage({ userId: OWNER })
    harness.testDb.insertItem({
      id: NOTE_ID,
      userId: OWNER,
      projectId: PROJECT,
      kind: 'note',
      extractor: 'note',
      mediaType: 'text/markdown',
    })
    mocks.invalidateStorageCache.mockResolvedValue(undefined)
    mocks.ensureKnowledgePackFresh.mockResolvedValue(undefined)
    mocks.commitKnowledgeChange.mockImplementation(
      createCommitImplementation(harness.testDb),
    )
  })

  afterEach(() => {
    harness.close()
  })

  describe('request body caps', () => {
    it.each(BODY_ROUTES)(' rejects an over-cap Content-Length with 413', async ({ route, cap, needsItem }) => {
      const handler = await loadKnowledgeHandler(route)

      await expect(handler(eventFor(route, {
        body: {},
        headers: { 'content-length': String(cap + 1) },
      }, needsItem))).rejects.toMatchObject({ status: 413 })

      expect(harness.bucket.calls).toEqual([])
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
    })

    it.each(BODY_ROUTES)(' rejects a body that outgrows the cap without a header', async ({ route, cap, needsItem }) => {
      const handler = await loadKnowledgeHandler(route)

      await expect(handler(eventFor(route, {
        rawBody: oversizedStream(cap + 1),
      }, needsItem))).rejects.toMatchObject({ status: 413 })

      expect(harness.bucket.calls).toEqual([])
      expect(harness.testDb.countItems(PROJECT)).toBe(1)
    })

    it.each(BODY_ROUTES)(' rejects a body that outgrows the cap when the header lies', async ({ route, cap, needsItem }) => {
      const handler = await loadKnowledgeHandler(route)

      await expect(handler(eventFor(route, {
        rawBody: oversizedStream(cap + 1),
        headers: { 'content-length': '10' },
      }, needsItem))).rejects.toMatchObject({ status: 413 })
    })

    it.each(BODY_ROUTES)(' answers 400 for invalid JSON', async ({ route, needsItem }) => {
      const handler = await loadKnowledgeHandler(route)

      await expect(handler(eventFor(route, {
        rawBody: '{"broken":',
      }, needsItem))).rejects.toMatchObject({ status: 400 })
    })

    it('uses the caps of the brief', () => {
      expect(KNOWLEDGE_BODY_LIMITS).toEqual({
        itemsBatch: 6.25 * 1024 * 1024,
        note: 640 * 1024,
        small: 64 * 1024,
      })
    })

    it('still accepts a valid body just under the cap', async () => {
      const handler = await loadKnowledgeHandler('noteCreate')
      const body = JSON.stringify({
        title: 'Big note',
        body: 'a'.repeat(100_000),
      })
      const result = await handler(eventFor('noteCreate', {
        rawBody: body,
        headers: { 'content-length': String(body.length) },
      }))

      expect(result).toMatchObject({ kind: 'note', title: 'Big note' })
    })

    it('resolves the project before it reads the body', async () => {
      harness.session.userId = STRANGER

      const handler = await loadKnowledgeHandler('itemsCreate')
      const event = eventFor('itemsCreate', {
        rawBody: oversizedStream(KNOWLEDGE_BODY_LIMITS.itemsBatch + 1),
        headers: {
          'content-length': String(KNOWLEDGE_BODY_LIMITS.itemsBatch + 1),
        },
      })

      await expect(handler(event)).rejects.toMatchObject({ status: 404 })

      expect(event.req.bodyUsed).toBe(false)
    })

    it('answers 401 before it reads the body without a session', async () => {
      harness.session.userId = null

      const handler = await loadKnowledgeHandler('commit')
      const event = eventFor('commit', { rawBody: oversizedStream(1000) })

      await expect(handler(event)).rejects.toMatchObject({ status: 401 })
      expect(event.req.bodyUsed).toBe(false)
    })
  })

  describe('write rate limit', () => {
    async function callMode() {
      const handler = await loadKnowledgeHandler('mode')

      return await handler(eventFor('mode', { body: { mode: 'full' } }))
    }

    it('answers 429 with Retry-After on the 61st mutating request', async () => {
      for (let count = 0; count < 60; count++) {
        await callMode()
      }

      const handler = await loadKnowledgeHandler('mode')
      const event = eventFor('mode', { body: { mode: 'full' } })

      await expect(handler(event)).rejects.toMatchObject({
        status: 429,
        why: expect.any(String),
        fix: expect.any(String),
      })
      expect(Number(event.res.headers.get('retry-after'))).toBeGreaterThan(0)
    })

    it('shares one counter between all mutating routes', async () => {
      type Call = [KnowledgeRouteName, Record<string, unknown>, boolean]

      const calls: Call[] = [
        ['mode', { body: { mode: 'full' } }, false],
        ['commit', { body: {} }, false],
        ['itemsCreate', {
          body: {
            items: [{
              title: 'T',
              mediaType: 'text/plain',
              extractor: 'text',
              extractStatus: 'ready',
              text: 'x',
            }],
          },
        }, false],
        ['noteCreate', { body: { title: 'N', body: 'note body' } }, false],
        ['notePatch', { body: { description: 'd' } }, true],
        ['itemPatch', { body: { pinned: true } }, true],
        ['itemDelete', {}, true],
      ]

      for (const [route, overrides, needsItem] of calls) {
        const handler = await loadKnowledgeHandler(route)

        await handler(eventFor(route, overrides, needsItem))
      }

      expect([...harness.kv.values.values()].map((value) => {
        return JSON.parse(value).count
      })).toEqual([7])
    })

    it('does not count or block read routes', async () => {
      for (let count = 0; count < 60; count++) {
        await callMode()
      }

      for (const route of ['summary', 'itemText'] as const) {
        const handler = await loadKnowledgeHandler(route)

        await expect(handler(eventFor(route, {}, route === 'itemText')))
          .resolves.toBeDefined()
      }
    })

    it('does not count unauthenticated requests', async () => {
      harness.session.userId = null

      const handler = await loadKnowledgeHandler('mode')

      for (let count = 0; count < 80; count++) {
        await expect(handler(eventFor('mode', { body: { mode: 'full' } })))
          .rejects.toMatchObject({ status: 401 })
      }

      expect(harness.kv.values.size).toBe(0)
    })

    it('limits before the project lookup, so unknown projects count too', async () => {
      const handler = await loadKnowledgeHandler('mode')

      for (let count = 0; count < 60; count++) {
        await expect(handler(knowledgeEvent({
          projectId: encodePublicId(STRANGER_PROJECT),
          body: { mode: 'full' },
        }))).rejects.toMatchObject({ status: 404 })
      }

      await expect(handler(knowledgeEvent({
        projectId: encodePublicId(STRANGER_PROJECT),
        body: { mode: 'full' },
      }))).rejects.toMatchObject({ status: 429 })
    })

    it('counts users separately', async () => {
      for (let count = 0; count < 60; count++) {
        await callMode()
      }

      harness.session.userId = STRANGER

      const handler = await loadKnowledgeHandler('mode')

      await expect(handler(knowledgeEvent({
        projectId: encodePublicId(STRANGER_PROJECT),
        body: { mode: 'full' },
      }))).resolves.toEqual({ mode: 'full' })
    })
  })

  describe('POST commit with nothing to commit', () => {
    it('returns the current state without a bump or a build', async () => {
      harness.testDb.sqlite.prepare(
        'update projects set knowledge_version = 4,'
        + ' knowledge_pack_version = 4 where id = ?',
      ).run(PROJECT)

      const handler = await loadKnowledgeHandler('commit')
      const result = await handler(eventFor('commit', { body: {} }))

      expect(result).toEqual({
        version: 4,
        packVersion: 4,
        removed: 0,
        skipped: [],
      })
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
      expect(harness.testDb.getProjectRow(PROJECT)?.knowledge_version).toBe(4)
    })

    it('rebuilds a stale pack lazily without a bump', async () => {
      harness.testDb.sqlite.prepare(
        'update projects set knowledge_version = 4,'
        + ' knowledge_pack_version = 3 where id = ?',
      ).run(PROJECT)

      const handler = await loadKnowledgeHandler('commit')
      const result = await handler(eventFor('commit', { body: {} }))

      expect(mocks.ensureKnowledgePackFresh).toHaveBeenCalledOnce()
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
      expect(result.version).toBe(4)
      expect(harness.testDb.getProjectRow(PROJECT)?.knowledge_version).toBe(4)
    })

    it('does not bump or build when no id matches', async () => {
      harness.testDb.sqlite.prepare(
        'update projects set knowledge_version = 4,'
        + ' knowledge_pack_version = 4 where id = ?',
      ).run(PROJECT)

      const handler = await loadKnowledgeHandler('commit')
      const result = await handler(eventFor('commit', {
        body: { remove: ['unknown-id'] },
      }))

      expect(result).toEqual({
        version: 4,
        packVersion: 4,
        removed: 0,
        skipped: ['unknown-id'],
      })
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
      expect(mocks.ensureKnowledgePackFresh).not.toHaveBeenCalled()
    })
  })
})
