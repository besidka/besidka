import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePublicId } from '~~/server/utils/custom-db-types'
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
const OWNER_PROJECT = 10
const OWNER_OTHER_PROJECT = 11
const STRANGER_PROJECT = 20
const OWNER_NOTE = 100
const OWNER_PDF_ITEM = 101
const OWNER_OTHER_PROJECT_ITEM = 102
const STRANGER_ITEM = 200
const OWNER_FILE = 5
const STRANGER_FILE = 7
const FILE_EXPIRY_SECONDS = 1_900_000_000

const MUTATING_ROUTES: KnowledgeRouteName[] = [
  'mode',
  'commit',
  'itemsCreate',
  'itemPatch',
  'itemDelete',
  'noteCreate',
  'notePatch',
]
const ALL_ROUTES: KnowledgeRouteName[] = [
  'summary',
  'itemText',
  ...MUTATING_ROUTES,
]

const bodies: Partial<Record<KnowledgeRouteName, unknown>> = {
  mode: { mode: 'full' },
  commit: { remove: [encodePublicId(OWNER_NOTE)] },
  itemsCreate: {
    items: [{
      title: 'Injected',
      mediaType: 'text/plain',
      extractor: 'text',
      extractStatus: 'ready',
      text: 'injected text',
    }],
  },
  itemPatch: { pinned: true },
  noteCreate: { title: 'Injected', body: 'injected body' },
  notePatch: { title: 'Hijacked' },
}

