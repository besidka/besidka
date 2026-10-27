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
const PROJECT = 10
const projectPublicId = encodePublicId(PROJECT)

describe('project knowledge notes API', () => {
  let harness: KnowledgeApiHarness

  async function createNote(body: unknown) {
    const handler = await loadKnowledgeHandler('noteCreate')

    return await handler(knowledgeEvent({ projectId: projectPublicId, body }))
  }

  async function updateNote(publicItemId: string, body: unknown) {
    const handler = await loadKnowledgeHandler('notePatch')

    return await handler(knowledgeEvent({
      projectId: projectPublicId,
      itemId: publicItemId,
      body,
    }))
  }

  function storedBodies(): string[] {
    return [...harness.bucket.objects.values()]
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
    vi.restoreAllMocks()
    harness.close()
  })

  describe('POST note', () => {
    it('creates a note, answers 201 and commits once', async () => {
      const note = await createNote({
        title: 'Plan',
        body: 'Ship it',
        description: 'Roadmap',
      })

      expect(harness.responses.status).toBe(201)
      expect(note).toMatchObject({
        kind: 'note',
        title: 'Plan',
        description: 'Roadmap',
        fileId: null,
        extractor: 'note',
        extractStatus: 'ready',
        textBytes: 7,
        projectId: projectPublicId,
      })
      expect(storedBodies()).toEqual(['Ship it'])
      expect(mocks.commitKnowledgeChange).toHaveBeenCalledOnce()
      expect(mocks.invalidateStorageCache).toHaveBeenCalled()
      expect(harness.testDb.getProjectRow(PROJECT)?.knowledge_version).toBe(1)
    })

    it('answers 409 for an identical body without a second commit', async () => {
      await createNote({ title: 'Plan', body: 'Ship it' })
      mocks.commitKnowledgeChange.mockClear()

      await expect(createNote({ title: 'Copy', body: 'Ship it' }))
        .rejects.toMatchObject({ status: 409 })

      expect(harness.testDb.countItems(PROJECT)).toBe(1)
      expect(storedBodies()).toEqual(['Ship it'])
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
    })

    it('answers 409 when an identical note appears during the insert', async () => {
      harness.beforeBatchHooks.push(() => {
        harness.testDb.insertItem({
          userId: OWNER,
          projectId: PROJECT,
          contentHash: 'f'.repeat(64),
        })
      })

      const originalDigest = crypto.subtle.digest.bind(crypto.subtle)

      vi.spyOn(crypto.subtle, 'digest').mockImplementation(
        async (algorithm, data) => {
          await originalDigest(algorithm, data)

          const buffer = new ArrayBuffer(32)

          new Uint8Array(buffer).fill(0xff)

          return buffer
        },
      )

      await expect(createNote({ title: 'Racy', body: 'Ship it' }))
        .rejects.toMatchObject({ status: 409 })

      expect(harness.testDb.countItems(PROJECT)).toBe(1)
      expect(harness.bucket.calls).toEqual([])
    })

    it.each([
      ['an empty title', { title: '   ', body: 'text' }],
      ['an empty body', { title: 'Plan', body: '' }],
      ['a whitespace body', { title: 'Plan', body: '  \n ' }],
      ['a body over the note cap', {
        title: 'Plan',
        body: 'a'.repeat(KNOWLEDGE_LIMITS.maxNoteChars + 1),
      }],
      ['a NUL byte in the body', {
        title: 'Plan',
        body: `a${String.fromCharCode(0)}b`,
      }],
      ['a multi-line title', { title: 'a\nb', body: 'text' }],
    ])('answers 400 for %s', async (_label, body) => {
      await expect(createNote(body)).rejects.toMatchObject({ status: 400 })

      expect(harness.testDb.countItems()).toBe(0)
      expect(harness.bucket.calls).toEqual([])
    })

    it('answers 500 and keeps nothing when R2 fails', async () => {
      harness.bucket.failPutAt = 1

      await expect(createNote({ title: 'Plan', body: 'Ship it' }))
        .rejects.toMatchObject({ status: 500 })

      expect(harness.testDb.countItems()).toBe(0)
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
    })

    it('answers 413 when the note does not fit the quota', async () => {
      harness.testDb.sqlite.prepare('delete from storages').run()
      harness.testDb.insertStorage({ userId: OWNER, storage: 3 })

      await expect(createNote({ title: 'Plan', body: 'Ship it' }))
        .rejects.toMatchObject({ status: 413 })
    })
  })

  describe('PATCH note', () => {
    it('rewrites the body and commits', async () => {
      const note = await createNote({ title: 'Plan', body: 'Ship it' })

      mocks.commitKnowledgeChange.mockClear()

      const updated = await updateNote(note.id, { body: 'Ship it twice' })

      expect(updated).toMatchObject({ id: note.id, textBytes: 13 })
      expect(storedBodies()).toEqual(['Ship it twice'])
      expect(mocks.commitKnowledgeChange).toHaveBeenCalledOnce()
    })

    it('commits for a title change but not for a description change', async () => {
      const note = await createNote({ title: 'Plan', body: 'Ship it' })

      mocks.commitKnowledgeChange.mockClear()

      await updateNote(note.id, { description: 'Roadmap' })

      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()

      await updateNote(note.id, { title: 'Better plan' })

      expect(mocks.commitKnowledgeChange).toHaveBeenCalledOnce()
    })

    it('answers 409 when the new body matches another note', async () => {
      await createNote({ title: 'First', body: 'First body' })

      const second = await createNote({ title: 'Second', body: 'Second body' })

      mocks.commitKnowledgeChange.mockClear()

      await expect(updateNote(second.id, { body: 'First body' }))
        .rejects.toMatchObject({ status: 409 })

      expect(storedBodies().sort()).toEqual(['First body', 'Second body'])
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
    })

    it('answers 404 for a file item and 400 for an empty patch', async () => {
      const fileItemId = harness.testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        kind: 'file',
      })
      const note = await createNote({ title: 'Plan', body: 'Ship it' })

      await expect(
        updateNote(encodePublicId(fileItemId), { title: 'Hijack' }),
      ).rejects.toMatchObject({ status: 404 })
      await expect(updateNote(note.id, {}))
        .rejects.toMatchObject({ status: 400 })
    })
  })
})
