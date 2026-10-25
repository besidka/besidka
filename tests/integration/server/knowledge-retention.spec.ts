import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { createKnowledgeTestDb } from '../../setup/helpers/knowledge-db'
import type { KnowledgeTestDb } from '../../setup/helpers/knowledge-db'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  invalidateStorageCache: vi.fn(),
  invalidateFileCache: vi.fn(),
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
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

vi.mock('~~/server/utils/files/convert-files-for-ai', () => ({
  invalidateFileCache: mocks.invalidateFileCache,
}))

const OWNER = 1
const STRANGER = 2
const SECONDS_PER_DAY = 24 * 60 * 60
const NOW = new Date('2026-10-25T12:00:00.000Z')
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000)
const PAST_SECONDS = NOW_SECONDS - SECONDS_PER_DAY
const FUTURE_SECONDS = NOW_SECONDS + 10 * SECONDS_PER_DAY

function createFakeBucket(initialKeys: string[] = []) {
  const keys = new Set(initialKeys)
  const deleteCalls: Array<string | string[]> = []

  return {
    storage: {
      list: vi.fn(async (options: {
        prefix: string
        cursor?: string
        limit: number
      }) => {
        const matching = [...keys].filter((key) => {
          return key.startsWith(options.prefix)
        })

        return {
          objects: matching.map((key) => {
            return { key }
          }),
          truncated: false,
          cursor: undefined,
        }
      }),
      delete: vi.fn(async (target: string | string[]) => {
        deleteCalls.push(target)

        for (const key of Array.isArray(target) ? target : [target]) {
          keys.delete(key)
        }
      }),
    },
    keys: () => [...keys].sort(),
    deleteCalls,
  }
}

