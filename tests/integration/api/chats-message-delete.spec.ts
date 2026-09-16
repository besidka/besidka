import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  removeMessageRowsFromSearchIndex: vi.fn(),
  findMessageOriginFiles: vi.fn(),
  cleanupFilesOrphanedByChatDeletion: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
  createError: (input: {
    status?: number
    message?: string
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/search/index-writer', () => ({
  removeMessageRowsFromSearchIndex: mocks.removeMessageRowsFromSearchIndex,
  safeDecodePublicId: (publicId: string) => {
    const match = publicId.match(/^rowid-(\d+)$/)

    return match ? Number(match[1]) : null
  },
}))

vi.mock('~~/server/utils/files/chat-deletion-cleanup', () => ({
  findMessageOriginFiles: mocks.findMessageOriginFiles,
  cleanupFilesOrphanedByChatDeletion:
    mocks.cleanupFilesOrphanedByChatDeletion,
}))

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/messages/[id].delete'
  )

  return module.default
}

const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FB0'
const MESSAGE_PUBLIC_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB1'

interface ChatFixture {
  id: string
  slug: string
  userId: number
}

interface MessageFixture {
  id: string
  publicId: string | null
  chatId: string
}

interface MessageWhere {
  chatId?: string
  id?: string
  publicId?: string
  OR?: Array<{ publicId?: string, id?: string }>
}

function messageMatchesWhere(
  message: MessageFixture,
  where: MessageWhere,
): boolean {
  if (where.chatId !== undefined && message.chatId !== where.chatId) {
    return false
  }

  if (where.id !== undefined && message.id !== where.id) {
    return false
  }

  if (where.publicId !== undefined && message.publicId !== where.publicId) {
    return false
  }

  if (!where.OR) {
    return true
  }

  return where.OR.some((condition) => {
    if (condition.publicId !== undefined) {
      return message.publicId === condition.publicId
    }

    if (condition.id !== undefined) {
      return message.id === condition.id
    }

    return false
  })
}

function createDb(
  chatFixture: ChatFixture | null,
  messageFixtures: MessageFixture[],
) {
  const chatsFindFirst = vi.fn(async (
    { where }: { where: Record<string, unknown> },
  ) => {
    if (!chatFixture) {
      return undefined
    }

    const matches = Object.entries(where).every(([key, value]) => {
      return (chatFixture as unknown as Record<string, unknown>)[key]
        === value
    })

    return matches ? { id: chatFixture.id } : undefined
  })

  const messagesFindFirst = vi.fn(async (
    { where }: { where: MessageWhere },
  ) => {
    const found = messageFixtures.find((message) => {
      return messageMatchesWhere(message, where)
    })

    return found ? { id: found.id } : undefined
  })

  const deleteWhere = vi.fn(async () => ({
    success: true,
    meta: { changes: 1 },
  }))

  const selectHaving = vi.fn(() => sql`1`)
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    groupBy: vi.fn(() => selectChain),
    having: selectHaving,
  }

  const db = {
    query: {
      chats: { findFirst: chatsFindFirst },
      messages: { findFirst: messagesFindFirst },
    },
    select: vi.fn(() => selectChain),
    delete: vi.fn(() => ({ where: deleteWhere })),
  }

  return {
    db, chatsFindFirst, messagesFindFirst, deleteWhere, selectHaving,
  }
}

