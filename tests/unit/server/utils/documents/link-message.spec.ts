import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'
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
  readDocument,
  seedDocument,
} from '../../../../setup/helpers/documents-db'

const mocks = vi.hoisted(() => ({
  logger: { set: vi.fn() },
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const {
  collectMessageDocumentIds,
  linkDocumentsToMessage,
} = await import('~~/server/utils/documents/link-message')

function documentPart(documentId: string | null) {
  return {
    type: 'data-document',
    data: {
      documentId,
      format: 'pdf',
      title: 'Trip plan',
      specVersion: 1,
      status: 'spec_ready',
    },
  } as unknown as UIMessage['parts'][number]
}

describe('collectMessageDocumentIds', () => {
  it('returns each document id once and skips other parts', () => {
    const parts: UIMessage['parts'] = [
      { type: 'text', text: 'Here it is' },
      documentPart('pub-1'),
      documentPart('pub-2'),
      documentPart('pub-1'),
      documentPart(null),
    ]

    expect(collectMessageDocumentIds(parts)).toEqual(['pub-1', 'pub-2'])
  })

  it('returns nothing for a message without document parts', () => {
    expect(collectMessageDocumentIds([{ type: 'text', text: 'Hi' }]))
      .toEqual([])
  })
})

describe('linkDocumentsToMessage', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let otherUserId: number
  let messageRowId: number
  let otherMessageRowId: number

  async function seedAssistantMessage(
    chatId: string,
    publicId: string,
  ): Promise<number> {
    const [message] = await testDb.db.insert(schema.messages).values({
      chatId,
      role: 'assistant',
      parts: [],
      publicId,
    }).returning({ id: schema.messages.id })

    return Number(message!.id.slice(4))
  }

  async function seedFile(
    ownerId: number,
    storageKey: string,
    originMessageId: number | null = null,
  ): Promise<string> {
    const [file] = await testDb.db.insert(schema.files).values({
      userId: ownerId,
      storageKey,
      name: 'report.pdf',
      size: 100,
      type: 'application/pdf',
      source: 'assistant',
      originMessageId,
    }).returning({ id: schema.files.id })

    return file!.id
  }

  async function readFileOrigin(fileId: string): Promise<number | null> {
    const [file] = await testDb.db.select({
      originMessageId: schema.files.originMessageId,
    })
      .from(schema.files)
      .where(eq(schema.files.id, fileId))

    return file!.originMessageId
  }

  beforeEach(async () => {
    mocks.logger.set.mockClear()
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)

    const chat = await seedChat(testDb.db, userId)

    messageRowId = await seedAssistantMessage(chat.id, 'msg-linked')
    otherMessageRowId = await seedAssistantMessage(chat.id, 'msg-other')
  })

  afterEach(() => {
    testDb.close()
  })

  it('sets the origin message id on the owner\'s documents', async () => {
    const first = await seedDocument(testDb.db, { userId })
    const second = await seedDocument(testDb.db, { userId })
    const result = await linkDocumentsToMessage(testDb.db, {
      userId,
      messageRowId,
      documentIds: [first.id, second.id, first.id],
      logger: mocks.logger,
    })

    expect(result).toEqual({ documentsLinked: 2, filesLinked: 0 })
    expect((await readDocument(testDb.db, first.id))!.originMessageId)
      .toBe(messageRowId)
    expect((await readDocument(testDb.db, second.id))!.originMessageId)
      .toBe(messageRowId)
    expect(mocks.logger.set).toHaveBeenCalledWith({
      attributes: {
        documents: { linkedToMessage: 2, linkedFilesToMessage: 0 },
      },
    })
  })

  it('never links another user\'s document or its file', async () => {
    const fileId = await seedFile(otherUserId, 'foreign.pdf')
    const foreign = await seedDocument(testDb.db, {
      userId: otherUserId,
      status: 'ready',
      fileId,
    })
    const result = await linkDocumentsToMessage(testDb.db, {
      userId,
      messageRowId,
      documentIds: [foreign.id],
      logger: mocks.logger,
    })

    expect(result).toEqual({ documentsLinked: 0, filesLinked: 0 })
    expect((await readDocument(testDb.db, foreign.id))!.originMessageId)
      .toBeNull()
    expect(await readFileOrigin(fileId)).toBeNull()
  })

  it('does not move a document that already has an origin message',
    async () => {
      const fileId = await seedFile(userId, 'owned.pdf', otherMessageRowId)
      const linked = await seedDocument(testDb.db, {
        userId,
        status: 'ready',
        fileId,
        originMessageId: otherMessageRowId,
      })
      const result = await linkDocumentsToMessage(testDb.db, {
        userId,
        messageRowId,
        documentIds: [linked.id],
        logger: mocks.logger,
      })

      expect(result).toEqual({ documentsLinked: 0, filesLinked: 0 })
      expect((await readDocument(testDb.db, linked.id))!.originMessageId)
        .toBe(otherMessageRowId)
      expect(await readFileOrigin(fileId)).toBe(otherMessageRowId)
    })

  it('links the file of a document that was already ready', async () => {
    const fileId = await seedFile(userId, 'ready.pdf')
    const ready = await seedDocument(testDb.db, {
      userId,
      status: 'ready',
      fileId,
    })
    const result = await linkDocumentsToMessage(testDb.db, {
      userId,
      messageRowId,
      documentIds: [ready.id],
      logger: mocks.logger,
    })

    expect(result).toEqual({ documentsLinked: 1, filesLinked: 1 })
    expect(await readFileOrigin(fileId)).toBe(messageRowId)
  })

  it('keeps a file origin that is already set', async () => {
    const fileId = await seedFile(userId, 'set.pdf', otherMessageRowId)
    const ready = await seedDocument(testDb.db, {
      userId,
      status: 'ready',
      fileId,
    })
    const result = await linkDocumentsToMessage(testDb.db, {
      userId,
      messageRowId,
      documentIds: [ready.id],
      logger: mocks.logger,
    })

    expect(result).toEqual({ documentsLinked: 1, filesLinked: 0 })
    expect(await readFileOrigin(fileId)).toBe(otherMessageRowId)
  })

  it('links more documents than one statement can bind', async () => {
    const documentIds: string[] = []

    for (let index = 0; index < 100; index += 1) {
      const document = await seedDocument(testDb.db, { userId })

      documentIds.push(document.id)
    }

    const result = await linkDocumentsToMessage(testDb.db, {
      userId,
      messageRowId,
      documentIds,
      logger: mocks.logger,
    })

    expect(result.documentsLinked).toBe(100)
  })

  it('does nothing without document ids', async () => {
    const result = await linkDocumentsToMessage(testDb.db, {
      userId,
      messageRowId,
      documentIds: [],
      logger: mocks.logger,
    })

    expect(result).toEqual({ documentsLinked: 0, filesLinked: 0 })
    expect(mocks.logger.set).not.toHaveBeenCalled()
  })

  it('never throws and logs the error without a title', async () => {
    const document = await seedDocument(testDb.db, {
      userId,
      title: 'Confidential salary review',
    })
    const failingDb = new Proxy(testDb.db, {
      get(target, property, receiver) {
        if (property === 'update') {
          return () => {
            throw new Error('D1 down')
          }
        }

        return Reflect.get(target, property, receiver)
      },
    })

    await expect(linkDocumentsToMessage(failingDb, {
      userId,
      messageRowId,
      documentIds: [document.id],
      logger: mocks.logger,
    })).resolves.toEqual({ documentsLinked: 0, filesLinked: 0 })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      attributes: {
        documents: { linkMessageError: 'D1 down', requested: 1 },
      },
    })
    expect(JSON.stringify(mocks.logger.set.mock.calls))
      .not.toContain('Confidential')
  })
})
