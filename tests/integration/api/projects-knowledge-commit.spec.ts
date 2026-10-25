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
const OTHER_PROJECT = 11
const FILE_EXPIRY_SECONDS = 1_900_000_000
const projectPublicId = encodePublicId(PROJECT)

describe('project knowledge commit and mode API', () => {
  let harness: KnowledgeApiHarness

  async function commit(body: unknown) {
    const handler = await loadKnowledgeHandler('commit')

    return await handler(knowledgeEvent({ projectId: projectPublicId, body }))
  }

  async function setMode(body: unknown) {
    const handler = await loadKnowledgeHandler('mode')

    return await handler(knowledgeEvent({ projectId: projectPublicId, body }))
  }

  function seedItem(
    overrides: Partial<Parameters<typeof harness.testDb.insertItem>[0]> = {},
  ) {
    return harness.testDb.insertItem({
      userId: OWNER,
      projectId: PROJECT,
      ...overrides,
    })
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    harness = createKnowledgeApiHarness()
    harness.install()
    harness.testDb.insertProject({ id: PROJECT, userId: OWNER })
    harness.testDb.insertProject({ id: OTHER_PROJECT, userId: OWNER })
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

  describe('POST commit', () => {
    it('commits once without removals', async () => {
      const result = await commit({})

      expect(result).toEqual({
        version: 1,
        packVersion: null,
        removed: 0,
        skipped: [],
      })
      expect(mocks.commitKnowledgeChange).toHaveBeenCalledOnce()
      expect(mocks.commitKnowledgeChange).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: OWNER,
          projectId: PROJECT,
          removeItemIds: [],
        }),
      )
    })

    it('removes the listed items in one commit', async () => {
      const first = seedItem({ title: 'One' })
      const second = seedItem({ title: 'Two' })
      const kept = seedItem({ title: 'Kept' })
      const result = await commit({
        remove: [encodePublicId(first), encodePublicId(second)],
      })

      expect(result).toMatchObject({ removed: 2, skipped: [] })
      expect(mocks.commitKnowledgeChange).toHaveBeenCalledOnce()
      expect(harness.testDb.countItems(PROJECT)).toBe(1)
      expect(harness.testDb.sqlite.prepare(
        'select id from project_knowledge_items',
      ).pluck().get()).toBe(kept)
    })

    it('reports unknown, foreign and malformed ids instead of failing', async () => {
      const mine = seedItem()
      const elsewhere = seedItem({ projectId: OTHER_PROJECT })
      const unknown = encodePublicId(9999)
      const result = await commit({
        remove: [
          encodePublicId(mine),
          encodePublicId(elsewhere),
          unknown,
          'not-an-id',
        ],
      })

      expect(result).toMatchObject({
        removed: 1,
        skipped: [encodePublicId(elsewhere), unknown, 'not-an-id'],
      })
      expect(harness.testDb.countItems(OTHER_PROJECT)).toBe(1)
    })

    it('scopes a folder sync to the folder', async () => {
      const synced = seedItem({ folderId: 'folder-1' })
      const unrelated = seedItem({ folderId: 'folder-2' })
      const result = await commit({
        folderId: 'folder-1',
        remove: [encodePublicId(synced), encodePublicId(unrelated)],
      })

      expect(result).toMatchObject({
        removed: 1,
        skipped: [encodePublicId(unrelated)],
      })
      expect(harness.testDb.countItems(PROJECT)).toBe(1)
    })

    it('restores the expiry of a file whose item was removed', async () => {
      harness.testDb.insertFile({
        id: 5,
        userId: OWNER,
        expiresAt: null,
      })

      const linked = seedItem({ kind: 'file', fileId: 5 })

      await commit({ remove: [encodePublicId(linked)] })

      expect(harness.testDb.getFileRow(5)?.expires_at).not.toBe(
        FILE_EXPIRY_SECONDS,
      )
      expect(harness.testDb.getFileRow(5)?.expires_at).toBeGreaterThan(0)
      expect(mocks.invalidateStorageCache).toHaveBeenCalled()
    })

    it('handles a full folder sync of 500 removals', async () => {
      const ids: string[] = []

      for (
        let count = 0;
        count < KNOWLEDGE_LIMITS.maxFolderFiles;
        count++
      ) {
        ids.push(encodePublicId(seedItem({ folderId: 'folder-1' })))
      }

      const result = await commit({ folderId: 'folder-1', remove: ids })

      expect(result).toMatchObject({
        removed: KNOWLEDGE_LIMITS.maxFolderFiles,
        skipped: [],
      })
      expect(harness.testDb.countItems(PROJECT)).toBe(0)
    })

    it.each([
      ['more than 500 ids', {
        remove: Array.from(
          { length: KNOWLEDGE_LIMITS.maxFolderFiles + 1 },
          (_value, index) => {
            return `id-${index}`
          },
        ),
      }],
      ['a folder id with spaces', { folderId: 'bad id' }],
      ['a folder id over 64 characters', { folderId: 'a'.repeat(65) }],
      ['non-string ids', { remove: [1, 2] }],
    ])('answers 400 for %s', async (_label, body) => {
      await expect(commit(body)).rejects.toMatchObject({ status: 400 })

      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
    })

    it('answers 500 and still refreshes the storage figure when the commit fails', async () => {
      const mine = seedItem()

      mocks.commitKnowledgeChange.mockRejectedValue(new Error('down'))

      await expect(commit({ remove: [encodePublicId(mine)] }))
        .rejects.toMatchObject({ status: 500 })
      expect(mocks.invalidateStorageCache).toHaveBeenCalled()
    })
  })

  describe('PATCH mode', () => {
    it.each(['auto', 'full', 'search'] as const)('stores %s without a version bump', async (mode) => {
      expect(await setMode({ mode })).toEqual({ mode })
      expect(harness.testDb.getProjectRow(PROJECT)).toMatchObject({
        knowledge_mode: mode,
        knowledge_version: null,
      })
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
    })

    it('clears the mode with null', async () => {
      await setMode({ mode: 'full' })

      expect(await setMode({ mode: null })).toEqual({ mode: null })
      expect(harness.testDb.getProjectRow(PROJECT)?.knowledge_mode).toBeNull()
    })

    it('leaves other projects alone', async () => {
      await setMode({ mode: 'search' })

      expect(harness.testDb.getProjectRow(OTHER_PROJECT)?.knowledge_mode)
        .toBeNull()
    })

    it.each([
      ['an unknown mode', { mode: 'bogus' }],
      ['a missing mode', {}],
      ['a non-string mode', { mode: 3 }],
    ])('answers 400 for %s', async (_label, body) => {
      await expect(setMode(body)).rejects.toMatchObject({ status: 400 })
    })
  })
})
