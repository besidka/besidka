import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import {
  decodeKnowledgeProjectId,
  findKnowledgeLinkedFileIds,
  findKnowledgeProjectIdsForFiles,
  unlinkKnowledgeProjectFiles,
} from '~~/server/utils/knowledge/linked-files'
import { createKnowledgeTestDb } from '../../../setup/helpers/knowledge-db'
import type { KnowledgeTestDb } from '../../../setup/helpers/knowledge-db'

const OWNER = 1
const STRANGER = 2
const SECONDS_PER_DAY = 24 * 60 * 60

describe('knowledge linked files', () => {
  let testDb: KnowledgeTestDb

  function link(input: {
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

  beforeEach(() => {
    testDb = createKnowledgeTestDb()
    vi.stubGlobal('useDb', () => testDb.db)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('decodeKnowledgeProjectId', () => {
    it('decodes a public project id to the internal integer', () => {
      expect(decodeKnowledgeProjectId(encodePublicId(42))).toBe(42)
    })

    it('returns null for ids that do not decode', () => {
      expect(decodeKnowledgeProjectId('not-a-public-id!')).toBeNull()
      expect(decodeKnowledgeProjectId('')).toBeNull()
    })
  })

  describe('findKnowledgeLinkedFileIds', () => {
    it('returns an empty set without querying for no ids', async () => {
      const useDb = vi.fn(() => testDb.db)

      vi.stubGlobal('useDb', useDb)

      expect(await findKnowledgeLinkedFileIds(OWNER, [])).toEqual(new Set())
      expect(useDb).not.toHaveBeenCalled()
    })

    it('returns only the files a knowledge item references', async () => {
      testDb.insertFile({ id: 1, userId: OWNER })
      testDb.insertFile({ id: 2, userId: OWNER })
      testDb.insertFile({ id: 3, userId: OWNER })
      link({ projectId: 10, fileId: 1 })
      link({ projectId: 11, fileId: 3 })

      const linked = await findKnowledgeLinkedFileIds(OWNER, [
        encodePublicId(1),
        encodePublicId(2),
        encodePublicId(3),
      ])

      expect(linked).toEqual(new Set([encodePublicId(1), encodePublicId(3)]))
    })

    it('never reports another user file as linked', async () => {
      testDb.insertFile({ id: 4, userId: STRANGER })
      link({ userId: STRANGER, projectId: 20, fileId: 4 })

      const linked = await findKnowledgeLinkedFileIds(OWNER, [
        encodePublicId(4),
      ])

      expect(linked.size).toBe(0)
    })

    it('stays under the bound-parameter limit for long id lists', async () => {
      const fileIds: string[] = []

      for (let fileId = 1; fileId <= 250; fileId++) {
        testDb.insertFile({ id: fileId, userId: OWNER })
        fileIds.push(encodePublicId(fileId))

        if (fileId % 2 === 0) {
          link({ projectId: 10 + (fileId % 7), fileId })
        }
      }

      const linked = await findKnowledgeLinkedFileIds(OWNER, fileIds)

      expect(linked.size).toBe(125)
      expect(linked.has(encodePublicId(2))).toBe(true)
      expect(linked.has(encodePublicId(1))).toBe(false)
    })
  })

  describe('findKnowledgeProjectIdsForFiles', () => {
    it('returns the distinct internal project ids that link the files', async () => {
      testDb.insertFile({ id: 1, userId: OWNER })
      testDb.insertFile({ id: 2, userId: OWNER })
      testDb.insertFile({ id: 3, userId: OWNER })
      link({ projectId: 10, fileId: 1 })
      link({ projectId: 10, fileId: 2 })
      link({ projectId: 11, fileId: 2 })
      link({ projectId: 12, fileId: 3 })

      const projectIds = await findKnowledgeProjectIdsForFiles(OWNER, [
        encodePublicId(1),
        encodePublicId(2),
      ])

      expect([...projectIds].sort()).toEqual([10, 11])
    })

    it('returns nothing for unlinked files, other users and no ids', async () => {
      testDb.insertFile({ id: 1, userId: OWNER })
      testDb.insertFile({ id: 2, userId: STRANGER })
      link({ userId: STRANGER, projectId: 20, fileId: 2 })

      expect(await findKnowledgeProjectIdsForFiles(OWNER, [
        encodePublicId(1),
        encodePublicId(2),
      ])).toEqual([])
      expect(await findKnowledgeProjectIdsForFiles(OWNER, [])).toEqual([])
    })

    it('handles more ids than one query can bind', async () => {
      const fileIds: string[] = []

      for (let fileId = 1; fileId <= 200; fileId++) {
        testDb.insertFile({ id: fileId, userId: OWNER })
        fileIds.push(encodePublicId(fileId))
        link({ projectId: fileId <= 100 ? 10 : 11, fileId })
      }

      const projectIds = await findKnowledgeProjectIdsForFiles(OWNER, fileIds)

      expect([...projectIds].sort()).toEqual([10, 11])
    })
  })

  describe('unlinkKnowledgeProjectFiles', () => {
    function expectExpiryInDays(
      expiresAt: number | null | undefined,
      days: number,
    ): void {
      const expected = Math.floor(Date.now() / 1000) + days * SECONDS_PER_DAY

      expect(expiresAt).not.toBeNull()
      expect(Math.abs((expiresAt as number) - expected)).toBeLessThan(5)
    }

    beforeEach(() => {
      testDb.insertFile({ id: 1, userId: OWNER })
      testDb.insertFile({ id: 2, userId: OWNER })
      testDb.insertFile({ id: 3, userId: OWNER })
      testDb.insertFile({ id: 4, userId: OWNER })
      link({ projectId: 10, fileId: 1 })
      link({ projectId: 10, fileId: 2 })
      link({ projectId: 11, fileId: 2 })
      link({ projectId: 11, fileId: 3 })
    })

    it('restores the tier expiry only for files linked nowhere else', async () => {
      await unlinkKnowledgeProjectFiles({
        userId: OWNER,
        projectId: 10,
        retentionDays: 30,
      })

      expectExpiryInDays(testDb.getFileRow(1)?.expires_at, 30)
      expect(testDb.getFileRow(2)?.expires_at).toBeNull()
      expect(testDb.getFileRow(3)?.expires_at).toBeNull()
      expect(testDb.getFileRow(4)?.expires_at).toBeNull()
    })

    it('keeps the file non-expiring while the other project links it', async () => {
      await unlinkKnowledgeProjectFiles({
        userId: OWNER,
        projectId: 10,
        retentionDays: 7,
      })
      await unlinkKnowledgeProjectFiles({
        userId: OWNER,
        projectId: 11,
        retentionDays: 7,
      })

      expectExpiryInDays(testDb.getFileRow(1)?.expires_at, 7)
      expectExpiryInDays(testDb.getFileRow(3)?.expires_at, 7)
      expect(testDb.getFileRow(4)?.expires_at).toBeNull()
    })

    it('restores nothing but null for a vip tier', async () => {
      testDb.sqlite
        .prepare('update files set expires_at = ? where id = 1')
        .run(1_900_000_000)

      await unlinkKnowledgeProjectFiles({
        userId: OWNER,
        projectId: 10,
        retentionDays: null,
      })

      expect(testDb.getFileRow(1)?.expires_at).toBeNull()
      expect(testDb.getFileRow(2)?.expires_at).toBeNull()
    })

    it('never touches files of another user', async () => {
      testDb.insertFile({ id: 5, userId: STRANGER })
      link({ userId: STRANGER, projectId: 10, fileId: 5 })

      await unlinkKnowledgeProjectFiles({
        userId: OWNER,
        projectId: 10,
        retentionDays: 30,
      })

      expect(testDb.getFileRow(5)?.expires_at).toBeNull()
    })

    it('does not rely on cascade having run yet', async () => {
      expect(testDb.countItems(10)).toBe(2)

      await unlinkKnowledgeProjectFiles({
        userId: OWNER,
        projectId: 10,
        retentionDays: 30,
      })

      expect(testDb.countItems(10)).toBe(2)
    })
  })
})
