import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { createKnowledgeTestDb } from '../../../../setup/helpers/knowledge-db'
import type { KnowledgeTestDb } from '../../../../setup/helpers/knowledge-db'

const mocks = vi.hoisted(() => {
  return {
    invalidateStorageCache: vi.fn(),
    invalidateFileCache: vi.fn(),
    deleteObject: vi.fn(),
    logger: { set: vi.fn() },
  }
})

vi.mock('~~/server/api/v1/storage/index.get', () => {
  return { invalidateStorageCache: mocks.invalidateStorageCache }
})

const OWNER = 1
const STRANGER = 2

describe('delete owned files', () => {
  let testDb: KnowledgeTestDb
  let failNextRowDelete = false

  function fileId(id: number): string {
    return encodePublicId(id)
  }

  function remainingFileIds(): number[] {
    const rows = testDb.sqlite.prepare('select id from files order by id')
      .all() as Array<{ id: number }>

    return rows.map((row) => {
      return row.id
    })
  }

  function failStorageDelete(storageKey: string) {
    mocks.deleteObject.mockImplementation(async (keys: string | string[]) => {
      if (keys === storageKey) {
        throw new Error('R2 failure')
      }
    })
  }

  async function load() {
    return await import('~~/server/utils/files/delete-files')
  }

  beforeEach(() => {
    vi.resetModules()
    mocks.invalidateStorageCache.mockReset()
    mocks.invalidateFileCache.mockReset()
    mocks.deleteObject.mockReset()
    mocks.logger.set.mockReset()
    mocks.invalidateStorageCache.mockResolvedValue(undefined)
    mocks.invalidateFileCache.mockResolvedValue(undefined)
    mocks.deleteObject.mockResolvedValue(undefined)
    failNextRowDelete = false
    testDb = createKnowledgeTestDb()
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useFileStorage', () => {
      return { delete: mocks.deleteObject }
    })
    vi.stubGlobal('invalidateFileCache', mocks.invalidateFileCache)
    testDb.insertProject({ id: 10, userId: OWNER, knowledgeVersion: 3 })
    testDb.insertProject({ id: 11, userId: OWNER, knowledgeVersion: 5 })
    testDb.insertFile({ id: 1, userId: OWNER, storageKey: 'key-1' })
    testDb.insertFile({ id: 2, userId: OWNER, storageKey: 'key-2' })
    testDb.insertFile({ id: 3, userId: STRANGER, storageKey: 'key-3' })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('deleteOwnedFile', () => {
    it('deletes the object, the row and invalidates both caches',
      async () => {
        const { deleteOwnedFile } = await load()
        const outcome = await deleteOwnedFile({
          userId: OWNER,
          fileId: fileId(1),
          logger: mocks.logger,
        })

        expect(outcome).toBe('deleted')
        expect(mocks.deleteObject).toHaveBeenCalledWith('key-1')
        expect(mocks.invalidateFileCache).toHaveBeenCalledWith('key-1')
        expect(mocks.invalidateStorageCache).toHaveBeenCalledWith(OWNER)
        expect(remainingFileIds()).toEqual([2, 3])
      })

    it('reports not_found for another user file and touches nothing',
      async () => {
        const { deleteOwnedFile } = await load()
        const outcome = await deleteOwnedFile({
          userId: OWNER,
          fileId: fileId(3),
          logger: mocks.logger,
        })

        expect(outcome).toBe('not_found')
        expect(mocks.deleteObject).not.toHaveBeenCalled()
        expect(mocks.invalidateStorageCache).not.toHaveBeenCalled()
        expect(remainingFileIds()).toEqual([1, 2, 3])
      })

    it('keeps the row and reports storage_error when R2 fails', async () => {
      const { deleteOwnedFile } = await load()

      failStorageDelete('key-1')

      const outcome = await deleteOwnedFile({
        userId: OWNER,
        fileId: fileId(1),
        logger: mocks.logger,
      })

      expect(outcome).toBe('storage_error')
      expect(remainingFileIds()).toEqual([1, 2, 3])
      expect(mocks.invalidateStorageCache).not.toHaveBeenCalled()
    })
  })

  describe('knowledge text cleanup', () => {
    it('deletes the R2 text of every knowledge item that linked the file',
      async () => {
        const firstItemId = testDb.insertItem({
          userId: OWNER,
          projectId: 10,
          kind: 'file',
          fileId: 1,
        })
        const secondItemId = testDb.insertItem({
          userId: OWNER,
          projectId: 11,
          kind: 'file',
          fileId: 1,
        })

        testDb.insertItem({
          userId: OWNER,
          projectId: 10,
          kind: 'file',
          fileId: 2,
        })

        const { deleteOwnedFile } = await load()

        await deleteOwnedFile({
          userId: OWNER,
          fileId: fileId(1),
          logger: mocks.logger,
        })

        expect(mocks.deleteObject).toHaveBeenCalledWith('key-1')
        expect(mocks.deleteObject).toHaveBeenCalledWith([
          `knowledge/u${OWNER}/p10/items/${firstItemId}.md`,
        ])
        expect(mocks.deleteObject).toHaveBeenCalledWith([
          `knowledge/u${OWNER}/p11/items/${secondItemId}.md`,
        ])
        expect(mocks.deleteObject).toHaveBeenCalledTimes(3)
      })

    it('makes no extra R2 call for a file without knowledge links',
      async () => {
        const { deleteOwnedFile } = await load()

        await deleteOwnedFile({
          userId: OWNER,
          fileId: fileId(2),
          logger: mocks.logger,
        })

        expect(mocks.deleteObject).toHaveBeenCalledTimes(1)
        expect(mocks.deleteObject).toHaveBeenCalledWith('key-2')
      })

    it('keeps the knowledge text when the file object cannot be deleted',
      async () => {
        testDb.insertItem({
          userId: OWNER,
          projectId: 10,
          kind: 'file',
          fileId: 1,
        })
        failStorageDelete('key-1')

        const { deleteOwnedFile } = await load()
        const outcome = await deleteOwnedFile({
          userId: OWNER,
          fileId: fileId(1),
          logger: mocks.logger,
        })

        expect(outcome).toBe('storage_error')
        expect(mocks.deleteObject).toHaveBeenCalledTimes(1)
      })

    it('still deletes the file when the text cleanup fails', async () => {
      testDb.insertItem({
        userId: OWNER,
        projectId: 10,
        kind: 'file',
        fileId: 1,
      })
      mocks.deleteObject.mockImplementation(
        async (keys: string | string[]) => {
          if (Array.isArray(keys)) {
            throw new Error('R2 batch failure')
          }
        },
      )

      const { deleteOwnedFile } = await load()
      const outcome = await deleteOwnedFile({
        userId: OWNER,
        fileId: fileId(1),
        logger: mocks.logger,
      })

      expect(outcome).toBe('deleted')
      expect(remainingFileIds()).toEqual([2, 3])
      expect(mocks.logger.set).toHaveBeenCalledWith({
        attributes: {
          knowledgeTextCleanup: {
            phase: 'delete',
            fileId: fileId(1),
            projectId: 10,
            error: 'R2 batch failure',
          },
        },
      })
    })

    it('never touches the text of items that link another file', async () => {
      testDb.insertItem({
        userId: OWNER,
        projectId: 10,
        kind: 'file',
        fileId: 1,
      })

      const strangerItemId = testDb.insertItem({
        userId: STRANGER,
        projectId: 20,
        kind: 'file',
        fileId: 3,
      })
      const { deleteOwnedFile } = await load()

      await deleteOwnedFile({
        userId: OWNER,
        fileId: fileId(1),
        logger: mocks.logger,
      })

      for (const [keys] of mocks.deleteObject.mock.calls) {
        expect(keys).not.toContain(`knowledge/u${STRANGER}/p20/items/${
          strangerItemId
        }.md`)
      }
    })
  })

  describe('deleteOwnedFiles', () => {
    it('deletes owned files one at a time and reports the rest', async () => {
      const { deleteOwnedFiles } = await load()
      const result = await deleteOwnedFiles({
        userId: OWNER,
        fileIds: [fileId(1), fileId(3), fileId(2)],
        logger: mocks.logger,
      })

      expect(result).toEqual({
        deleted: [fileId(1), fileId(2)],
        notFound: [fileId(3)],
        failed: [],
        errored: [],
      })
      expect(remainingFileIds()).toEqual([3])
      expect(mocks.invalidateStorageCache).toHaveBeenCalledTimes(1)
    })

    it('lists storage failures separately and keeps those rows', async () => {
      const { deleteOwnedFiles } = await load()

      failStorageDelete('key-1')

      const result = await deleteOwnedFiles({
        userId: OWNER,
        fileIds: [fileId(1), fileId(2)],
        logger: mocks.logger,
      })

      expect(result).toEqual({
        deleted: [fileId(2)],
        notFound: [],
        failed: [fileId(1)],
        errored: [],
      })
      expect(remainingFileIds()).toEqual([1, 3])
    })

    it('keeps going and reports a file whose removal throws', async () => {
      const { deleteOwnedFiles } = await load()

      vi.stubGlobal('useDb', () => {
        return new Proxy(testDb.db, {
          get(target, property, receiver) {
            if (property === 'delete' && failNextRowDelete) {
              failNextRowDelete = false

              throw new Error('D1 failure with a secret title')
            }

            return Reflect.get(target, property, receiver)
          },
        })
      })
      failNextRowDelete = true

      const result = await deleteOwnedFiles({
        userId: OWNER,
        fileIds: [fileId(1), fileId(2)],
        logger: mocks.logger,
      })

      expect(result).toEqual({
        deleted: [fileId(2)],
        notFound: [],
        failed: [],
        errored: [fileId(1)],
      })
      expect(JSON.stringify(mocks.logger.set.mock.calls))
        .not.toContain('secret title')
    })

    it('does not invalidate the storage cache when nothing was deleted',
      async () => {
        const { deleteOwnedFiles } = await load()
        const result = await deleteOwnedFiles({
          userId: OWNER,
          fileIds: [fileId(3)],
          logger: mocks.logger,
        })

        expect(result.deleted).toEqual([])
        expect(mocks.invalidateStorageCache).not.toHaveBeenCalled()
      })

    it('bumps the knowledge version of linked projects before and after',
      async () => {
        testDb.insertItem({
          userId: OWNER,
          projectId: 10,
          kind: 'file',
          fileId: 1,
        })

        const { deleteOwnedFiles } = await load()

        await deleteOwnedFiles({
          userId: OWNER,
          fileIds: [fileId(1)],
          logger: mocks.logger,
        })

        expect(testDb.getProjectRow(10)!.knowledge_version).toBe(5)
        expect(testDb.getProjectRow(11)!.knowledge_version).toBe(5)
      })
  })
})
