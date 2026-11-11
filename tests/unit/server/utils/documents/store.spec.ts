import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import {
  createFakeDocumentStorage,
  readDocument,
  seedDocument,
} from '../../../../setup/helpers/documents-db'
import type {
  FakeDocumentStorage,
} from '../../../../setup/helpers/documents-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const {
  createDocument,
  deleteDocumentSpecObjects,
  getDocumentSpecKey,
  getDocumentUserPrefix,
  getOwnedDocument,
  insertDocumentRow,
  listChatDocuments,
  putDocumentSpec,
  readDocumentSpec,
  toDocumentStatusResponse,
} = await import('~~/server/utils/documents/store')

describe('document store', () => {
  let testDb: MemoryExtractionTestDb
  let storage: FakeDocumentStorage
  let userId: number
  let otherUserId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    storage = createFakeDocumentStorage()
    vi.stubGlobal('useFileStorage', () => storage)
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('spec keys', () => {
    it('builds documents/<userId>/<documentId>/spec.v<n>.json', () => {
      expect(getDocumentSpecKey(7, 'AbC123', 2))
        .toBe('documents/7/AbC123/spec.v2.json')
      expect(getDocumentUserPrefix(7)).toBe('documents/7/')
    })

    it('refuses ids that could escape the prefix', () => {
      expect(() => getDocumentSpecKey(7, '../x', 1)).toThrow()
      expect(() => getDocumentSpecKey(7, 'a/b', 1)).toThrow()
      expect(() => getDocumentSpecKey(0, 'abc', 1)).toThrow()
      expect(() => getDocumentSpecKey(7, 'abc', 0)).toThrow()
      expect(() => getDocumentUserPrefix(-1)).toThrow()
    })
  })

  describe('spec objects', () => {
    it('writes the spec as JSON and reports its byte length', async () => {
      const specJson = '{"title":"Résumé"}'
      const result = await putDocumentSpec(7, 'abc', 1, specJson)

      expect(result).toEqual({
        specR2Key: 'documents/7/abc/spec.v1.json',
        specBytes: new TextEncoder().encode(specJson).byteLength,
      })
      expect(result.specBytes).toBeGreaterThan(specJson.length)
      expect(storage.put).toHaveBeenCalledWith(
        'documents/7/abc/spec.v1.json',
        specJson,
        { httpMetadata: { contentType: 'application/json' } },
      )
    })

    it('reads a stored spec and answers null for a missing key', async () => {
      await putDocumentSpec(7, 'abc', 1, '{"a":1}')

      await expect(readDocumentSpec('documents/7/abc/spec.v1.json'))
        .resolves.toBe('{"a":1}')
      await expect(readDocumentSpec('documents/7/none/spec.v1.json'))
        .resolves.toBeNull()
    })

    it('deletes keys in chunks of 1000, one call per chunk', async () => {
      const keys = Array.from({ length: 2500 }, (_value, index) => {
        return `documents/7/d${index}/spec.v1.json`
      })
      const deleted = await deleteDocumentSpecObjects([...keys, keys[0]!])

      expect(deleted).toBe(2500)
      expect(storage.deleteCalls.map(call => call.length))
        .toEqual([1000, 1000, 500])
    })

    it('does not call storage for an empty key list', async () => {
      await expect(deleteDocumentSpecObjects([])).resolves.toBe(0)
      expect(storage.delete).not.toHaveBeenCalled()
    })
  })

  describe('creating rows', () => {
    const baseValues = {
      format: 'docx',
      title: 'Meeting notes',
      createdVia: 'chat',
    } as const

    it('stores a row without a spec as failed/spec_missing', async () => {
      const row = await insertDocumentRow(testDb.db, {
        userId,
        ...baseValues,
        specVersion: 1,
      })

      expect(row).toMatchObject({
        id: expect.stringMatching(/^pub-\d+$/),
        userId,
        status: 'failed',
        errorCode: 'spec_missing',
        specR2Key: null,
        renderAttempts: 0,
        fileId: null,
      })
    })

    it('writes the spec and moves the row to spec_ready', async () => {
      const chat = await seedChat(testDb.db, userId)
      const row = await createDocument(testDb.db, {
        userId,
        ...baseValues,
        originChatId: chat.id,
        originMessagePublicId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        stats: {
          pages: 2, slides: null, sheets: null, cells: null, images: 0,
        },
        originProvider: 'anthropic',
        originModel: 'claude-haiku-5',
        specJson: '{"version":1}',
      })

      expect(row).toMatchObject({
        status: 'spec_ready',
        errorCode: null,
        specVersion: 1,
        specBytes: 13,
        specR2Key: `documents/${userId}/${row.id}/spec.v1.json`,
        originChatId: chat.id,
        originMessagePublicId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        stats: { pages: 2, slides: null, sheets: null, cells: null, images: 0 },
      })
      expect(storage.objects.get(row.specR2Key!)).toBe('{"version":1}')
    })

    it('removes the half-created row when the spec cannot be stored',
      async () => {
        storage.put.mockRejectedValueOnce(new Error('R2 down'))

        await expect(createDocument(testDb.db, {
          userId,
          ...baseValues,
          specJson: '{}',
        })).rejects.toThrow('R2 down')

        const rows = testDb.sqlite.prepare('select id from documents').all()

        expect(rows).toEqual([])
      })

    function withFailingUpdate(db: typeof testDb.db): typeof testDb.db {
      return new Proxy(db, {
        get(target, property, receiver) {
          if (property === 'update') {
            return () => {
              throw new Error('D1 down')
            }
          }

          return Reflect.get(target, property, receiver)
        },
      })
    }

    it('deletes the stored spec object when the row update fails',
      async () => {
        await expect(createDocument(withFailingUpdate(testDb.db), {
          userId,
          ...baseValues,
          specJson: '{"version":1}',
        })).rejects.toThrow('D1 down')

        expect(storage.objects.size).toBe(0)
        expect(storage.deleteCalls).toHaveLength(1)
        expect(testDb.sqlite.prepare('select id from documents').all())
          .toEqual([])
      })

    it('still removes the row and rethrows the first error when the spec '
      + 'object cannot be deleted', async () => {
      storage.delete.mockRejectedValueOnce(new Error('R2 down'))

      await expect(createDocument(withFailingUpdate(testDb.db), {
        userId,
        ...baseValues,
        specJson: '{"version":1}',
      })).rejects.toThrow('D1 down')

      expect(testDb.sqlite.prepare('select id from documents').all())
        .toEqual([])
    })
  })

  describe('getOwnedDocument', () => {
    it('returns the row for its owner only', async () => {
      const document = await seedDocument(testDb.db, { userId })

      await expect(getOwnedDocument(testDb.db, userId, document.id))
        .resolves.toMatchObject({ id: document.id })
      await expect(getOwnedDocument(testDb.db, otherUserId, document.id))
        .resolves.toBeNull()
    })

    it('answers null for an unknown or malformed id', async () => {
      await expect(getOwnedDocument(testDb.db, userId, 'pub-999'))
        .resolves.toBeNull()
      await expect(getOwnedDocument(testDb.db, userId, 'x\'; drop'))
        .resolves.toBeNull()
    })
  })

  describe('toDocumentStatusResponse', () => {
    it('maps a ready row with its file', async () => {
      const row = await seedDocument(testDb.db, {
        userId,
        status: 'ready',
        renderedBy: 'client',
        fileId: 'pub-4',
        stats: {
          pages: 3, slides: null, sheets: null, cells: null, images: 1,
        },
      })

      expect(toDocumentStatusResponse(row, {
        id: 'pub-4',
        storageKey: 'abc.pdf',
        name: 'Quarterly report.pdf',
        size: 1234,
        type: 'application/pdf',
      })).toEqual({
        id: row.id,
        format: 'pdf',
        title: 'Quarterly report',
        status: 'ready',
        file: {
          id: 'pub-4',
          storageKey: 'abc.pdf',
          name: 'Quarterly report.pdf',
          size: 1234,
          type: 'application/pdf',
        },
        renderedBy: 'client',
        errorCode: null,
        stats: {
          pages: 3, slides: null, sheets: null, cells: null, images: 1,
        },
      })
    })

    it('maps a failed row without a file and with a null title', async () => {
      const row = await seedDocument(testDb.db, {
        userId,
        status: 'failed',
        title: null,
        errorCode: 'file_deleted',
      })

      expect(toDocumentStatusResponse(row, null)).toEqual({
        id: row.id,
        format: 'pdf',
        title: null,
        status: 'failed',
        file: null,
        renderedBy: null,
        errorCode: 'file_deleted',
        stats: null,
      })
    })

    it('does not leak columns that are not part of the response', async () => {
      const row = await seedDocument(testDb.db, {
        userId,
        specR2Key: 'documents/1/x/spec.v1.json',
      })

      expect(Object.keys(toDocumentStatusResponse(row, null)).sort())
        .toEqual([
          'errorCode',
          'file',
          'format',
          'id',
          'renderedBy',
          'stats',
          'status',
          'title',
        ])
    })
  })

  describe('listChatDocuments', () => {
    it('lists the newest documents of the chat for its owner', async () => {
      const chat = await seedChat(testDb.db, userId)
      const otherChat = await seedChat(testDb.db, userId)
      const oldest = await seedDocument(testDb.db, {
        userId,
        originChatId: chat.id,
        title: 'Oldest',
        createdAt: new Date('2026-11-11T08:00:00.000Z'),
      })
      const middle = await seedDocument(testDb.db, {
        userId,
        originChatId: chat.id,
        title: 'Middle',
        createdAt: new Date('2026-11-11T09:00:00.000Z'),
      })
      const newest = await seedDocument(testDb.db, {
        userId,
        originChatId: chat.id,
        title: 'Newest',
        createdAt: new Date('2026-11-11T10:00:00.000Z'),
      })

      await seedDocument(testDb.db, { userId, originChatId: otherChat.id })
      await seedDocument(testDb.db, {
        userId: otherUserId,
        originChatId: chat.id,
      })

      const all = await listChatDocuments(testDb.db, {
        userId,
        chatId: chat.id,
        limit: 10,
      })
      const limited = await listChatDocuments(testDb.db, {
        userId,
        chatId: chat.id,
        limit: 2,
      })

      expect(all.map(document => document.id))
        .toEqual([newest.id, middle.id, oldest.id])
      expect(limited.map(document => document.title))
        .toEqual(['Newest', 'Middle'])
      expect(all[0]).toEqual({
        id: newest.id,
        format: 'pdf',
        title: 'Newest',
        status: 'spec_ready',
        specVersion: 1,
        stats: null,
        fileId: null,
        originMessagePublicId: null,
        createdAt: new Date('2026-11-11T10:00:00.000Z'),
      })
    })

    it('keeps rows readable after the title was removed', async () => {
      const chat = await seedChat(testDb.db, userId)
      const document = await seedDocument(testDb.db, {
        userId,
        originChatId: chat.id,
        title: null,
        status: 'failed',
      })
      const stored = await readDocument(testDb.db, document.id)

      expect(stored!.title).toBeNull()
      await expect(listChatDocuments(testDb.db, {
        userId,
        chatId: chat.id,
        limit: 5,
      })).resolves.toHaveLength(1)
    })
  })
})
