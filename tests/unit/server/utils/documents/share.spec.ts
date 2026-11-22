import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedMessage,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import { seedDocument } from '../../../../setup/helpers/documents-db'

const mocks = vi.hoisted(() => ({
  createFileAccessToken: vi.fn(),
  loggerSet: vi.fn(),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/files/file-share-access', () => ({
  createFileAccessToken: mocks.createFileAccessToken,
}))

vi.mock('evlog', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('evlog')

  return {
    ...actual,
    useLogger: () => ({ set: mocks.loggerSet }),
  }
})

const { dropDocumentParts, resolveSharedDocumentParts } = await import(
  '~~/server/utils/documents/share'
)
const { enumerateChatFileIds } = await import('~~/server/utils/chats/share')
const { listChatDocumentFileIds } = await import(
  '~~/server/utils/documents/chat-files'
)

const SPEC_R2_KEY = 'documents/1/pub-1/spec.v1.json'

type TestMessage = {
  id: string
  role: string
  parts: UIMessage['parts']
}

function documentPart(documentId: string, title = 'Quarterly report') {
  return {
    type: 'data-document',
    data: {
      documentId,
      format: 'pdf',
      title,
      specVersion: 1,
      status: 'spec_ready',
    },
  }
}

function toMessages(...parts: unknown[]): TestMessage[] {
  return [{
    id: 'assistant-1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Here you go.' }, ...parts],
  }] as unknown as TestMessage[]
}

