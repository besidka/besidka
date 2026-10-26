import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodePublicId, encodePublicId } from '~~/server/utils/custom-db-types'
import {
  countUserKnowledgeItems,
  getKnowledgeProjectState,
  listKnowledgeItems,
  toKnowledgeItemWire,
} from '~~/server/utils/knowledge/items'
import { createKnowledgeTestDb } from '../../../setup/helpers/knowledge-db'

const OWNER = 1
const STRANGER = 2
const PROJECT = 10

describe('knowledge items', () => {
  let testDb: ReturnType<typeof createKnowledgeTestDb>

  beforeEach(() => {
    testDb = createKnowledgeTestDb()
    vi.stubGlobal('useDb', () => testDb.db)
    testDb.insertProject({ id: PROJECT, userId: OWNER })
    testDb.insertProject({ id: 11, userId: STRANGER })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('listKnowledgeItems', () => {
    it('returns wire items in createdAt then id order', async () => {
      const lateId = testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        title: 'Late',
        createdAt: 2_000,
      })
      const earlyId = testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        title: 'Early',
        createdAt: 1_000,
      })
      const sameSecondId = testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        title: 'Same second',
        createdAt: 2_000,
      })

      const items = await listKnowledgeItems({
        userId: OWNER,
        projectId: PROJECT,
      })

      expect(items.map((item) => {
        return item.title
      })).toEqual(['Early', 'Late', 'Same second'])
      expect(items.map((item) => {
        return decodePublicId(item.id)
      })).toEqual([earlyId, lateId, sameSecondId])
    })

    it('does not list items of another project or another user', async () => {
      testDb.insertItem({ userId: OWNER, projectId: PROJECT, title: 'Mine' })
      testDb.insertItem({ userId: OWNER, projectId: 12, title: 'Other' })
      testDb.insertItem({ userId: STRANGER, projectId: 11, title: 'Theirs' })

      const items = await listKnowledgeItems({
        userId: OWNER,
        projectId: PROJECT,
      })
      const foreign = await listKnowledgeItems({
        userId: OWNER,
        projectId: 11,
      })

      expect(items.map((item) => {
        return item.title
      })).toEqual(['Mine'])
      expect(foreign).toEqual([])
    })
  })

  describe('countUserKnowledgeItems', () => {
    it('counts the items of every project of the user, whatever their status', async () => {
      testDb.insertProject({ id: 12, userId: OWNER })
      testDb.insertItem({ userId: OWNER, projectId: PROJECT })
      testDb.insertItem({ userId: OWNER, projectId: 12 })
      testDb.insertItem({
        userId: OWNER,
        projectId: 12,
        extractStatus: 'failed',
      })

      expect(await countUserKnowledgeItems(OWNER)).toBe(3)
    })

    it('never counts the items of another user', async () => {
      testDb.insertItem({ userId: OWNER, projectId: PROJECT })
      testDb.insertItem({ userId: STRANGER, projectId: 11 })
      testDb.insertItem({ userId: STRANGER, projectId: 11 })

      expect(await countUserKnowledgeItems(OWNER)).toBe(1)
      expect(await countUserKnowledgeItems(STRANGER)).toBe(2)
    })

    it('is 0 for a user without items', async () => {
      expect(await countUserKnowledgeItems(OWNER)).toBe(0)
    })
  })

  describe('toKnowledgeItemWire', () => {
    it('maps ids to public ids, dates to ISO and null flags to false', async () => {
      testDb.insertFile({ id: 7, userId: OWNER })

      const itemId = testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        kind: 'file',
        fileId: 7,
        title: 'Spec.pdf',
        description: 'The spec',
        relativePath: 'docs/Spec.pdf',
        folderId: 'folder-1',
        contentHash: 'ab'.repeat(32),
        mediaType: 'application/pdf',
        textBytes: 120,
        latinChars: 100,
        cyrillicChars: 15,
        otherChars: 5,
        extractor: 'client-unpdf',
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_500,
      })

      const [item] = await listKnowledgeItems({
        userId: OWNER,
        projectId: PROJECT,
      })

      expect(item).toEqual({
        id: encodePublicId(itemId),
        projectId: encodePublicId(PROJECT),
        kind: 'file',
        fileId: encodePublicId(7),
        title: 'Spec.pdf',
        description: 'The spec',
        relativePath: 'docs/Spec.pdf',
        folderId: 'folder-1',
        contentHash: 'ab'.repeat(32),
        mediaType: 'application/pdf',
        sizeBytes: null,
        pageCount: null,
        textBytes: 120,
        latinChars: 100,
        cyrillicChars: 15,
        otherChars: 5,
        extractStatus: 'ready',
        extractError: null,
        extractor: 'client-unpdf',
        sendAsNativePdf: false,
        pinned: false,
        createdAt: '2023-11-14T22:13:20.000Z',
        updatedAt: '2023-11-14T22:21:40.000Z',
      })
    })

    it('keeps a null file id for notes and maps true flags', () => {
      const wire = toKnowledgeItemWire({
        id: 'abc',
        createdAt: new Date(0),
        updatedAt: new Date(1_000),
        userId: OWNER,
        projectId: PROJECT,
        kind: 'note',
        fileId: null,
        title: 'Note',
        description: null,
        relativePath: null,
        folderId: null,
        mediaType: null,
        sizeBytes: null,
        pageCount: null,
        contentHash: 'hash',
        textBytes: 1,
        latinChars: 1,
        cyrillicChars: 0,
        otherChars: 0,
        extractStatus: 'ready',
        extractError: null,
        extractor: 'note',
        sendAsNativePdf: true,
        pinned: true,
      })

      expect(wire.id).toBe('abc')
      expect(wire.fileId).toBeNull()
      expect(wire.sendAsNativePdf).toBe(true)
      expect(wire.pinned).toBe(true)
      expect(wire.contentHash).toBe('hash')
      expect(wire).not.toHaveProperty('userId')
    })
  })

  describe('getKnowledgeProjectState', () => {
    it('reads a null version as zero and a missing pack as null', async () => {
      expect(await getKnowledgeProjectState({
        userId: OWNER,
        projectId: PROJECT,
      })).toEqual({ mode: null, version: 0, packVersion: null })
    })

    it('returns mode, version and pack version', async () => {
      testDb.insertProject({
        id: 20,
        userId: OWNER,
        knowledgeMode: 'search',
        knowledgeVersion: 5,
        knowledgePackVersion: 4,
      })

      expect(await getKnowledgeProjectState({
        userId: OWNER,
        projectId: 20,
      })).toEqual({ mode: 'search', version: 5, packVersion: 4 })
    })

    it('returns null for a missing project', async () => {
      expect(await getKnowledgeProjectState({
        userId: OWNER,
        projectId: 999,
      })).toBeNull()
    })

    it('returns null for a project owned by another user', async () => {
      expect(await getKnowledgeProjectState({
        userId: OWNER,
        projectId: 11,
      })).toBeNull()
    })
  })
})