describe('knowledge retention and cascade handling', () => {
  let testDb: KnowledgeTestDb

  function linkFile(input: {
    userId?: number
    projectId: number
    fileId: number
  }): void {
    testDb.insertItem({
      userId: input.userId ?? OWNER,
      projectId: input.projectId,
      kind: 'file',
      fileId: input.fileId,
    })
  }

  function fileExists(fileId: number): boolean {
    return testDb.getFileRow(fileId) !== undefined
  }

  function knowledgeVersion(projectId: number): number | null {
    return testDb.getProjectRow(projectId)?.knowledge_version ?? null
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    testDb = createKnowledgeTestDb()
    mocks.invalidateStorageCache.mockResolvedValue(undefined)
    mocks.invalidateFileCache.mockResolvedValue(undefined)
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: String(OWNER) },
    }))
    vi.stubGlobal('useUnauthorizedError', () => {
      throw new Error('Unauthorized')
    })
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
    vi.stubGlobal('readBody', async (event: { body: unknown }) => event.body)
    vi.stubGlobal('setResponseStatus', (
      _event: unknown,
      code: number,
      message: string,
    ) => {
      return { code, message }
    })
    vi.stubGlobal('invalidateFileCache', mocks.invalidateFileCache)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('cleanupExpiredFiles', () => {
    async function runCleanup(batchSize = 100) {
      const { cleanupExpiredFiles } = await import(
        '~~/server/utils/files/cleanup-expired-files'
      )

      return cleanupExpiredFiles({
        now: NOW,
        batchSize,
        maxRuntimeMs: 20000,
      })
    }

    it('never expires a file a knowledge item links to', async () => {
      const bucket = createFakeBucket()

      vi.stubGlobal('useFileStorage', () => bucket.storage)
      testDb.insertFile({
        id: 1,
        userId: OWNER,
        storageKey: 'expired-free',
        expiresAt: PAST_SECONDS,
      })
      testDb.insertFile({
        id: 2,
        userId: OWNER,
        storageKey: 'expired-linked',
        expiresAt: PAST_SECONDS,
      })
      testDb.insertFile({
        id: 3,
        userId: OWNER,
        storageKey: 'not-yet-expired',
        expiresAt: FUTURE_SECONDS,
      })
      linkFile({ projectId: 10, fileId: 2 })

      const result = await runCleanup()

      expect(result.selectedCount).toBe(1)
      expect(result.deletedCount).toBe(1)
      expect(bucket.deleteCalls).toEqual(['expired-free'])
      expect(fileExists(1)).toBe(false)
      expect(fileExists(2)).toBe(true)
      expect(fileExists(3)).toBe(true)
    })

    it('does not let linked expired files starve the batch', async () => {
      const bucket = createFakeBucket()

      vi.stubGlobal('useFileStorage', () => bucket.storage)

      for (let fileId = 1; fileId <= 3; fileId++) {
        testDb.insertFile({
          id: fileId,
          userId: OWNER,
          storageKey: `linked-${fileId}`,
          expiresAt: PAST_SECONDS - fileId,
        })
        linkFile({ projectId: 10, fileId })
      }

      testDb.insertFile({
        id: 4,
        userId: OWNER,
        storageKey: 'plain-expired',
        expiresAt: PAST_SECONDS,
      })

      const result = await runCleanup(2)

      expect(result.selectedCount).toBe(1)
      expect(bucket.deleteCalls).toEqual(['plain-expired'])
    })

    it('expires the file once no item links to it any more', async () => {
      const bucket = createFakeBucket()

      vi.stubGlobal('useFileStorage', () => bucket.storage)
      testDb.insertFile({
        id: 1,
        userId: OWNER,
        storageKey: 'was-linked',
        expiresAt: PAST_SECONDS,
      })
      linkFile({ projectId: 10, fileId: 1 })

      await runCleanup()

      expect(fileExists(1)).toBe(true)

      testDb.sqlite.prepare('delete from project_knowledge_items').run()

      await runCleanup()

      expect(fileExists(1)).toBe(false)
      expect(bucket.deleteCalls).toEqual(['was-linked'])
    })
  })

  describe('recomputeUserFileExpiry', () => {
    async function recompute() {
      const { recomputeUserFileExpiry } = await import(
        '~~/server/utils/files/file-governance'
      )

      return recomputeUserFileExpiry(OWNER, { now: NOW })
    }

    it('gives unlinked files an expiry and leaves linked files non-expiring', async () => {
      testDb.insertStorage({
        userId: OWNER,
        tier: 'free',
        fileRetentionDays: 30,
      })
      testDb.insertFile({
        id: 1,
        userId: OWNER,
        createdAt: NOW_SECONDS - 5 * SECONDS_PER_DAY,
      })
      testDb.insertFile({
        id: 2,
        userId: OWNER,
        createdAt: NOW_SECONDS - 5 * SECONDS_PER_DAY,
      })
      linkFile({ projectId: 10, fileId: 2 })

      const result = await recompute()

      expect(result.retentionDays).toBe(30)
      expect(result.totalFiles).toBe(1)
      expect(result.updatedFiles).toBe(1)
      expect(testDb.getFileRow(1)?.expires_at).toBe(
        NOW_SECONDS + 25 * SECONDS_PER_DAY,
      )
      expect(testDb.getFileRow(2)?.expires_at).toBeNull()
    })

    it('does nothing for a user whose files are all linked', async () => {
      testDb.insertStorage({
        userId: OWNER,
        tier: 'free',
        fileRetentionDays: 30,
      })
      testDb.insertFile({ id: 1, userId: OWNER })
      linkFile({ projectId: 10, fileId: 1 })

      const result = await recompute()

      expect(result.totalFiles).toBe(0)
      expect(result.updatedFiles).toBe(0)
      expect(testDb.getFileRow(1)?.expires_at).toBeNull()
    })

    it('clears expiry for vip users without touching linked files', async () => {
      testDb.insertStorage({
        userId: OWNER,
        tier: 'vip',
        fileRetentionDays: 30,
      })
      testDb.insertFile({ id: 1, userId: OWNER, expiresAt: FUTURE_SECONDS })
      testDb.insertFile({ id: 2, userId: OWNER, expiresAt: FUTURE_SECONDS })
      linkFile({ projectId: 10, fileId: 2 })

      const result = await recompute()

      expect(result.retentionDays).toBeNull()
      expect(result.updatedFiles).toBe(1)
      expect(testDb.getFileRow(1)?.expires_at).toBeNull()
      expect(testDb.getFileRow(2)?.expires_at).toBe(FUTURE_SECONDS)
    })

    it('does not touch the files of other users', async () => {
      testDb.insertStorage({
        userId: OWNER,
        tier: 'vip',
        fileRetentionDays: 30,
      })
      testDb.insertFile({ id: 1, userId: STRANGER, expiresAt: FUTURE_SECONDS })

      await recompute()

      expect(testDb.getFileRow(1)?.expires_at).toBe(FUTURE_SECONDS)
    })
  })

  describe('cleanupFilesOrphanedByChatDeletion', () => {
    beforeEach(() => {
      testDb.sqlite.exec(`
        CREATE TABLE chats (
          id integer PRIMARY KEY,
          user_id integer NOT NULL
        );
        CREATE TABLE messages (
          id integer PRIMARY KEY,
          chat_id integer NOT NULL,
          parts text NOT NULL
        );
      `)
    })

    async function runOrphanCleanup(fileIds: number[]) {
      const { cleanupFilesOrphanedByChatDeletion } = await import(
        '~~/server/utils/files/chat-deletion-cleanup'
      )
      const candidates = fileIds.map((fileId) => {
        return {
          id: encodePublicId(fileId),
          storageKey: `files/test-${fileId}`,
        }
      })

      return cleanupFilesOrphanedByChatDeletion(
        candidates,
        OWNER,
        { set: vi.fn() },
      )
    }

    it('keeps files that a knowledge item links to', async () => {
      const bucket = createFakeBucket()

      vi.stubGlobal('useFileStorage', () => bucket.storage)

      for (let fileId = 1; fileId <= 3; fileId++) {
        testDb.insertFile({ id: fileId, userId: OWNER })
      }

      linkFile({ projectId: 10, fileId: 2 })

      const result = await runOrphanCleanup([1, 2, 3])

      expect(result).toEqual({
        candidateCount: 3,
        stillReferencedCount: 1,
        deletedCount: 2,
        failedCount: 0,
      })
      expect(bucket.deleteCalls).toEqual([
        ['files/test-1', 'files/test-3'],
      ])
      expect(fileExists(1)).toBe(false)
      expect(fileExists(2)).toBe(true)
      expect(fileExists(3)).toBe(false)
    })

    it('checks every candidate when there are more than one query can bind', async () => {
      const bucket = createFakeBucket()
      const fileIds: number[] = []

      vi.stubGlobal('useFileStorage', () => bucket.storage)

      for (let fileId = 1; fileId <= 200; fileId++) {
        testDb.insertFile({ id: fileId, userId: OWNER })
        fileIds.push(fileId)

        if (fileId > 150) {
          linkFile({ projectId: 10, fileId })
        }
      }

      const result = await runOrphanCleanup(fileIds)

      expect(result.stillReferencedCount).toBe(50)
      expect(result.deletedCount).toBe(150)
      expect(fileExists(150)).toBe(false)
      expect(fileExists(151)).toBe(true)
      expect(fileExists(200)).toBe(true)
    })
  })

  describe('file delete handlers', () => {
    beforeEach(() => {
      testDb.insertProject({ id: 10, userId: OWNER })
      testDb.insertProject({ id: 11, userId: OWNER })
      testDb.insertProject({ id: 12, userId: OWNER, knowledgeVersion: 4 })
      testDb.insertProject({ id: 20, userId: STRANGER })
      testDb.insertFile({ id: 1, userId: OWNER, storageKey: 'file-key-1' })
      testDb.insertFile({ id: 2, userId: OWNER, storageKey: 'file-key-2' })
      testDb.insertFile({ id: 3, userId: OWNER, storageKey: 'file-key-3' })
      testDb.insertFile({ id: 5, userId: STRANGER, storageKey: 'file-key-5' })
      linkFile({ projectId: 10, fileId: 1 })
      linkFile({ projectId: 11, fileId: 1 })
      linkFile({ projectId: 10, fileId: 2 })
      linkFile({ projectId: 12, fileId: 3 })
      linkFile({ userId: STRANGER, projectId: 20, fileId: 5 })
    })

    async function deleteSingle(fileId: number) {
      const handler = (await import(
        '~~/server/api/v1/files/[id]/index.delete'
      )).default

      return handler({
        context: { params: { id: encodePublicId(fileId) } },
      } as never)
    }

    async function deleteBulk(fileIds: number[]) {
      const handler = (await import(
        '~~/server/api/v1/files/delete/bulk.post'
      )).default

      return handler({
        body: { ids: fileIds.map(fileId => encodePublicId(fileId)) },
      } as never)
    }

    it('bumps every project that links a deleted file', async () => {
      const bucket = createFakeBucket()

      vi.stubGlobal('useFileStorage', () => bucket.storage)

      await deleteSingle(1)

      expect(knowledgeVersion(10)).toBe(1)
      expect(knowledgeVersion(11)).toBe(1)
      expect(knowledgeVersion(12)).toBe(4)
      expect(knowledgeVersion(20)).toBeNull()
      expect(fileExists(1)).toBe(false)
      expect(bucket.deleteCalls).toEqual(['file-key-1'])
    })

    it('leaves versions alone when the file has no knowledge items', async () => {
      const bucket = createFakeBucket()

      vi.stubGlobal('useFileStorage', () => bucket.storage)
      testDb.insertFile({ id: 9, userId: OWNER, storageKey: 'file-key-9' })

      await deleteSingle(9)

      expect(knowledgeVersion(10)).toBeNull()
      expect(knowledgeVersion(12)).toBe(4)
      expect(fileExists(9)).toBe(false)
    })

    it('does not bump when the file belongs to another user', async () => {
      const bucket = createFakeBucket()

      vi.stubGlobal('useFileStorage', () => bucket.storage)

      await expect(deleteSingle(5)).rejects.toMatchObject({ status: 404 })

      expect(knowledgeVersion(20)).toBeNull()
      expect(fileExists(5)).toBe(true)
    })

    it('bumps the affected projects once for a bulk delete', async () => {
      const bucket = createFakeBucket()

      vi.stubGlobal('useFileStorage', () => bucket.storage)

      await deleteBulk([1, 2, 3])

      expect(knowledgeVersion(10)).toBe(1)
      expect(knowledgeVersion(11)).toBe(1)
      expect(knowledgeVersion(12)).toBe(5)
      expect(knowledgeVersion(20)).toBeNull()
      expect(fileExists(1)).toBe(false)
      expect(fileExists(2)).toBe(false)
      expect(fileExists(3)).toBe(false)
    })

    it('ignores another user file id inside a bulk delete', async () => {
      const bucket = createFakeBucket()

      vi.stubGlobal('useFileStorage', () => bucket.storage)

      await deleteBulk([2, 5])

      expect(knowledgeVersion(10)).toBe(1)
      expect(knowledgeVersion(20)).toBeNull()
      expect(fileExists(5)).toBe(true)
    })

    it('bumps before deleting even when the R2 delete fails', async () => {
      const failingStorage = {
        delete: vi.fn(async () => {
          throw new Error('R2 unavailable')
        }),
      }

      vi.stubGlobal('useFileStorage', () => failingStorage)

      await expect(deleteSingle(1)).rejects.toMatchObject({ status: 409 })

      expect(knowledgeVersion(10)).toBe(1)
      expect(fileExists(1)).toBe(true)
    })
  })

  describe('project delete handler', () => {
    beforeEach(() => {
      testDb.sqlite.exec(`
        CREATE TABLE chats (
          id integer PRIMARY KEY,
          created_at integer NOT NULL,
          updated_at integer NOT NULL,
          user_id integer NOT NULL,
          project_id integer,
          activity_at integer NOT NULL
        );
      `)
      testDb.insertStorage({
        userId: OWNER,
        tier: 'free',
        fileRetentionDays: 30,
      })
      testDb.insertProject({ id: 10, userId: OWNER })
      testDb.insertProject({ id: 11, userId: OWNER })
      testDb.insertProject({ id: 20, userId: STRANGER })
      testDb.insertFile({ id: 1, userId: OWNER })
      testDb.insertFile({ id: 2, userId: OWNER })
      testDb.insertFile({ id: 3, userId: OWNER })
      testDb.insertFile({ id: 4, userId: OWNER })
      linkFile({ projectId: 10, fileId: 1 })
      linkFile({ projectId: 10, fileId: 2 })
      linkFile({ projectId: 11, fileId: 2 })
      linkFile({ projectId: 11, fileId: 3 })
    })

    async function deleteProject(projectId: number) {
      const handler = (await import(
        '~~/server/api/v1/projects/[id]/index.delete'
      )).default

      return handler({
        params: { id: encodePublicId(projectId) },
      } as never)
    }

    function projectExists(projectId: number): boolean {
      return testDb.getProjectRow(projectId) !== undefined
    }

    it('restores the tier expiry only for files no other project links', async () => {
      const bucket = createFakeBucket()

      vi.stubGlobal('useFileStorage', () => bucket.storage)

      const response = await deleteProject(10)
      const expectedExpiry = Math.floor(Date.now() / 1000)
        + 30 * SECONDS_PER_DAY

      expect(response).toEqual({ success: true })
      expect(projectExists(10)).toBe(false)
      expect(projectExists(11)).toBe(true)
      expect(Math.abs(
        (testDb.getFileRow(1)?.expires_at as number) - expectedExpiry,
      )).toBeLessThan(5)
      expect(testDb.getFileRow(2)?.expires_at).toBeNull()
      expect(testDb.getFileRow(3)?.expires_at).toBeNull()
      expect(testDb.getFileRow(4)?.expires_at).toBeNull()
    })

    it('gives a vip user null expiry back', async () => {
      const bucket = createFakeBucket()

      vi.stubGlobal('useFileStorage', () => bucket.storage)
      testDb.sqlite.prepare('update storages set tier = \'vip\'').run()

      await deleteProject(10)

      expect(testDb.getFileRow(1)?.expires_at).toBeNull()
    })

    it('purges only the deleted project R2 prefix', async () => {
      const bucket = createFakeBucket([
        'knowledge/u1/p10/items/1.md',
        'knowledge/u1/p10/pack/v1.jsonl.gz',
        'knowledge/u1/p11/items/2.md',
        'knowledge/u2/p10/items/3.md',
        'files/original.pdf',
      ])

      vi.stubGlobal('useFileStorage', () => bucket.storage)

      await deleteProject(10)

      expect(bucket.keys()).toEqual([
        'files/original.pdf',
        'knowledge/u1/p11/items/2.md',
        'knowledge/u2/p10/items/3.md',
      ])
      expect(mocks.invalidateStorageCache).toHaveBeenCalledWith(
        OWNER,
        expect.anything(),
      )
    })

    it('does not fail the request when the R2 purge fails', async () => {
      const failingStorage = {
        list: vi.fn(async () => {
          throw new Error('R2 unavailable')
        }),
        delete: vi.fn(),
      }

      vi.stubGlobal('useFileStorage', () => failingStorage)

      const response = await deleteProject(10)

      expect(response).toEqual({ success: true })
      expect(projectExists(10)).toBe(false)
      expect(failingStorage.delete).not.toHaveBeenCalled()
      expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
        knowledgePurge: { failed: true },
      }))
      expect(mocks.invalidateStorageCache).toHaveBeenCalled()
    })

    it('answers 404 for another user project and changes nothing', async () => {
      const bucket = createFakeBucket(['knowledge/u2/p20/items/1.md'])

      vi.stubGlobal('useFileStorage', () => bucket.storage)

      await expect(deleteProject(20)).rejects.toMatchObject({ status: 404 })

      expect(projectExists(20)).toBe(true)
      expect(bucket.keys()).toEqual(['knowledge/u2/p20/items/1.md'])
      expect(bucket.storage.list).not.toHaveBeenCalled()
    })
  })
})