describe('shared documents', () => {
  let testDb: MemoryExtractionTestDb
  let ownerId: number
  let chatId: string
  let otherChatId: string
  let shareId: string

  async function seedFile(storageKey: string, userId = ownerId) {
    const [file] = await testDb.db.insert(schema.files).values({
      userId,
      storageKey,
      name: `${storageKey}.pdf`,
      size: 1234,
      type: 'application/pdf',
      source: 'assistant',
    }).returning()

    return file!
  }

  async function grantFile(fileId: string) {
    await testDb.db.insert(schema.chatShareFiles).values({
      chatShareId: shareId,
      fileId,
    })
  }

  async function seedReadyDocument(
    fileId: string | null,
    values: Partial<typeof schema.documents.$inferInsert> = {},
  ) {
    return await seedDocument(testDb.db, {
      userId: ownerId,
      originChatId: chatId,
      status: 'ready',
      fileId,
      ...values,
    })
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.createFileAccessToken.mockResolvedValue('token-abc')
    testDb = createMemoryExtractionTestDb()
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useEvent', () => ({ context: {} }))
    ownerId = await seedUser(testDb.db, null)
    chatId = (await seedChat(testDb.db, ownerId)).id
    otherChatId = (await seedChat(testDb.db, ownerId)).id

    const [share] = await testDb.db.insert(schema.chatShares).values({
      chatId,
    }).returning()

    shareId = share!.id
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('resolveSharedDocumentParts', () => {
    it('returns the messages unchanged when there is no document part', async () => {
      const messages = toMessages()
      const result = await resolveSharedDocumentParts(messages, {
        shareId,
        chatId,
        showFiles: true,
      })

      expect(result).toBe(messages)
      expect(mocks.createFileAccessToken).not.toHaveBeenCalled()
    })

    it('shows a title-only card when the share hides files', async () => {
      const file = await seedFile('hidden-key')
      const document = await seedReadyDocument(file.id)

      await grantFile(file.id)

      const [message] = await resolveSharedDocumentParts(
        toMessages(documentPart(document.id)),
        { shareId, chatId, showFiles: false },
      )

      expect(message?.parts[1]).toEqual({
        type: 'data-document',
        data: {
          documentId: null,
          format: 'pdf',
          title: 'Quarterly report',
          specVersion: 1,
          status: 'spec_ready',
        },
      })
      expect(mocks.createFileAccessToken).not.toHaveBeenCalled()
    })

    it('gives a granted file a tokenized download part without ids', async () => {
      const file = await seedFile('granted-key')
      const document = await seedReadyDocument(file.id, {
        specR2Key: SPEC_R2_KEY,
      })

      await grantFile(file.id)

      const [message] = await resolveSharedDocumentParts(
        toMessages(documentPart(document.id)),
        { shareId, chatId, showFiles: true },
      )

      expect(mocks.createFileAccessToken).toHaveBeenCalledWith(
        { shareId, fileId: file.id, expiresInSeconds: 3600 },
        expect.anything(),
      )
      expect(message?.parts[1]).toEqual({
        type: 'data-document',
        data: {
          documentId: null,
          format: 'pdf',
          title: 'Quarterly report',
          specVersion: 1,
          status: 'ready',
          file: {
            url: '/files/granted-key?token=token-abc',
            name: 'granted-key.pdf',
            size: 1234,
            type: 'application/pdf',
          },
        },
      })

      const serialized = JSON.stringify(message)

      expect(serialized).not.toContain(document.id)
      expect(serialized).not.toContain(file.id)
      expect(serialized).not.toContain(SPEC_R2_KEY)
      expect(serialized).not.toContain('spec.v1')
    })

    it('reuses one token when two documents point at the same file', async () => {
      const file = await seedFile('shared-key')
      const first = await seedReadyDocument(file.id)
      const second = await seedReadyDocument(file.id)

      await grantFile(file.id)

      await resolveSharedDocumentParts(
        toMessages(documentPart(first.id), documentPart(second.id)),
        { shareId, chatId, showFiles: true },
      )

      expect(mocks.createFileAccessToken).toHaveBeenCalledTimes(1)
    })

    it('keeps a document of another chat title-only', async () => {
      const file = await seedFile('branched-key')
      const document = await seedReadyDocument(file.id, {
        originChatId: otherChatId,
      })

      await grantFile(file.id)

      const [message] = await resolveSharedDocumentParts(
        toMessages(documentPart(document.id)),
        { shareId, chatId, showFiles: true },
      )

      expect(message?.parts[1]).toEqual({
        type: 'data-document',
        data: {
          documentId: null,
          format: 'pdf',
          title: 'Quarterly report',
          specVersion: 1,
          status: 'spec_ready',
        },
      })
      expect(mocks.createFileAccessToken).not.toHaveBeenCalled()
    })

    it('keeps a document title-only when its file is not granted', async () => {
      const file = await seedFile('ungranted-key')
      const document = await seedReadyDocument(file.id)

      const [message] = await resolveSharedDocumentParts(
        toMessages(documentPart(document.id)),
        { shareId, chatId, showFiles: true },
      )

      expect((message?.parts[1] as any).data.documentId).toBeNull()
      expect((message?.parts[1] as any).data.file).toBeUndefined()
      expect(mocks.createFileAccessToken).not.toHaveBeenCalled()
    })

    it('keeps a document title-only when it is not ready or has no file', async () => {
      const file = await seedFile('pending-key')
      const rendering = await seedReadyDocument(file.id, {
        status: 'rendering',
      })
      const noFile = await seedReadyDocument(null)

      await grantFile(file.id)

      const [message] = await resolveSharedDocumentParts(
        toMessages(
          documentPart(rendering.id),
          documentPart(noFile.id),
          documentPart('pub-9999'),
        ),
        { shareId, chatId, showFiles: true },
      )

      for (const part of message!.parts.slice(1)) {
        expect((part as any).data.documentId).toBeNull()
        expect((part as any).data.file).toBeUndefined()
      }

      expect(mocks.createFileAccessToken).not.toHaveBeenCalled()
    })

    it('does not grant a file that belongs to another user', async () => {
      const strangerId = await seedUser(testDb.db, null)
      const file = await seedFile('stranger-key', strangerId)
      const document = await seedReadyDocument(file.id)

      await grantFile(file.id)

      const [message] = await resolveSharedDocumentParts(
        toMessages(documentPart(document.id)),
        { shareId, chatId, showFiles: true },
      )

      expect((message?.parts[1] as any).data.file).toBeUndefined()
    })

    it('leaves non-document parts untouched and keeps part order', async () => {
      const file = await seedFile('order-key')
      const document = await seedReadyDocument(file.id)

      await grantFile(file.id)

      const [message] = await resolveSharedDocumentParts(
        [{
          id: 'assistant-1',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'before' },
            documentPart(document.id),
            { type: 'text', text: 'after' },
          ],
        }] as unknown as TestMessage[],
        { shareId, chatId, showFiles: true },
      )

      expect(message?.parts.map(part => part.type)).toEqual([
        'text',
        'data-document',
        'text',
      ])
      expect(message?.parts[0]).toEqual({ type: 'text', text: 'before' })
      expect(message?.parts[2]).toEqual({ type: 'text', text: 'after' })
    })

    it('resolves more documents than one query chunk holds', async () => {
      const documentCount = 95
      const parts: unknown[] = []

      for (let index = 0; index < documentCount; index += 1) {
        const file = await seedFile(`bulk-key-${index}`)
        const document = await seedReadyDocument(file.id)

        await grantFile(file.id)
        parts.push(documentPart(document.id, `Report ${index}`))
      }

      const [message] = await resolveSharedDocumentParts(
        toMessages(...parts),
        { shareId, chatId, showFiles: true },
      )
      const documentParts = message!.parts.slice(1) as any[]

      expect(documentParts).toHaveLength(documentCount)
      expect(documentParts.every(part => part.data.status === 'ready'))
        .toBe(true)
      expect(documentParts.every(part => part.data.documentId === null))
        .toBe(true)
    })
  })

  describe('dropDocumentParts', () => {
    it('removes data-document parts and keeps everything else', () => {
      const messages = toMessages(
        documentPart('doc-1'),
        { type: 'file', url: '/files/a', mediaType: 'image/png' },
      )
      const result = dropDocumentParts(messages)

      expect(result[0]?.parts.map(part => part.type)).toEqual([
        'text',
        'file',
      ])
      expect(messages[0]?.parts).toHaveLength(3)
    })
  })

  describe('listChatDocumentFileIds', () => {
    it('lists only ready documents of the chat for the owner', async () => {
      const readyFile = await seedFile('ready-key')
      const renderingFile = await seedFile('rendering-key')
      const otherChatFile = await seedFile('other-chat-key')

      await seedReadyDocument(readyFile.id)
      await seedReadyDocument(renderingFile.id, { status: 'rendering' })
      await seedReadyDocument(otherChatFile.id, { originChatId: otherChatId })
      await seedReadyDocument(null)

      expect(await listChatDocumentFileIds(chatId, ownerId)).toEqual([
        { fileId: readyFile.id, storageKey: 'ready-key' },
      ])
    })

    it('ignores a document whose file belongs to another user', async () => {
      const strangerId = await seedUser(testDb.db, null)
      const strangerFile = await seedFile('stranger-key', strangerId)

      await seedReadyDocument(strangerFile.id)

      expect(await listChatDocumentFileIds(chatId, ownerId)).toEqual([])
    })

    it('ignores the documents of another owner', async () => {
      const strangerId = await seedUser(testDb.db, null)
      const file = await seedFile('mine-key')

      await seedReadyDocument(file.id)

      expect(await listChatDocumentFileIds(chatId, strangerId)).toEqual([])
    })
  })

  describe('enumerateChatFileIds', () => {
    it('includes the file of a ready document of the chat', async () => {
      const documentFile = await seedFile('document-key')

      await seedReadyDocument(documentFile.id)

      expect(await enumerateChatFileIds(chatId, ownerId)).toEqual([
        { fileId: documentFile.id, storageKey: 'document-key' },
      ])
    })

    it('lists a file once when a message part also references it', async () => {
      const documentFile = await seedFile('both-key')
      const attachedFile = await seedFile('attached-key')

      await seedReadyDocument(documentFile.id)
      await seedMessage(
        testDb.db,
        chatId,
        'assistant',
        [
          { type: 'file', url: '/files/both-key', mediaType: 'application/pdf' },
          {
            type: 'file',
            url: '/files/attached-key',
            mediaType: 'application/pdf',
          },
        ],
        new Date('2026-10-25T10:00:00.000Z'),
      )

      const references = await enumerateChatFileIds(chatId, ownerId)

      expect(references).toHaveLength(2)
      expect(references).toEqual(expect.arrayContaining([
        { fileId: documentFile.id, storageKey: 'both-key' },
        { fileId: attachedFile.id, storageKey: 'attached-key' },
      ]))
    })

    it('skips documents that are not ready or belong to another chat', async () => {
      const failedFile = await seedFile('failed-key')
      const otherChatFile = await seedFile('other-key')

      await seedReadyDocument(failedFile.id, { status: 'failed' })
      await seedReadyDocument(otherChatFile.id, { originChatId: otherChatId })

      expect(await enumerateChatFileIds(chatId, ownerId)).toEqual([])
    })
  })
})
