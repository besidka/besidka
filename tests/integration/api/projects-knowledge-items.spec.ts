import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import {
  createCommitImplementation,
  createKnowledgeApiHarness,
  knowledgeEvent,
  loadKnowledgeHandler,
} from '../../setup/helpers/knowledge-api'
import type { KnowledgeApiHarness } from '../../setup/helpers/knowledge-api'

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
const PROJECT = 10
const FILE_EXPIRY_SECONDS = 1_900_000_000
const projectPublicId = encodePublicId(PROJECT)

function textItem(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Guide',
    mediaType: 'text/markdown',
    extractor: 'text',
    extractStatus: 'ready',
    text: 'hello world',
    ...overrides,
  }
}

describe('project knowledge items API', () => {
  let harness: KnowledgeApiHarness

  async function post(body: unknown) {
    const handler = await loadKnowledgeHandler('itemsCreate')

    return await handler(knowledgeEvent({ projectId: projectPublicId, body }))
  }

  async function patch(itemId: number, body: unknown) {
    const handler = await loadKnowledgeHandler('itemPatch')

    return await handler(knowledgeEvent({
      projectId: projectPublicId,
      itemId: encodePublicId(itemId),
      body,
    }))
  }

  async function remove(itemId: number) {
    const handler = await loadKnowledgeHandler('itemDelete')

    return await handler(knowledgeEvent({
      projectId: projectPublicId,
      itemId: encodePublicId(itemId),
    }))
  }

  async function readText(itemId: number) {
    const handler = await loadKnowledgeHandler('itemText')
    const event = knowledgeEvent({
      projectId: projectPublicId,
      itemId: encodePublicId(itemId),
    })
    const result = await handler(event)

    return { result, cacheControl: event.res.headers.get('cache-control') }
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    harness = createKnowledgeApiHarness()
    harness.install()
    harness.testDb.insertProject({ id: PROJECT, userId: OWNER })
    harness.testDb.insertStorage({ userId: OWNER })
    mocks.invalidateStorageCache.mockResolvedValue(undefined)
    mocks.ensureKnowledgePackFresh.mockResolvedValue(undefined)
    mocks.commitKnowledgeChange.mockImplementation(
      createCommitImplementation(harness.testDb),
    )
  })

  afterEach(() => {
    harness.close()
  })

  describe('POST items', () => {
    it('creates items, answers 201 and stores the text in R2', async () => {
      const result = await post({ items: [textItem()] })

      expect(harness.responses.status).toBe(201)
      expect(result).toMatchObject({
        skipped: [],
        version: 0,
        packVersion: null,
        items: [{
          kind: 'file',
          title: 'Guide',
          textBytes: 11,
          extractStatus: 'ready',
          projectId: projectPublicId,
        }],
      })
      expect(harness.bucket.objects.size).toBe(1)
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
      expect(mocks.invalidateStorageCache).toHaveBeenCalledWith(
        OWNER,
        expect.anything(),
      )
    })

    it('commits when the body says so', async () => {
      const result = await post({ items: [textItem()], commit: true })

      expect(mocks.commitKnowledgeChange).toHaveBeenCalledOnce()
      expect(result.version).toBe(1)
    })

    it('answers 200 and reports skipped duplicates', async () => {
      const hash = 'd'.repeat(64)

      await post({ items: [textItem({ contentHash: hash })] })

      harness.responses.status = null

      const result = await post({
        items: [textItem({ contentHash: hash })],
      })

      expect(harness.responses.status).toBeNull()
      expect(result.items).toEqual([])
      expect(result.skipped).toEqual([{ index: 0, reason: 'duplicate' }])
      expect(harness.testDb.countItems(PROJECT)).toBe(1)
    })

    it('links a library PDF and clears its expiry', async () => {
      harness.testDb.insertFile({
        id: 5,
        userId: OWNER,
        name: 'handbook.pdf',
        expiresAt: FILE_EXPIRY_SECONDS,
      })

      const result = await post({
        items: [{
          fileId: encodePublicId(5),
          extractor: 'client-unpdf',
          extractStatus: 'ready',
          text: 'pdf text',
          pageCount: 12,
        }],
      })

      expect(result.items[0]).toMatchObject({
        title: 'handbook.pdf',
        fileId: encodePublicId(5),
        mediaType: 'application/pdf',
        pageCount: 12,
      })
      expect(harness.testDb.getFileRow(5)?.expires_at).toBeNull()
    })

    it('answers 413 with the upload wording when over quota', async () => {
      harness.testDb.sqlite.prepare('delete from storages').run()
      harness.testDb.insertStorage({ userId: OWNER, storage: 4 })

      await expect(post({ items: [textItem()] })).rejects.toMatchObject({
        status: 413,
        message: 'Not enough storage space. Please delete some files.',
        why: 'The upload is larger than the remaining storage quota',
        fix: 'Delete some files or upload a smaller file',
      })
      expect(harness.testDb.countItems()).toBe(0)
      expect(harness.bucket.calls).toEqual([])
    })

    it('answers 422 with why and fix when the project is full', async () => {
      harness.testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        textBytes: KNOWLEDGE_LIMITS.maxProjectTextBytes,
      })

      await expect(post({ items: [textItem()] })).rejects.toMatchObject({
        status: 422,
        why: expect.any(String),
        fix: expect.any(String),
      })
      expect(harness.bucket.calls).toEqual([])
    })

    it('answers 500 and leaves nothing behind when R2 fails', async () => {
      harness.bucket.failPutAt = 2

      await expect(post({
        items: [textItem({ title: 'One' }), textItem({ title: 'Two' })],
      })).rejects.toMatchObject({ status: 500 })

      expect(harness.testDb.countItems()).toBe(0)
      expect(harness.bucket.objects.size).toBe(0)
    })

    it('answers 409 for a unique violation raised during the batch', async () => {
      harness.beforeBatchHooks.push(() => {
        harness.testDb.insertItem({
          userId: OWNER,
          projectId: PROJECT,
          contentHash: 'e'.repeat(64),
        })
      })

      await expect(post({
        items: [textItem({ contentHash: 'e'.repeat(64) })],
      })).rejects.toMatchObject({ status: 409 })
      expect(harness.testDb.countItems()).toBe(1)
    })

    it.each([
      ['an empty list', { items: [] }],
      ['more than 25 items', {
        items: Array.from({ length: 26 }, (_value, index) => {
          return textItem({ title: `Item ${index}` })
        }),
      }],
      ['a batch over 1 MB of text', {
        items: [
          textItem({ text: 'a'.repeat(700_000) }),
          textItem({ title: 'Two', text: 'b'.repeat(700_000) }),
        ],
      }],
      ['a ready item with empty text', {
        items: [textItem({ text: '   ' })],
      }],
      ['a no-text item that carries text', {
        items: [textItem({ extractStatus: 'no-text', text: 'text' })],
      }],
      ['a NUL byte in the text', {
        items: [textItem({ text: `a${String.fromCharCode(0)}b` })],
      }],
      ['a note extractor on a file', {
        items: [textItem({ extractor: 'note' })],
      }],
      ['a parent path segment', {
        items: [textItem({ relativePath: 'docs/../secret.md' })],
      }],
      ['a leading slash', {
        items: [textItem({ relativePath: '/etc/passwd' })],
      }],
      ['a backslash path', {
        items: [textItem({ relativePath: 'docs\\guide.md' })],
      }],
      ['a malformed content hash', {
        items: [textItem({ contentHash: 'abc' })],
      }],
    ])('answers 400 for %s', async (_label, body) => {
      await expect(post(body)).rejects.toMatchObject({ status: 400 })

      expect(harness.testDb.countItems()).toBe(0)
      expect(harness.bucket.calls).toEqual([])
    })
  })

  describe('PATCH item', () => {
    it('changes the metadata and leaves the version alone', async () => {
      const itemId = harness.testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        kind: 'file',
        fileId: 3,
        mediaType: 'application/pdf',
      })
      const result = await patch(itemId, {
        description: 'Key facts',
        pinned: true,
        sendAsNativePdf: true,
      })

      expect(result).toMatchObject({
        description: 'Key facts',
        pinned: true,
        sendAsNativePdf: true,
      })
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
      expect(harness.testDb.getProjectRow(PROJECT)?.knowledge_version)
        .toBeNull()
      expect(harness.bucket.calls).toEqual([])
    })

    it('answers 400 for an empty or invalid body', async () => {
      const itemId = harness.testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
      })

      await expect(patch(itemId, {})).rejects.toMatchObject({ status: 400 })
      await expect(patch(itemId, { pinned: 'yes' }))
        .rejects.toMatchObject({ status: 400 })
      await expect(patch(itemId, { description: 'a\nb' }))
        .rejects.toMatchObject({ status: 400 })
    })

    it('answers 422 for the native PDF flag on a note', async () => {
      const itemId = harness.testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        kind: 'note',
      })

      await expect(patch(itemId, { sendAsNativePdf: true }))
        .rejects.toMatchObject({ status: 422 })
    })
  })

  describe('DELETE item', () => {
    it('commits the removal and returns only the versions', async () => {
      harness.testDb.insertFile({
        id: 5,
        userId: OWNER,
        expiresAt: FILE_EXPIRY_SECONDS,
      })

      const created = await post({
        items: [{
          fileId: encodePublicId(5),
          extractor: 'client-unpdf',
          extractStatus: 'ready',
          text: 'pdf text',
        }],
      })
      const itemId = Number(
        harness.testDb.sqlite.prepare(
          'select id from project_knowledge_items',
        ).pluck().get(),
      )

      expect(created.items).toHaveLength(1)
      expect(harness.testDb.getFileRow(5)?.expires_at).toBeNull()

      const result = await remove(itemId)

      expect(result).toEqual({ version: 1, packVersion: null })
      expect(mocks.commitKnowledgeChange).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: OWNER,
          projectId: PROJECT,
          removeItemIds: [itemId],
        }),
      )
      expect(harness.testDb.countItems()).toBe(0)
      expect(harness.testDb.getFileRow(5)?.expires_at).not.toBeNull()
      expect(mocks.invalidateStorageCache).toHaveBeenCalled()
    })

    it('answers 500 and keeps the storage figure fresh when the commit fails', async () => {
      const itemId = harness.testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
      })

      mocks.commitKnowledgeChange.mockRejectedValue(new Error('down'))

      await expect(remove(itemId)).rejects.toMatchObject({ status: 500 })
      expect(mocks.invalidateStorageCache).toHaveBeenCalled()
    })
  })

  describe('GET item text', () => {
    it('returns the stored text with Cache-Control no-store', async () => {
      await post({ items: [textItem({ text: 'Привіт' })] })

      const itemId = Number(
        harness.testDb.sqlite.prepare(
          'select id from project_knowledge_items',
        ).pluck().get(),
      )
      const { result, cacheControl } = await readText(itemId)

      expect(result).toEqual({ text: 'Привіт' })
      expect(cacheControl).toBe('no-store')
    })

    it('returns empty text when the object is missing', async () => {
      const itemId = harness.testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        extractStatus: 'no-text',
      })

      const { result, cacheControl } = await readText(itemId)

      expect(result).toEqual({ text: '' })
      expect(cacheControl).toBe('no-store')
    })
  })
})
