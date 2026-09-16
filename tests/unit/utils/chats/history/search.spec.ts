import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SNIPPET_END, SNIPPET_START } from '#shared/utils/search'
import { createSearchIndexTestDb } from '../../../../setup/helpers/search-index-db'

const mocks = vi.hoisted(() => ({
  encodePublicId: vi.fn((id: number) => `pub-${id}`),
  decodePublicId: vi.fn((publicId: string) => {
    const match = /^pub-(\d+)$/.exec(publicId)

    return match ? Number(match[1]) : Number.NaN
  }),
}))

vi.mock(
  '~~/server/utils/custom-db-types',
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('~~/server/utils/custom-db-types')
    >()

    return {
      ...actual,
      encodePublicId: mocks.encodePublicId,
      decodePublicId: mocks.decodePublicId,
    }
  },
)

async function importSearch() {
  return import('~~/server/utils/chats/history/search')
}

async function importIndexWriter() {
  return import('~~/server/utils/search/index-writer')
}

describe('findChatsMatchingMessageContent', () => {
  let testDb: ReturnType<typeof createSearchIndexTestDb>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.encodePublicId.mockImplementation((id: number) => `pub-${id}`)
    mocks.decodePublicId.mockImplementation((publicId: string) => {
      const match = /^pub-(\d+)$/.exec(publicId)

      return match ? Number(match[1]) : Number.NaN
    })
    testDb = createSearchIndexTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  it('finds a chat whose match exists only in message content', async () => {
    const { findChatsMatchingMessageContent } = await importSearch()
    const { indexMessagesForSearch } = await importIndexWriter()

    testDb.insertChat({ id: 1, userId: 1 })
    testDb.insertMessage({ id: 1, chatId: 1 })
    await indexMessagesForSearch({
      db: testDb.db,
      userId: 1,
      messages: [{
        id: 'pub-1',
        parts: [{ type: 'text', text: 'борщ з пампушками' }],
      }],
    })

    const hits = await findChatsMatchingMessageContent({
      db: testDb.db,
      userId: 1,
      search: 'борщ',
    })

    expect(hits).toHaveLength(1)
    expect(hits[0].chatId).toBe('pub-1')
  })

  it(
    'never returns another user\'s chat for an identical search phrase '
    + '(tenancy isolation, both directions)',
    async () => {
      const { findChatsMatchingMessageContent } = await importSearch()
      const { indexMessagesForSearch } = await importIndexWriter()

      testDb.insertChat({ id: 1, userId: 1 })
      testDb.insertChat({ id: 2, userId: 2 })
      testDb.insertMessage({ id: 1, chatId: 1 })
      testDb.insertMessage({ id: 2, chatId: 2 })

      await indexMessagesForSearch({
        db: testDb.db,
        userId: 1,
        messages: [{
          id: 'pub-1',
          parts: [{ type: 'text', text: 'спільна таємна фраза' }],
        }],
      })
      await indexMessagesForSearch({
        db: testDb.db,
        userId: 2,
        messages: [{
          id: 'pub-2',
          parts: [{ type: 'text', text: 'спільна таємна фраза' }],
        }],
      })

      const userOneHits = await findChatsMatchingMessageContent({
        db: testDb.db,
        userId: 1,
        search: 'спільна',
      })
      const userTwoHits = await findChatsMatchingMessageContent({
        db: testDb.db,
        userId: 2,
        search: 'спільна',
      })

      expect(userOneHits.map(hit => hit.chatId)).toEqual(['pub-1'])
      expect(userTwoHits.map(hit => hit.chatId)).toEqual(['pub-2'])
    },
  )

  it('ranks an exact-form hit ahead of a stem-only hit', async () => {
    const { findChatsMatchingMessageContent } = await importSearch()
    const { indexMessagesForSearch } = await importIndexWriter()

    testDb.insertChat({ id: 1, userId: 1 })
    testDb.insertChat({ id: 2, userId: 1 })
    testDb.insertMessage({ id: 1, chatId: 1 })
    testDb.insertMessage({ id: 2, chatId: 2 })

    await indexMessagesForSearch({
      db: testDb.db,
      userId: 1,
      messages: [{
        id: 'pub-1',
        parts: [{ type: 'text', text: 'сторінка у книзі' }],
      }],
    })
    await indexMessagesForSearch({
      db: testDb.db,
      userId: 1,
      messages: [{
        id: 'pub-2',
        parts: [{ type: 'text', text: 'нова книга на полиці' }],
      }],
    })

    const hits = await findChatsMatchingMessageContent({
      db: testDb.db,
      userId: 1,
      search: 'книзі',
    })

    expect(hits.map(hit => hit.chatId)).toEqual(['pub-1', 'pub-2'])
    expect(hits[0].score).toBeLessThan(hits[1].score)
    expect(hits[1].snippet).not.toContain(SNIPPET_START)
    expect(hits[1].snippet).not.toContain(SNIPPET_END)
  })

  it('keeps the best-scoring message per chat (per-chat dedupe)', async () => {
    const { findChatsMatchingMessageContent } = await importSearch()
    const { indexMessagesForSearch } = await importIndexWriter()

    testDb.insertChat({ id: 1, userId: 1 })
    testDb.insertMessage({ id: 1, chatId: 1 })
    testDb.insertMessage({ id: 2, chatId: 1 })

    await indexMessagesForSearch({
      db: testDb.db,
      userId: 1,
      messages: [
        {
          id: 'pub-1',
          parts: [{ type: 'text', text: 'коротка згадка книзі тут' }],
        },
        {
          id: 'pub-2',
          parts: [{
            type: 'text',
            text: 'книзі книзі книзі книзі книзі, справжня знахідка',
          }],
        },
      ],
    })

    const hits = await findChatsMatchingMessageContent({
      db: testDb.db,
      userId: 1,
      search: 'книзі',
    })

    expect(hits).toHaveLength(1)
    expect(hits[0].chatId).toBe('pub-1')
    expect(hits[0].messageRowId).toBe(2)
  })

  it('returns [] without touching the DB for an emoji-only query', async () => {
    const { findChatsMatchingMessageContent } = await importSearch()
    const allSpy = vi.spyOn(testDb.db, 'all')

    const hits = await findChatsMatchingMessageContent({
      db: testDb.db,
      userId: 1,
      search: '😀😀😀',
    })

    expect(hits).toEqual([])
    expect(allSpy).not.toHaveBeenCalled()
  })

  it('catches a thrown DB error and returns []', async () => {
    const { findChatsMatchingMessageContent } = await importSearch()

    vi.spyOn(testDb.db, 'all').mockRejectedValue(new Error('boom'))

    const logger = { set: vi.fn() }
    const hits = await findChatsMatchingMessageContent({
      db: testDb.db,
      userId: 1,
      search: 'книзі',
      logger,
    })

    expect(hits).toEqual([])
    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      messageSearchContent: expect.objectContaining({
        action: 'query-failed',
      }),
    }))
  })
})
