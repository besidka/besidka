import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  minutesBefore,
  seedChat,
  seedMessage,
  seedUser,
  textPart,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { seedDocument } from '../../setup/helpers/documents-db'

const SHARE_SLUG = '01JSHAREDDOCUMENTSSLUG001'

const mocks = vi.hoisted(() => ({
  logger: { set: vi.fn() },
  createFileAccessToken: vi.fn(),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

vi.mock('~~/server/utils/files/file-share-access', () => ({
  createFileAccessToken: mocks.createFileAccessToken,
}))

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/shared/[slug]/index.get'
  )

  return module.default as (event: unknown) => Promise<any>
}

function documentPart(documentId: string, title: string) {
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

describe('shared chat documents API', () => {
  let testDb: MemoryExtractionTestDb
  let ownerId: number

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createFileAccessToken.mockResolvedValue('token-abc')
    testDb = createMemoryExtractionTestDb()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useEvent', () => ({ context: {} }))
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  async function seedSharedChat(
    share: Partial<typeof schema.chatShares.$inferInsert> = {},
  ) {
    ownerId = await seedUser(testDb.db, null)

    const chat = await seedChat(testDb.db, ownerId)
    const otherChat = await seedChat(testDb.db, ownerId)
    const [file] = await testDb.db.insert(schema.files).values({
      userId: ownerId,
      storageKey: 'report-key',
      name: 'Quarterly report.pdf',
      size: 4321,
      type: 'application/pdf',
      source: 'assistant',
    }).returning()
    const [otherFile] = await testDb.db.insert(schema.files).values({
      userId: ownerId,
      storageKey: 'other-key',
      name: 'Other.pdf',
      size: 10,
      type: 'application/pdf',
      source: 'assistant',
    }).returning()
    const ready = await seedDocument(testDb.db, {
      userId: ownerId,
      originChatId: chat.id,
      status: 'ready',
      fileId: file!.id,
      title: 'Quarterly report',
      specR2Key: 'documents/1/spec-secret/spec.v1.json',
    })
    const ungranted = await seedDocument(testDb.db, {
      userId: ownerId,
      originChatId: chat.id,
      status: 'ready',
      fileId: otherFile!.id,
      title: 'Ungranted report',
    })
    const branched = await seedDocument(testDb.db, {
      userId: ownerId,
      originChatId: otherChat.id,
      status: 'ready',
      fileId: file!.id,
      title: 'Branched report',
    })

    await seedMessage(
      testDb.db,
      chat.id,
      'user',
      [textPart('Write a report')],
      minutesBefore(30),
    )
    await seedMessage(
      testDb.db,
      chat.id,
      'assistant',
      [
        textPart('Here it is'),
        documentPart(ready.id, 'Quarterly report'),
        documentPart(ungranted.id, 'Ungranted report'),
        documentPart(branched.id, 'Branched report'),
        {
          type: 'tool-create_document',
          toolCallId: 'call-1',
          state: 'output-error',
          input: { format: 'pdf' },
          errorText: 'The document could not be created.',
        },
      ],
      minutesBefore(29),
    )

    const [chatShare] = await testDb.db.insert(schema.chatShares).values({
      chatId: chat.id,
      slug: SHARE_SLUG,
      ...share,
    }).returning()

    await testDb.db.insert(schema.chatShareFiles).values({
      chatShareId: chatShare!.id,
      fileId: file!.id,
    })

    return {
      chat,
      ready,
      ungranted,
      branched,
      file: file!,
      chatShare: chatShare!,
    }
  }

  async function readShare() {
    const handler = await getHandler()

    return await handler({
      context: {},
      params: { slug: SHARE_SLUG },
    })
  }

  function assistantDocumentParts(response: any) {
    const assistant = response.messages.find((message: any) => {
      return message.role === 'assistant'
    })

    return assistant.parts.filter((part: any) => {
      return part.type === 'data-document'
    })
  }

  it('gives a granted document a tokenized file and the others a title only', async () => {
    const { ready, ungranted, branched, file, chatShare }
      = await seedSharedChat({ showFiles: true })
    const response = await readShare()
    const parts = assistantDocumentParts(response)

    expect(parts).toEqual([
      {
        type: 'data-document',
        data: {
          documentId: null,
          format: 'pdf',
          title: 'Quarterly report',
          specVersion: 1,
          status: 'ready',
          file: {
            url: '/files/report-key?token=token-abc',
            name: 'Quarterly report.pdf',
            size: 4321,
            type: 'application/pdf',
          },
        },
      },
      {
        type: 'data-document',
        data: {
          documentId: null,
          format: 'pdf',
          title: 'Ungranted report',
          specVersion: 1,
          status: 'spec_ready',
        },
      },
      {
        type: 'data-document',
        data: {
          documentId: null,
          format: 'pdf',
          title: 'Branched report',
          specVersion: 1,
          status: 'spec_ready',
        },
      },
    ])
    expect(mocks.createFileAccessToken).toHaveBeenCalledWith(
      { shareId: chatShare.id, fileId: file.id, expiresInSeconds: 3600 },
      expect.anything(),
    )

    const serialized = JSON.stringify(response)

    expect(serialized).not.toContain(ready.id)
    expect(serialized).not.toContain(ungranted.id)
    expect(serialized).not.toContain(branched.id)
    expect(serialized).not.toContain('spec-secret')
    expect(serialized).not.toContain('tool-create_document')
  })

  it('shows every document as a title-only card when showFiles is false', async () => {
    await seedSharedChat({ showFiles: false })

    const response = await readShare()
    const parts = assistantDocumentParts(response)

    expect(parts).toHaveLength(3)

    for (const part of parts) {
      expect(part.data.documentId).toBeNull()
      expect(part.data.file).toBeUndefined()
      expect(part.data.status).toBe('spec_ready')
    }

    expect(mocks.createFileAccessToken).not.toHaveBeenCalled()
  })
})