describe('chat message delete API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getValidatedRouterParams', async (
      event: { params: unknown },
      parser: (params: unknown) => unknown,
    ) => {
      return parser(event.params)
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('useUnauthorizedError', vi.fn(() => {
      throw new Error('Unauthorized')
    }))

    mocks.removeMessageRowsFromSearchIndex.mockResolvedValue({
      deletedCount: 1,
      failed: false,
    })
    mocks.findMessageOriginFiles.mockResolvedValue([])
    mocks.cleanupFilesOrphanedByChatDeletion.mockResolvedValue({
      candidateCount: 0,
      stillReferencedCount: 0,
      deletedCount: 0,
      failedCount: 0,
    })
  })

  it('rejects unauthenticated requests', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    const handler = await getHandler()
    const { db, deleteWhere } = createDb(
      { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
      [{ id: 'rowid-42', publicId: MESSAGE_PUBLIC_ID, chatId: 'chat-1' }],
    )

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: CHAT_SLUG, id: MESSAGE_PUBLIC_ID },
    } as never)).rejects.toThrow('Unauthorized')
    expect(deleteWhere).not.toHaveBeenCalled()
    expect(mocks.removeMessageRowsFromSearchIndex).not.toHaveBeenCalled()
    expect(mocks.findMessageOriginFiles).not.toHaveBeenCalled()
    expect(mocks.cleanupFilesOrphanedByChatDeletion).not.toHaveBeenCalled()
  })

  it('404s when the chat belongs to another user (IDOR guard)', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '2' },
    }))

    const handler = await getHandler()
    const { db, deleteWhere } = createDb(
      { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
      [{ id: 'rowid-42', publicId: MESSAGE_PUBLIC_ID, chatId: 'chat-1' }],
    )

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: CHAT_SLUG, id: MESSAGE_PUBLIC_ID },
    } as never)).rejects.toThrow('Chat not found')
    expect(deleteWhere).not.toHaveBeenCalled()
    expect(mocks.removeMessageRowsFromSearchIndex).not.toHaveBeenCalled()
    expect(mocks.findMessageOriginFiles).not.toHaveBeenCalled()
    expect(mocks.cleanupFilesOrphanedByChatDeletion).not.toHaveBeenCalled()
  })

  it(
    '404s when the message id belongs to a different chat (IDOR guard)',
    async () => {
      const handler = await getHandler()
      const { db, deleteWhere } = createDb(
        { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
        [{ id: 'rowid-42', publicId: MESSAGE_PUBLIC_ID, chatId: 'chat-other' }],
      )

      vi.stubGlobal('useDb', () => db)

      await expect(handler({
        params: { slug: CHAT_SLUG, id: MESSAGE_PUBLIC_ID },
      } as never)).rejects.toThrow('Message not found')
      expect(deleteWhere).not.toHaveBeenCalled()
      expect(mocks.removeMessageRowsFromSearchIndex).not.toHaveBeenCalled()
      expect(mocks.findMessageOriginFiles).not.toHaveBeenCalled()
      expect(mocks.cleanupFilesOrphanedByChatDeletion).not.toHaveBeenCalled()
    },
  )

  it('404s when the message does not exist', async () => {
    const handler = await getHandler()
    const { db, deleteWhere } = createDb(
      { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
      [],
    )

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: CHAT_SLUG, id: MESSAGE_PUBLIC_ID },
    } as never)).rejects.toThrow('Message not found')
    expect(deleteWhere).not.toHaveBeenCalled()
    expect(mocks.removeMessageRowsFromSearchIndex).not.toHaveBeenCalled()
    expect(mocks.findMessageOriginFiles).not.toHaveBeenCalled()
    expect(mocks.cleanupFilesOrphanedByChatDeletion).not.toHaveBeenCalled()
  })

  it('404s when the chat does not exist', async () => {
    const handler = await getHandler()
    const { db, deleteWhere } = createDb(null, [])

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: CHAT_SLUG, id: MESSAGE_PUBLIC_ID },
    } as never)).rejects.toThrow('Chat not found')
    expect(deleteWhere).not.toHaveBeenCalled()
    expect(mocks.removeMessageRowsFromSearchIndex).not.toHaveBeenCalled()
    expect(mocks.findMessageOriginFiles).not.toHaveBeenCalled()
    expect(mocks.cleanupFilesOrphanedByChatDeletion).not.toHaveBeenCalled()
  })

  it(
    'deletes the message and cleans up the search index on success',
    async () => {
      const handler = await getHandler()
      const { db, deleteWhere, messagesFindFirst } = createDb(
        { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
        [
          { id: 'rowid-42', publicId: MESSAGE_PUBLIC_ID, chatId: 'chat-1' },
          { id: 'rowid-43', publicId: 'other-public-id', chatId: 'chat-1' },
        ],
      )

      vi.stubGlobal('useDb', () => db)

      const response = await handler({
        params: { slug: CHAT_SLUG, id: MESSAGE_PUBLIC_ID },
      } as never)

      expect(response).toEqual({ success: true })
      expect(messagesFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            chatId: 'chat-1',
            OR: [
              { publicId: MESSAGE_PUBLIC_ID },
              { id: MESSAGE_PUBLIC_ID },
            ],
          },
        }),
      )
      expect(deleteWhere).toHaveBeenCalledTimes(1)
      expect(mocks.removeMessageRowsFromSearchIndex).toHaveBeenCalledWith(
        expect.objectContaining({
          messageRowIds: [42],
        }),
      )
    },
  )

  it(
    'falls back to matching by id when publicId is null (legacy row)',
    async () => {
      const handler = await getHandler()
      const { db, deleteWhere, messagesFindFirst } = createDb(
        { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
        [
          { id: 'rowid-42', publicId: null, chatId: 'chat-1' },
          { id: 'rowid-43', publicId: null, chatId: 'chat-1' },
        ],
      )

      vi.stubGlobal('useDb', () => db)

      const response = await handler({
        params: { slug: CHAT_SLUG, id: 'rowid-42' },
      } as never)

      expect(response).toEqual({ success: true })
      expect(messagesFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            chatId: 'chat-1',
            OR: [
              { publicId: 'rowid-42' },
              { id: 'rowid-42' },
            ],
          },
        }),
      )
      expect(deleteWhere).toHaveBeenCalledTimes(1)
      expect(mocks.removeMessageRowsFromSearchIndex).toHaveBeenCalledWith(
        expect.objectContaining({
          messageRowIds: [42],
        }),
      )
    },
  )

  it(
    'is best-effort: a failed search-index cleanup does not change '
    + 'the response',
    async () => {
      mocks.removeMessageRowsFromSearchIndex.mockResolvedValue({
        deletedCount: 0,
        failed: true,
      })

      const handler = await getHandler()
      const { db } = createDb(
        { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
        [
          { id: 'rowid-42', publicId: MESSAGE_PUBLIC_ID, chatId: 'chat-1' },
          { id: 'rowid-43', publicId: 'other-public-id', chatId: 'chat-1' },
        ],
      )

      vi.stubGlobal('useDb', () => db)

      const response = await handler({
        params: { slug: CHAT_SLUG, id: MESSAGE_PUBLIC_ID },
      } as never)

      expect(response).toEqual({ success: true })
    },
  )

  it(
    'cleans up orphaned origin files when the deleted message had any',
    async () => {
      const originFiles = [{ id: 'file-1', storageKey: 'key-1' }]

      mocks.findMessageOriginFiles.mockResolvedValue(originFiles)

      const handler = await getHandler()
      const { db } = createDb(
        { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
        [
          { id: 'rowid-42', publicId: MESSAGE_PUBLIC_ID, chatId: 'chat-1' },
          { id: 'rowid-43', publicId: 'other-public-id', chatId: 'chat-1' },
        ],
      )

      vi.stubGlobal('useDb', () => db)

      const response = await handler({
        params: { slug: CHAT_SLUG, id: MESSAGE_PUBLIC_ID },
      } as never)

      expect(response).toEqual({ success: true })
      expect(mocks.cleanupFilesOrphanedByChatDeletion).toHaveBeenCalledWith(
        originFiles,
        1,
        expect.anything(),
      )
    },
  )

  it(
    'is best-effort: a failed orphaned-file cleanup does not change '
    + 'the response',
    async () => {
      mocks.findMessageOriginFiles.mockResolvedValue([
        { id: 'file-1', storageKey: 'key-1' },
      ])
      mocks.cleanupFilesOrphanedByChatDeletion.mockRejectedValue(
        new Error('storage delete failed'),
      )

      const handler = await getHandler()
      const { db } = createDb(
        { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
        [
          { id: 'rowid-42', publicId: MESSAGE_PUBLIC_ID, chatId: 'chat-1' },
          { id: 'rowid-43', publicId: 'other-public-id', chatId: 'chat-1' },
        ],
      )

      vi.stubGlobal('useDb', () => db)

      const response = await handler({
        params: { slug: CHAT_SLUG, id: MESSAGE_PUBLIC_ID },
      } as never)

      expect(response).toEqual({ success: true })
    },
  )

  it(
    'rejects deleting the only message in a chat',
    async () => {
      const handler = await getHandler()
      const { db, deleteWhere, selectHaving } = createDb(
        { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
        [{ id: 'rowid-42', publicId: MESSAGE_PUBLIC_ID, chatId: 'chat-1' }],
      )

      deleteWhere.mockResolvedValue({ success: true, meta: { changes: 0 } })

      vi.stubGlobal('useDb', () => db)

      await expect(handler({
        params: { slug: CHAT_SLUG, id: MESSAGE_PUBLIC_ID },
      } as never)).rejects.toThrow(
        'Cannot delete the only message in a chat',
      )
      expect(deleteWhere).toHaveBeenCalledTimes(1)
      expect(selectHaving).toHaveBeenCalledWith(sql`count(*) > 1`)
      expect(mocks.removeMessageRowsFromSearchIndex).not.toHaveBeenCalled()
      expect(mocks.cleanupFilesOrphanedByChatDeletion).not.toHaveBeenCalled()
    },
  )

  it(
    'deletes the message when the chat has exactly two messages '
    + '(2-message boundary)',
    async () => {
      const handler = await getHandler()
      const { db, deleteWhere, selectHaving } = createDb(
        { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
        [
          { id: 'rowid-42', publicId: MESSAGE_PUBLIC_ID, chatId: 'chat-1' },
          { id: 'rowid-43', publicId: 'other-public-id', chatId: 'chat-1' },
        ],
      )

      vi.stubGlobal('useDb', () => db)

      const response = await handler({
        params: { slug: CHAT_SLUG, id: MESSAGE_PUBLIC_ID },
      } as never)

      expect(response).toEqual({ success: true })
      expect(deleteWhere).toHaveBeenCalledTimes(1)
      expect(selectHaving).toHaveBeenCalledWith(sql`count(*) > 1`)
    },
  )
})
