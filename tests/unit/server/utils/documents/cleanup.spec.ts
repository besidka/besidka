import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
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
  seedDocumentWithSpec,
} from '../../../../setup/helpers/documents-db'
import type {
  FakeDocumentStorage,
} from '../../../../setup/helpers/documents-db'

const mocks = vi.hoisted(() => ({
  invalidateStorageCache: vi.fn(async () => undefined),
  invalidateFileCache: vi.fn(async () => undefined),
  logger: { set: vi.fn() },
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

vi.mock('~~/server/utils/files/convert-files-for-ai', () => ({
  invalidateFileCache: mocks.invalidateFileCache,
}))

const {
  cleanupDocumentsForDeletedChats,
  cleanupDocumentsForDeletedFiles,
  cleanupDocumentsForDeletedMessage,
  purgeUserDocuments,
  sweepOrphanedDocuments,
} = await import('~~/server/utils/documents/cleanup')
const { deleteChat, deleteChatMessage } = await import(
  '~~/server/utils/chats/lifecycle'
)
const { cleanupExpiredFiles } = await import(
  '~~/server/utils/files/cleanup-expired-files'
)
const { deleteOwnedFile, deleteOwnedFiles } = await import(
  '~~/server/utils/files/delete-files'
)
const { cleanupFilesOrphanedByChatDeletion } = await import(
  '~~/server/utils/files/chat-deletion-cleanup'
)

const TITLE = 'Confidential salary review'
const NOW = new Date('2026-11-11T12:00:00.000Z')
const LONG_AGO = new Date('2026-11-01T12:00:00.000Z')
const TWO_DAYS_AGO = new Date('2026-11-09T12:00:00.000Z')
const TEN_DAYS_AGO = new Date('2026-11-01T12:00:00.000Z')
const DANGLING_FILE_ID = 'pub-9999'

function rowId(publicId: string): number {
  return Number(publicId.slice(4))
}

describe('document deletion hooks', () => {
  let testDb: MemoryExtractionTestDb
  let storage: FakeDocumentStorage
  let userId: number
  let otherUserId: number

  async function seedFile(
    values: Partial<typeof schema.files.$inferInsert> & {
      userId: number
      storageKey: string
    },
  ): Promise<string> {
    const [file] = await testDb.db.insert(schema.files).values({
      name: 'report.pdf',
      size: 100,
      type: 'application/pdf',
      source: 'assistant',
      ...values,
    }).returning({ id: schema.files.id })

    storage.objects.set(values.storageKey, 'bytes')

    return file!.id
  }

  async function seedAssistantMessage(
    chatId: string,
    publicId: string,
    parts: unknown[] = [],
  ): Promise<string> {
    const [message] = await testDb.db.insert(schema.messages).values({
      chatId,
      role: 'assistant',
      parts: parts as never,
      publicId,
    }).returning({ id: schema.messages.id })

    return message!.id
  }

  function withD1MessageDeleteResult(
    db: typeof testDb.db,
  ): typeof testDb.db {
    return new Proxy(db, {
      get(target, property, receiver) {
        if (property !== 'delete') {
          return Reflect.get(target, property, receiver)
        }

        return (table: unknown) => {
          const builder = target.delete(table as typeof schema.messages)

          if (table !== schema.messages) {
            return builder
          }

          return {
            where: (condition: Parameters<typeof builder.where>[0]) => {
              const query = builder.where(condition)

              return {
                then: (
                  resolve: (value: unknown) => void,
                  reject: (reason: unknown) => void,
                ) => {
                  Promise.resolve(query)
                    .then((result) => {
                      return { meta: { changes: result.changes } }
                    })
                    .then(resolve, reject)
                },
              }
            },
          }
        }
      },
    })
  }

  function documentCount(): number {
    const row = testDb.sqlite.prepare('select count(*) as count from documents')
      .get() as { count: number }

    return row.count
  }

  function loggedText(): string {
    return JSON.stringify(mocks.logger.set.mock.calls)
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    testDb = createMemoryExtractionTestDb()
    storage = createFakeDocumentStorage()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useFileStorage', () => storage)
    vi.stubGlobal('invalidateFileCache', mocks.invalidateFileCache)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('chat delete', () => {
    it('deletes the chat documents, their files and their spec objects',
      async () => {
        const chat = await seedChat(testDb.db, userId)
        const otherChat = await seedChat(testDb.db, userId)

        await seedAssistantMessage(chat.id, 'msg-user-1')

        const messageId = await seedAssistantMessage(chat.id, 'msg-gen')
        const fileId = await seedFile({
          userId,
          storageKey: 'generated.pdf',
          originMessageId: rowId(messageId),
        })
        const withFile = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          originChatId: chat.id,
          originMessageId: rowId(messageId),
          title: TITLE,
          status: 'ready',
          fileId,
        })
        const withoutFile = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          originChatId: chat.id,
          title: TITLE,
        })
        const elsewhere = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          originChatId: otherChat.id,
          title: 'Other chat document',
        })

        await deleteChat(
          testDb.db,
          userId,
          { id: chat.id, projectId: null },
          mocks.logger,
        )

        expect(await readDocument(testDb.db, withFile.id)).toBeUndefined()
        expect(await readDocument(testDb.db, withoutFile.id)).toBeUndefined()
        expect(await readDocument(testDb.db, elsewhere.id))
          .toMatchObject({ title: 'Other chat document' })
        expect(storage.objects.has('generated.pdf')).toBe(false)
        expect(storage.objects.has(withFile.specR2Key!)).toBe(false)
        expect(storage.objects.has(withoutFile.specR2Key!)).toBe(false)
        expect(storage.objects.has(elsewhere.specR2Key!)).toBe(true)
        expect(loggedText()).not.toContain(TITLE)
      })

    it('keeps the file and spec of a referenced file, with no title or chat',
      async () => {
        const chat = await seedChat(testDb.db, userId)
        const otherChat = await seedChat(testDb.db, userId)
        const messageId = await seedAssistantMessage(chat.id, 'msg-gen')

        await seedAssistantMessage(otherChat.id, 'msg-copy', [{
          type: 'file',
          url: '/files/shared.pdf',
          mediaType: 'application/pdf',
        }])

        const fileId = await seedFile({
          userId,
          storageKey: 'shared.pdf',
          originMessageId: rowId(messageId),
        })
        const document = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          originChatId: chat.id,
          originMessageId: rowId(messageId),
          originMessagePublicId: 'msg-gen',
          title: TITLE,
          status: 'ready',
          fileId,
        })

        await deleteChat(
          testDb.db,
          userId,
          { id: chat.id, projectId: null },
          mocks.logger,
        )

        expect(await readDocument(testDb.db, document.id)).toMatchObject({
          title: null,
          originChatId: null,
          originMessageId: null,
          originMessagePublicId: null,
          fileId,
          status: 'ready',
          specR2Key: document.specR2Key,
        })
        expect(storage.objects.has('shared.pdf')).toBe(true)
        expect(storage.objects.has(document.specR2Key!)).toBe(true)
      })
  })

  describe('single message delete', () => {
    it('deletes the documents and files made by the message', async () => {
      const chat = await seedChat(testDb.db, userId)

      await seedAssistantMessage(chat.id, 'msg-keep')

      const messageId = await seedAssistantMessage(chat.id, 'msg-gone')
      const fileId = await seedFile({
        userId,
        storageKey: 'made.pdf',
        originMessageId: rowId(messageId),
      })
      const rendered = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        originChatId: chat.id,
        originMessageId: rowId(messageId),
        originMessagePublicId: 'msg-gone',
        title: TITLE,
        status: 'ready',
        fileId,
      })
      const unrendered = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        originChatId: chat.id,
        originMessagePublicId: 'msg-gone',
        title: TITLE,
      })
      const kept = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        originChatId: chat.id,
        originMessagePublicId: 'msg-keep',
        title: 'Other message document',
      })

      await deleteChatMessage(
        withD1MessageDeleteResult(testDb.db),
        userId,
        chat.id,
        'msg-gone',
        mocks.logger,
      )

      expect(await readDocument(testDb.db, rendered.id)).toBeUndefined()
      expect(await readDocument(testDb.db, unrendered.id)).toBeUndefined()
      expect(await readDocument(testDb.db, kept.id))
        .toMatchObject({ title: 'Other message document' })
      expect(storage.objects.has('made.pdf')).toBe(false)
      expect(storage.objects.has(rendered.specR2Key!)).toBe(false)
      expect(storage.objects.has(unrendered.specR2Key!)).toBe(false)
      expect(storage.objects.has(kept.specR2Key!)).toBe(true)
    })

    it('detaches a document whose file survives, matching by public id',
      async () => {
        const chat = await seedChat(testDb.db, userId)
        const fileId = await seedFile({
          userId,
          storageKey: 'kept.pdf',
        })
        const document = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          originChatId: chat.id,
          originMessagePublicId: 'msg-gone',
          title: TITLE,
          status: 'ready',
          fileId,
        })

        await cleanupDocumentsForDeletedMessage(testDb.db, {
          userId,
          messageRowId: null,
          messagePublicId: 'msg-gone',
          logger: mocks.logger,
        })

        expect(await readDocument(testDb.db, document.id)).toMatchObject({
          title: null,
          originChatId: null,
          originMessagePublicId: null,
          fileId,
        })
        expect(storage.objects.has(document.specR2Key!)).toBe(true)
      })

    it('does nothing without a message id', async () => {
      const result = await cleanupDocumentsForDeletedMessage(testDb.db, {
        userId,
        messageRowId: null,
        messagePublicId: null,
        logger: mocks.logger,
      })

      expect(result.rowsFound).toBe(0)
      expect(mocks.logger.set).not.toHaveBeenCalled()
    })
  })

  describe('rows whose files row is gone', () => {
    it('deletes the row and its spec when the chat is deleted', async () => {
      const chat = await seedChat(testDb.db, userId)
      const dangling = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        status: 'ready',
        originChatId: chat.id,
        fileId: DANGLING_FILE_ID,
        title: TITLE,
      })
      const result = await cleanupDocumentsForDeletedChats(testDb.db, {
        userId,
        chatIds: [chat.id],
        logger: mocks.logger,
      })

      expect(result).toMatchObject({
        rowsFound: 1,
        rowsDeleted: 1,
        rowsDetached: 0,
        specObjectsDeleted: 1,
      })
      expect(await readDocument(testDb.db, dangling.id)).toBeUndefined()
      expect(storage.objects.has(dangling.specR2Key!)).toBe(false)
    })

    it('deletes the row and its spec when its message is deleted',
      async () => {
        const dangling = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          status: 'ready',
          originMessagePublicId: 'msg-gone',
          fileId: DANGLING_FILE_ID,
        })
        const result = await cleanupDocumentsForDeletedMessage(testDb.db, {
          userId,
          messageRowId: null,
          messagePublicId: 'msg-gone',
          logger: mocks.logger,
        })

        expect(result).toMatchObject({ rowsDeleted: 1, rowsDetached: 0 })
        expect(await readDocument(testDb.db, dangling.id)).toBeUndefined()
        expect(storage.objects.has(dangling.specR2Key!)).toBe(false)
      })

    it('still detaches a row whose file exists', async () => {
      const chat = await seedChat(testDb.db, userId)
      const fileId = await seedFile({ userId, storageKey: 'live.pdf' })
      const live = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        status: 'ready',
        originChatId: chat.id,
        fileId,
        title: TITLE,
      })
      const result = await cleanupDocumentsForDeletedChats(testDb.db, {
        userId,
        chatIds: [chat.id],
        logger: mocks.logger,
      })

      expect(result).toMatchObject({ rowsDeleted: 0, rowsDetached: 1 })
      expect(await readDocument(testDb.db, live.id)).toMatchObject({
        title: null,
        originChatId: null,
        fileId,
      })
      expect(storage.objects.has(live.specR2Key!)).toBe(true)
    })
  })

  describe('bulk chat delete', () => {
    it('resolves the documents of every listed chat for the owner only',
      async () => {
        const firstChat = await seedChat(testDb.db, userId)
        const secondChat = await seedChat(testDb.db, userId)
        const keptChat = await seedChat(testDb.db, userId)
        const strangerChat = await seedChat(testDb.db, otherUserId)
        const first = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          originChatId: firstChat.id,
        })
        const second = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          originChatId: secondChat.id,
        })
        const kept = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          originChatId: keptChat.id,
        })
        const stranger = await seedDocumentWithSpec(testDb.db, storage, {
          userId: otherUserId,
          originChatId: strangerChat.id,
        })

        const result = await cleanupDocumentsForDeletedChats(testDb.db, {
          userId,
          chatIds: [firstChat.id, secondChat.id, strangerChat.id],
          logger: mocks.logger,
        })

        expect(result).toMatchObject({
          rowsFound: 2,
          rowsDeleted: 2,
          rowsDetached: 0,
          specObjectsDeleted: 2,
        })
        expect(storage.deleteCalls).toHaveLength(1)
        expect(await readDocument(testDb.db, first.id)).toBeUndefined()
        expect(await readDocument(testDb.db, second.id)).toBeUndefined()
        expect(await readDocument(testDb.db, kept.id)).toBeDefined()
        expect(await readDocument(testDb.db, stranger.id)).toBeDefined()
        expect(storage.objects.has(stranger.specR2Key!)).toBe(true)
      })

    it('detaches a row as a failed orphan when its spec cannot be deleted',
      async () => {
        const chat = await seedChat(testDb.db, userId)
        const document = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          originChatId: chat.id,
          title: TITLE,
        })

        storage.delete.mockRejectedValueOnce(new Error('R2 down'))

        const result = await cleanupDocumentsForDeletedChats(testDb.db, {
          userId,
          chatIds: [chat.id],
          logger: mocks.logger,
        })

        expect(result).toMatchObject({
          rowsDeleted: 0,
          rowsDetached: 1,
          specDeleteFailed: true,
        })
        expect(await readDocument(testDb.db, document.id)).toMatchObject({
          title: null,
          originChatId: null,
          status: 'failed',
          specR2Key: document.specR2Key,
        })
      })

    it('never throws when the database fails', async () => {
      const failingDb = {
        select: () => {
          throw new Error('D1 down')
        },
      } as unknown as typeof testDb.db

      await expect(cleanupDocumentsForDeletedChats(failingDb, {
        userId,
        chatIds: ['pub-1'],
        logger: mocks.logger,
      })).resolves.toMatchObject({ rowsFound: 0 })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        attributes: {
          documents: {
            cleanup: {
              'chat-delete': expect.objectContaining({ error: 'D1 down' }),
            },
          },
        },
      })
    })
  })

  describe('retention cleanup', () => {
    it('removes the spec and nulls the title of an expired file document',
      async () => {
        const fileId = await seedFile({
          userId,
          storageKey: 'expired.pdf',
          expiresAt: new Date('2026-11-10T00:00:00.000Z'),
        })
        const document = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          title: TITLE,
          status: 'ready',
          fileId,
        })
        const result = await cleanupExpiredFiles({
          now: NOW,
          batchSize: 10,
          maxRuntimeMs: 10_000,
          logger: mocks.logger,
        })

        expect(result).toMatchObject({ selectedCount: 1, deletedCount: 1 })
        expect(storage.objects.has('expired.pdf')).toBe(false)
        expect(storage.objects.has(document.specR2Key!)).toBe(false)
        expect(await readDocument(testDb.db, document.id)).toMatchObject({
          title: null,
          fileId: null,
          status: 'failed',
          errorCode: 'file_deleted',
          specR2Key: null,
        })
        expect(loggedText()).not.toContain(TITLE)
      })

    it('sweeps orphaned documents in the same run', async () => {
      const orphan = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        status: 'failed',
        title: null,
        updatedAt: LONG_AGO,
      })

      await cleanupExpiredFiles({
        now: NOW,
        batchSize: 10,
        maxRuntimeMs: 10_000,
        logger: mocks.logger,
      })

      expect(await readDocument(testDb.db, orphan.id)).toBeUndefined()
      expect(storage.objects.has(orphan.specR2Key!)).toBe(false)
    })
  })

  describe('file delete', () => {
    it('handles a bulk delete of owned files', async () => {
      const firstFile = await seedFile({ userId, storageKey: 'one.pdf' })
      const secondFile = await seedFile({ userId, storageKey: 'two.pdf' })
      const first = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        title: TITLE,
        status: 'ready',
        fileId: firstFile,
      })
      const second = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        title: TITLE,
        status: 'ready',
        fileId: secondFile,
      })
      const untouchedFile = await seedFile({ userId, storageKey: 'three.pdf' })
      const untouched = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        title: 'Untouched',
        status: 'ready',
        fileId: untouchedFile,
      })
      const result = await deleteOwnedFiles({
        userId,
        fileIds: [firstFile, secondFile],
        logger: mocks.logger,
      })

      expect(result.deleted).toEqual([firstFile, secondFile])

      for (const document of [first, second]) {
        expect(await readDocument(testDb.db, document.id)).toMatchObject({
          title: null,
          fileId: null,
          status: 'failed',
          errorCode: 'file_deleted',
        })
        expect(storage.objects.has(document.specR2Key!)).toBe(false)
      }

      expect(await readDocument(testDb.db, untouched.id))
        .toMatchObject({ title: 'Untouched', fileId: untouchedFile })
      expect(storage.objects.has(untouched.specR2Key!)).toBe(true)
    })

    it('handles a single owned file delete', async () => {
      const fileId = await seedFile({ userId, storageKey: 'single.pdf' })
      const document = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        title: TITLE,
        status: 'ready',
        fileId,
      })

      await expect(deleteOwnedFile({
        userId,
        fileId,
        logger: mocks.logger,
      })).resolves.toBe('deleted')
      expect(await readDocument(testDb.db, document.id)).toMatchObject({
        title: null,
        errorCode: 'file_deleted',
      })
      expect(storage.objects.has(document.specR2Key!)).toBe(false)
    })

    it('leaves the document alone when the R2 file delete fails',
      async () => {
        const fileId = await seedFile({ userId, storageKey: 'stuck.pdf' })
        const document = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          title: TITLE,
          status: 'ready',
          fileId,
        })

        storage.delete.mockRejectedValueOnce(new Error('R2 down'))

        await expect(deleteOwnedFile({
          userId,
          fileId,
          logger: mocks.logger,
        })).resolves.toBe('storage_error')
        expect(await readDocument(testDb.db, document.id))
          .toMatchObject({ title: TITLE, status: 'ready', fileId })
        expect(storage.objects.has(document.specR2Key!)).toBe(true)
      })

    it('does not touch the documents of another user', async () => {
      const fileId = await seedFile({ userId, storageKey: 'mine.pdf' })
      const document = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        title: TITLE,
        status: 'ready',
        fileId,
      })

      await cleanupDocumentsForDeletedFiles(testDb.db, {
        userId: otherUserId,
        fileIds: [fileId],
        logger: mocks.logger,
      })

      expect(await readDocument(testDb.db, document.id))
        .toMatchObject({ title: TITLE, fileId })
    })

    it('keeps the spec key when the spec object cannot be deleted',
      async () => {
        const fileId = await seedFile({ userId, storageKey: 'a.pdf' })
        const document = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          title: TITLE,
          status: 'ready',
          fileId,
        })

        storage.delete.mockRejectedValueOnce(new Error('R2 down'))

        const result = await cleanupDocumentsForDeletedFiles(testDb.db, {
          userId,
          fileIds: [fileId],
          logger: mocks.logger,
        })

        expect(result.specDeleteFailed).toBe(true)
        expect(await readDocument(testDb.db, document.id)).toMatchObject({
          title: null,
          fileId: null,
          status: 'failed',
          specR2Key: document.specR2Key,
        })
      })

    it('runs from the chat-deletion orphan cleanup for the deleted files',
      async () => {
        const fileId = await seedFile({ userId, storageKey: 'orphan.pdf' })
        const document = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          title: TITLE,
          status: 'ready',
          fileId,
        })

        await cleanupFilesOrphanedByChatDeletion(
          [{ id: fileId, storageKey: 'orphan.pdf' }],
          userId,
          mocks.logger,
        )

        expect(await readDocument(testDb.db, document.id)).toMatchObject({
          title: null,
          errorCode: 'file_deleted',
        })
        expect(storage.objects.has(document.specR2Key!)).toBe(false)
      })
  })

  describe('purgeUserDocuments', () => {
    it('deletes every row and every object under the user prefix only',
      async () => {
        storage = createFakeDocumentStorage(2)
        vi.stubGlobal('useFileStorage', () => storage)

        const owned = [
          await seedDocumentWithSpec(testDb.db, storage, { userId }),
          await seedDocumentWithSpec(testDb.db, storage, { userId }),
          await seedDocumentWithSpec(testDb.db, storage, { userId }),
        ]
        const other = await seedDocumentWithSpec(testDb.db, storage, {
          userId: otherUserId,
        })

        storage.objects.set(`documents/${userId}/stray/spec.v1.json`, '{}')
        storage.objects.set(`documents/${userId}0/lookalike/spec.v1.json`, '{}')

        const result = await purgeUserDocuments(
          testDb.db,
          userId,
          mocks.logger,
        )

        expect(result).toEqual({
          documentsDeleted: 3,
          documentObjectsDeleted: 4,
        })
        expect(storage.listCalls).toHaveLength(2)
        expect(storage.deleteCalls.map(call => call.length)).toEqual([2, 2])

        for (const document of owned) {
          expect(storage.objects.has(document.specR2Key!)).toBe(false)
          expect(await readDocument(testDb.db, document.id)).toBeUndefined()
        }

        expect(storage.objects.has(other.specR2Key!)).toBe(true)
        expect(storage.objects.has(`documents/${userId}0/lookalike/spec.v1.json`))
          .toBe(true)
        expect(documentCount()).toBe(1)
      })

    it('rethrows an R2 failure and keeps the rows', async () => {
      const document = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
      })

      storage.delete.mockRejectedValueOnce(new Error('R2 down'))

      await expect(purgeUserDocuments(testDb.db, userId, mocks.logger))
        .rejects.toThrow('R2 down')
      expect(await readDocument(testDb.db, document.id)).toBeDefined()
    })
  })

  describe('sweepOrphanedDocuments', () => {
    it('removes failed rows that no file and no chat reach, with specs',
      async () => {
        const chat = await seedChat(testDb.db, userId)
        const fileId = await seedFile({ userId, storageKey: 'live.pdf' })
        const orphan = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          status: 'failed',
          title: null,
          updatedAt: LONG_AGO,
        })
        const orphanOfOtherUser = await seedDocumentWithSpec(
          testDb.db,
          storage,
          { userId: otherUserId, status: 'failed', updatedAt: LONG_AGO },
        )
        const recent = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          status: 'failed',
          updatedAt: new Date('2026-11-11T11:00:00.000Z'),
        })
        const withChat = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          status: 'failed',
          originChatId: chat.id,
          updatedAt: TWO_DAYS_AGO,
        })
        const withFile = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          status: 'failed',
          fileId,
          updatedAt: LONG_AGO,
        })
        const waiting = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          status: 'spec_ready',
          updatedAt: TWO_DAYS_AGO,
        })
        const result = await sweepOrphanedDocuments(
          testDb.db,
          mocks.logger,
          { now: NOW },
        )

        expect(result).toMatchObject({
          rowsFound: 2,
          rowsDeleted: 2,
          specObjectsDeleted: 2,
        })
        expect(await readDocument(testDb.db, orphan.id)).toBeUndefined()
        expect(await readDocument(testDb.db, orphanOfOtherUser.id))
          .toBeUndefined()
        expect(storage.objects.has(orphan.specR2Key!)).toBe(false)

        for (const kept of [recent, withChat, withFile, waiting]) {
          expect(await readDocument(testDb.db, kept.id)).toBeDefined()
          expect(storage.objects.has(kept.specR2Key!)).toBe(true)
        }
      })

    it('keeps the rows for the next run when the spec delete fails',
      async () => {
        const orphan = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          status: 'failed',
          updatedAt: LONG_AGO,
        })

        storage.delete.mockRejectedValueOnce(new Error('R2 down'))
        storage.delete.mockRejectedValueOnce(new Error('R2 down'))

        const result = await sweepOrphanedDocuments(
          testDb.db,
          mocks.logger,
          { now: NOW },
        )

        expect(result).toMatchObject({
          rowsDeleted: 0,
          rowsDetached: 0,
          specDeleteFailed: true,
        })
        expect(await readDocument(testDb.db, orphan.id)).toBeDefined()
        await expect(sweepOrphanedDocuments(
          testDb.db,
          mocks.logger,
          { now: NOW },
        )).resolves.toMatchObject({ rowsDeleted: 1 })
        expect(await readDocument(testDb.db, orphan.id)).toBeUndefined()
      })

    it('expires specs of rows that never rendered after seven days',
      async () => {
        const chat = await seedChat(testDb.db, userId)
        const fileId = await seedFile({ userId, storageKey: 'live.pdf' })
        const waiting = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          status: 'spec_ready',
          originChatId: chat.id,
          title: TITLE,
          updatedAt: TEN_DAYS_AGO,
        })
        const failed = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          status: 'failed',
          errorCode: 'render_failed',
          originChatId: chat.id,
          title: TITLE,
          updatedAt: TEN_DAYS_AGO,
        })
        const young = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          status: 'spec_ready',
          originChatId: chat.id,
          title: TITLE,
          updatedAt: new Date('2026-11-05T12:00:00.000Z'),
        })
        const rendering = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          status: 'rendering',
          originChatId: chat.id,
          updatedAt: TEN_DAYS_AGO,
        })
        const withFile = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          status: 'ready',
          originChatId: chat.id,
          fileId,
          updatedAt: TEN_DAYS_AGO,
        })
        const result = await sweepOrphanedDocuments(
          testDb.db,
          mocks.logger,
          { now: NOW },
        )

        expect(result).toMatchObject({
          rowsFound: 2,
          rowsDetached: 2,
          rowsDeleted: 0,
          specObjectsDeleted: 2,
        })

        for (const expired of [waiting, failed]) {
          expect(await readDocument(testDb.db, expired.id)).toMatchObject({
            status: 'failed',
            errorCode: 'spec_expired',
            title: null,
            specR2Key: null,
            specBytes: null,
            originChatId: chat.id,
          })
          expect(storage.objects.has(expired.specR2Key!)).toBe(false)
        }

        for (const kept of [young, rendering, withFile]) {
          expect(storage.objects.has(kept.specR2Key!)).toBe(true)
        }

        expect(await readDocument(testDb.db, young.id)).toMatchObject({
          status: 'spec_ready',
          title: TITLE,
        })
        expect(loggedText()).not.toContain(TITLE)
        expect(mocks.logger.set).toHaveBeenCalledWith({
          attributes: {
            documents: {
              cleanup: {
                expire: {
                  rowsFound: 2,
                  rowsDeleted: 0,
                  rowsDetached: 2,
                  specObjectsDeleted: 2,
                  specDeleteFailed: false,
                },
              },
            },
          },
        })
      })

    it('does not expire a row twice and keeps expired rows readable',
      async () => {
        const chat = await seedChat(testDb.db, userId)
        const waiting = await seedDocumentWithSpec(testDb.db, storage, {
          userId,
          status: 'spec_ready',
          originChatId: chat.id,
          updatedAt: TEN_DAYS_AGO,
        })

        await sweepOrphanedDocuments(testDb.db, mocks.logger, { now: NOW })

        const second = await sweepOrphanedDocuments(
          testDb.db,
          mocks.logger,
          { now: new Date('2026-11-30T12:00:00.000Z') },
        )

        expect(second.rowsFound).toBe(0)
        expect(await readDocument(testDb.db, waiting.id)).toMatchObject({
          errorCode: 'spec_expired',
          originChatId: chat.id,
        })
      })

    it('keeps the row of an expiry whose spec delete fails', async () => {
      const chat = await seedChat(testDb.db, userId)
      const waiting = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        status: 'spec_ready',
        originChatId: chat.id,
        updatedAt: TEN_DAYS_AGO,
      })

      storage.delete.mockRejectedValueOnce(new Error('R2 down'))

      const result = await sweepOrphanedDocuments(
        testDb.db,
        mocks.logger,
        { now: NOW },
      )

      expect(result).toMatchObject({ rowsDetached: 0, specDeleteFailed: true })
      expect(await readDocument(testDb.db, waiting.id)).toMatchObject({
        status: 'spec_ready',
        specR2Key: waiting.specR2Key,
      })
      expect(storage.objects.has(waiting.specR2Key!)).toBe(true)
    })

    it('repairs a row whose files row no longer exists', async () => {
      const chat = await seedChat(testDb.db, userId)
      const fileId = await seedFile({ userId, storageKey: 'live.pdf' })
      const dangling = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        status: 'ready',
        originChatId: chat.id,
        fileId: DANGLING_FILE_ID,
        title: TITLE,
      })
      const live = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        status: 'ready',
        originChatId: chat.id,
        fileId,
        title: TITLE,
      })
      const result = await sweepOrphanedDocuments(
        testDb.db,
        mocks.logger,
        { now: NOW },
      )

      expect(result).toMatchObject({ rowsFound: 1, rowsDetached: 1 })
      expect(await readDocument(testDb.db, dangling.id)).toMatchObject({
        status: 'failed',
        errorCode: 'file_deleted',
        title: null,
        fileId: null,
        specR2Key: null,
        specBytes: null,
        originChatId: chat.id,
      })
      expect(storage.objects.has(dangling.specR2Key!)).toBe(false)
      expect(await readDocument(testDb.db, live.id)).toMatchObject({
        status: 'ready',
        fileId,
        title: TITLE,
      })
      expect(storage.objects.has(live.specR2Key!)).toBe(true)
    })

    it('does not repair another user\'s file reference', async () => {
      const foreignFileId = await seedFile({
        userId: otherUserId,
        storageKey: 'foreign.pdf',
      })
      const document = await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        status: 'ready',
        fileId: foreignFileId,
      })

      await sweepOrphanedDocuments(testDb.db, mocks.logger, { now: NOW })

      expect(await readDocument(testDb.db, document.id)).toMatchObject({
        status: 'failed',
        errorCode: 'file_deleted',
        fileId: null,
      })
    })

    it('writes counts to the wide event and never a title', async () => {
      await seedDocumentWithSpec(testDb.db, storage, {
        userId,
        status: 'failed',
        title: TITLE,
        updatedAt: LONG_AGO,
      })
      await sweepOrphanedDocuments(testDb.db, mocks.logger, { now: NOW })

      expect(mocks.logger.set).toHaveBeenCalledWith({
        attributes: {
          documents: {
            cleanup: {
              sweep: {
                rowsFound: 1,
                rowsDeleted: 1,
                rowsDetached: 0,
                specObjectsDeleted: 1,
                specDeleteFailed: false,
              },
            },
          },
        },
      })
      expect(loggedText()).not.toContain(TITLE)
    })
  })
})
