import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSearchIndexTestDb } from '../../../setup/helpers/search-index-db'

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

async function importIndexWriter() {
  return import('../../../../server/utils/search/index-writer')
}

describe('indexMessagesForSearch / removeChatsFromSearchIndex', () => {
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

  it('chunks writes into statements of SEARCH_INDEX_ROWS_PER_STATEMENT', async () => {
    const { indexMessagesForSearch, SEARCH_INDEX_ROWS_PER_STATEMENT } = (
      await importIndexWriter()
    )
    const runSpy = vi.spyOn(testDb.db, 'run')
    const messages = Array.from({ length: 25 }, (_, index) => {
      return {
        id: `pub-${index + 1}`,
        parts: [{ type: 'text', text: `message ${index + 1}` }],
      }
    })

    const result = await indexMessagesForSearch({
      db: testDb.db,
      userId: 1,
      messages,
    })

    expect(result).toEqual({ indexedCount: 25, failedCount: 0 })
    expect(runSpy).toHaveBeenCalledTimes(
      Math.ceil(25 / SEARCH_INDEX_ROWS_PER_STATEMENT),
    )

    const rows = testDb.sqlite.prepare(
      'select count(*) as count from message_search',
    ).get() as { count: number }

    expect(rows.count).toBe(25)
  })

  it('replaces an existing rowid without creating a duplicate', async () => {
    const { indexMessagesForSearch } = await importIndexWriter()

    await indexMessagesForSearch({
      db: testDb.db,
      userId: 1,
      messages: [
        { id: 'pub-1', parts: [{ type: 'text', text: 'first version' }] },
      ],
    })
    await indexMessagesForSearch({
      db: testDb.db,
      userId: 1,
      messages: [
        { id: 'pub-1', parts: [{ type: 'text', text: 'second version' }] },
      ],
    })

    const rows = testDb.sqlite.prepare(
      'select rowid, body from message_search',
    ).all() as Array<{ rowid: number, body: string }>

    expect(rows).toEqual([{ rowid: 1, body: 'second version' }])

    expect(() => {
      testDb.sqlite.exec(
        'insert into message_search(message_search) values(\'integrity-check\')',
      )
    }).not.toThrow()
  })

  it('still writes a row for an empty-text message', async () => {
    const { indexMessagesForSearch } = await importIndexWriter()

    await indexMessagesForSearch({
      db: testDb.db,
      userId: 1,
      messages: [{ id: 'pub-1', parts: [] }],
    })

    const row = testDb.sqlite.prepare(
      'select rowid, body from message_search where rowid = 1',
    ).get() as { rowid: number, body: string }

    expect(row).toEqual({ rowid: 1, body: '' })
  })

  it('never throws when db.run fails, and reports failedCount', async () => {
    const { indexMessagesForSearch } = await importIndexWriter()
    const logger = { set: vi.fn() }

    vi.spyOn(testDb.db, 'run').mockRejectedValue(new Error('boom'))

    const result = await indexMessagesForSearch({
      db: testDb.db,
      userId: 1,
      messages: [{ id: 'pub-1', parts: [] }],
      logger,
    })

    expect(result.failedCount).toBe(1)
    expect(result.indexedCount).toBe(0)
    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      messageSearchIndex: expect.objectContaining({
        action: 'insert-failed',
      }),
    }))
  })

  it('never throws when decodePublicId throws on a malformed id', async () => {
    const { indexMessagesForSearch } = await importIndexWriter()
    const logger = { set: vi.fn() }

    mocks.decodePublicId.mockImplementation(() => {
      throw new Error('invalid alphabet character')
    })

    const result = await indexMessagesForSearch({
      db: testDb.db,
      userId: 1,
      messages: [{ id: 'not-a-hashid', parts: [] }],
      logger,
    })

    expect(result).toEqual({ indexedCount: 0, failedCount: 0 })
    expect(logger.set).not.toHaveBeenCalled()
  })

  it('removeChatsFromSearchIndex deletes only the target user\'s rows', async () => {
    const { indexMessagesForSearch, removeChatsFromSearchIndex } = (
      await importIndexWriter()
    )

    testDb.insertChat({ id: 1, userId: 1 })
    testDb.insertChat({ id: 2, userId: 2 })
    testDb.insertMessage({ id: 1, chatId: 1 })
    testDb.insertMessage({ id: 2, chatId: 2 })

    await indexMessagesForSearch({
      db: testDb.db,
      userId: 1,
      messages: [{ id: 'pub-1', parts: [{ type: 'text', text: 'user 1' }] }],
    })
    await indexMessagesForSearch({
      db: testDb.db,
      userId: 2,
      messages: [{ id: 'pub-2', parts: [{ type: 'text', text: 'user 2' }] }],
    })

    const result = await removeChatsFromSearchIndex({
      db: testDb.db,
      userId: 1,
      chatIds: ['pub-1'],
    })

    expect(result).toEqual({ deletedCount: 1, failed: false })

    const remaining = testDb.sqlite.prepare(
      'select rowid from message_search',
    ).all() as Array<{ rowid: number }>

    expect(remaining).toEqual([{ rowid: 2 }])
  })
})