describe('project knowledge API ownership', () => {
  let harness: KnowledgeApiHarness

  function snapshot(): string {
    const { sqlite } = harness.testDb

    return JSON.stringify({
      items: sqlite.prepare(
        'select * from project_knowledge_items order by id',
      ).all(),
      projects: sqlite.prepare('select * from projects order by id').all(),
      files: sqlite.prepare('select * from files order by id').all(),
      objects: [...harness.bucket.objects.entries()],
    })
  }

  async function call(
    route: KnowledgeRouteName,
    input: {
      projectId: number
      itemId?: number
      headers?: Record<string, string>
    },
  ) {
    const handler = await loadKnowledgeHandler(route)

    return await handler(knowledgeEvent({
      projectId: encodePublicId(input.projectId),
      itemId: input.itemId === undefined
        ? undefined
        : encodePublicId(input.itemId),
      body: bodies[route],
      headers: input.headers,
    }))
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    harness = createKnowledgeApiHarness()
    harness.install()

    const { testDb } = harness

    testDb.insertProject({ id: OWNER_PROJECT, userId: OWNER })
    testDb.insertProject({ id: OWNER_OTHER_PROJECT, userId: OWNER })
    testDb.insertProject({ id: STRANGER_PROJECT, userId: STRANGER })
    testDb.insertStorage({ userId: OWNER })
    testDb.insertStorage({ userId: STRANGER })
    testDb.insertFile({
      id: OWNER_FILE,
      userId: OWNER,
      expiresAt: FILE_EXPIRY_SECONDS,
    })
    testDb.insertFile({
      id: STRANGER_FILE,
      userId: STRANGER,
      expiresAt: FILE_EXPIRY_SECONDS,
    })
    testDb.insertItem({
      id: OWNER_NOTE,
      userId: OWNER,
      projectId: OWNER_PROJECT,
      title: 'Owner note',
      contentHash: 'a'.repeat(64),
      textBytes: 5,
    })
    testDb.insertItem({
      id: OWNER_PDF_ITEM,
      userId: OWNER,
      projectId: OWNER_PROJECT,
      kind: 'file',
      fileId: OWNER_FILE,
      title: 'Owner pdf',
      mediaType: 'application/pdf',
      extractor: 'client-unpdf',
      textBytes: 5,
    })
    testDb.insertItem({
      id: OWNER_OTHER_PROJECT_ITEM,
      userId: OWNER,
      projectId: OWNER_OTHER_PROJECT,
      title: 'Owner other project',
      textBytes: 5,
    })
    testDb.insertItem({
      id: STRANGER_ITEM,
      userId: STRANGER,
      projectId: STRANGER_PROJECT,
      title: 'Stranger note',
      textBytes: 5,
    })
    harness.bucket.objects.set(
      `knowledge/u${OWNER}/p${OWNER_PROJECT}/items/${OWNER_NOTE}.md`,
      'owner text',
    )
    harness.bucket.calls.length = 0
    mocks.invalidateStorageCache.mockResolvedValue(undefined)
    mocks.ensureKnowledgePackFresh.mockResolvedValue(undefined)
    mocks.commitKnowledgeChange.mockImplementation(
      createCommitImplementation(testDb),
    )
  })

  afterEach(() => {
    harness.close()
  })

  describe('authentication and request origin', () => {
    it.each(ALL_ROUTES)('%s returns 401 without a session', async (route) => {
      harness.session.userId = null

      const before = snapshot()

      await expect(call(route, {
        projectId: OWNER_PROJECT,
        itemId: OWNER_NOTE,
      })).rejects.toMatchObject({ status: 401 })

      expect(snapshot()).toBe(before)
      expect(harness.bucket.calls).toEqual([])
    })

    it.each(MUTATING_ROUTES)('%s rejects a cross-site request with 403', async (route) => {
      const before = snapshot()

      await expect(call(route, {
        projectId: OWNER_PROJECT,
        itemId: OWNER_NOTE,
        headers: { 'sec-fetch-site': 'cross-site' },
      })).rejects.toMatchObject({ status: 403 })

      expect(snapshot()).toBe(before)
      expect(harness.bucket.calls).toEqual([])
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
    })
  })

  describe('another account project', () => {
    it.each(ALL_ROUTES)('%s returns 404 and changes nothing', async (route) => {
      harness.session.userId = STRANGER

      const before = snapshot()

      await expect(call(route, {
        projectId: OWNER_PROJECT,
        itemId: OWNER_NOTE,
      })).rejects.toMatchObject({ status: 404 })

      expect(snapshot()).toBe(before)
      expect(harness.bucket.calls).toEqual([])
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
      expect(mocks.ensureKnowledgePackFresh).not.toHaveBeenCalled()
      expect(mocks.invalidateStorageCache).not.toHaveBeenCalled()
    })

    it.each(ALL_ROUTES)('%s returns 404 for the reverse direction', async (route) => {
      const before = snapshot()

      await expect(call(route, {
        projectId: STRANGER_PROJECT,
        itemId: STRANGER_ITEM,
      })).rejects.toMatchObject({ status: 404 })

      expect(snapshot()).toBe(before)
      expect(harness.bucket.calls).toEqual([])
    })
  })

  describe('another account item inside the own project', () => {
    const ITEM_ROUTES: KnowledgeRouteName[] = [
      'itemPatch',
      'itemDelete',
      'itemText',
      'notePatch',
    ]

    it.each(ITEM_ROUTES)('%s returns 404 for a foreign item id', async (route) => {
      const before = snapshot()

      await expect(call(route, {
        projectId: OWNER_PROJECT,
        itemId: STRANGER_ITEM,
      })).rejects.toMatchObject({ status: 404 })

      expect(snapshot()).toBe(before)
      expect(harness.bucket.calls).toEqual([])
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
    })

    it.each(ITEM_ROUTES)('%s returns 404 for an item of another own project', async (route) => {
      const before = snapshot()

      await expect(call(route, {
        projectId: OWNER_PROJECT,
        itemId: OWNER_OTHER_PROJECT_ITEM,
      })).rejects.toMatchObject({ status: 404 })

      expect(snapshot()).toBe(before)
      expect(harness.bucket.calls).toEqual([])
    })

    it.each(ITEM_ROUTES)('%s returns 404 for a malformed item id', async (route) => {
      const handler = await loadKnowledgeHandler(route)

      for (const itemId of ['not-an-id', '!!!', '0', 'x'.repeat(200)]) {
        await expect(handler(knowledgeEvent({
          projectId: encodePublicId(OWNER_PROJECT),
          itemId,
          body: bodies[route],
        }))).rejects.toMatchObject({ status: 404 })
      }

      expect(harness.bucket.calls).toEqual([])
    })
  })

  describe('malformed project ids', () => {
    it.each(ALL_ROUTES)('%s returns 404 for a malformed project id', async (route) => {
      const handler = await loadKnowledgeHandler(route)
      const before = snapshot()

      for (const projectId of ['nope', '!!!', '', 'x'.repeat(200)]) {
        await expect(handler(knowledgeEvent({
          projectId,
          itemId: encodePublicId(OWNER_NOTE),
          body: bodies[route],
        }))).rejects.toMatchObject({ status: 404 })
      }

      expect(snapshot()).toBe(before)
      expect(harness.bucket.calls).toEqual([])
    })
  })

  describe('another account file', () => {
    it('does not link a foreign file into the own project', async () => {
      harness.session.userId = STRANGER

      const handler = await loadKnowledgeHandler('itemsCreate')
      const before = snapshot()

      await expect(handler(knowledgeEvent({
        projectId: encodePublicId(STRANGER_PROJECT),
        body: {
          items: [{
            fileId: encodePublicId(OWNER_FILE),
            extractor: 'client-unpdf',
            extractStatus: 'ready',
            text: 'stolen',
          }],
        },
      }))).rejects.toMatchObject({ status: 404 })

      expect(snapshot()).toBe(before)
      expect(harness.bucket.calls).toEqual([])
      expect(harness.testDb.getFileRow(OWNER_FILE)?.expires_at)
        .toBe(FILE_EXPIRY_SECONDS)
    })

    it('answers an already linked own file with 409 and changes nothing', async () => {
      const handler = await loadKnowledgeHandler('itemsCreate')
      const before = snapshot()

      await expect(handler(knowledgeEvent({
        projectId: encodePublicId(OWNER_PROJECT),
        body: {
          items: [{
            fileId: encodePublicId(OWNER_FILE),
            extractor: 'client-unpdf',
            extractStatus: 'ready',
            text: 'again',
          }],
        },
      }))).rejects.toMatchObject({ status: 409 })

      expect(snapshot()).toBe(before)
      expect(harness.bucket.calls).toEqual([])
    })
  })

  describe('commit remove scoping', () => {
    it('reports foreign ids as skipped and deletes only the own ones', async () => {
      harness.session.userId = STRANGER

      const handler = await loadKnowledgeHandler('commit')
      const result = await handler(knowledgeEvent({
        projectId: encodePublicId(STRANGER_PROJECT),
        body: {
          remove: [
            encodePublicId(OWNER_NOTE),
            encodePublicId(OWNER_PDF_ITEM),
            encodePublicId(OWNER_OTHER_PROJECT_ITEM),
            encodePublicId(STRANGER_ITEM),
          ],
        },
      }))

      expect(result).toMatchObject({
        removed: 1,
        skipped: [
          encodePublicId(OWNER_NOTE),
          encodePublicId(OWNER_PDF_ITEM),
          encodePublicId(OWNER_OTHER_PROJECT_ITEM),
        ],
      })
      expect(harness.testDb.countItems(OWNER_PROJECT)).toBe(2)
      expect(harness.testDb.countItems(OWNER_OTHER_PROJECT)).toBe(1)
      expect(harness.testDb.countItems(STRANGER_PROJECT)).toBe(0)
      expect(mocks.commitKnowledgeChange).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: STRANGER,
          projectId: STRANGER_PROJECT,
          removeItemIds: [STRANGER_ITEM],
        }),
      )
    })
  })
})
