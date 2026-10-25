import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import {
  MEMORY_DETACH_STATEMENTS_PER_BATCH,
  detachChatsFromMemory,
} from '~~/server/utils/memory/chat-deletion'
import {
  createMemoryTestDb,
  type MemoryTestDb,
} from '../../../setup/helpers/memory-db'

interface StoredEntry {
  id: number
  source_chat_ids: string
  updated_at: number
}

describe('detachChatsFromMemory', () => {
  let testDb: MemoryTestDb
  let batchSizes: number[]
  let db: MemoryTestDb['db']

  function chatId(id: number): string {
    return encodePublicId(id)
  }

  function readEntry(id: number): StoredEntry | undefined {
    return testDb.sqlite
      .prepare(
        'select id, source_chat_ids, updated_at from memory_entries'
        + ' where id = ?',
      )
      .get(id) as StoredEntry | undefined
  }

  function readSources(id: number): string[] | undefined {
    const entry = readEntry(id)

    return entry ? JSON.parse(entry.source_chat_ids) : undefined
  }

  beforeEach(() => {
    testDb = createMemoryTestDb()
    batchSizes = []
    db = Object.assign(Object.create(testDb.db), {
      batch: async (statements: PromiseLike<unknown>[]) => {
        batchSizes.push(statements.length)

        const results: unknown[] = []

        for (const statement of statements) {
          results.push(await statement)
        }

        return results
      },
    })
  })

  afterEach(() => {
    testDb.close()
  })

  it('deletes an extraction entry whose only source is the deleted chat', async () => {
    testDb.insertEntry({
      id: 1,
      userId: 1,
      slug: 'garden',
      origin: 'extraction',
      sourceChatIds: [chatId(10)],
    })

    const result = await detachChatsFromMemory({
      db,
      userId: 1,
      chatIds: [chatId(10)],
    })

    expect(result).toEqual({ deleted: 1, detached: 0 })
    expect(readEntry(1)).toBeUndefined()
  })

  it('keeps an extraction entry that has another source and drops the id', async () => {
    testDb.insertEntry({
      id: 1,
      userId: 1,
      slug: 'garden',
      origin: 'extraction',
      sourceChatIds: [chatId(10), chatId(11)],
    })

    const result = await detachChatsFromMemory({
      db,
      userId: 1,
      chatIds: [chatId(10)],
    })

    expect(result).toEqual({ deleted: 0, detached: 1 })
    expect(readSources(1)).toEqual([chatId(11)])
  })

  it('deletes an extraction entry when all of its sources are deleted', async () => {
    testDb.insertEntry({
      id: 1,
      userId: 1,
      slug: 'garden',
      origin: 'extraction',
      sourceChatIds: [chatId(10), chatId(11)],
    })

    const result = await detachChatsFromMemory({
      db,
      userId: 1,
      chatIds: [chatId(11), chatId(10)],
    })

    expect(result).toEqual({ deleted: 1, detached: 0 })
    expect(readEntry(1)).toBeUndefined()
  })

  it.each(['user', 'tool', 'import'])(
    'never deletes a %s entry and leaves an empty source list',
    async (origin) => {
      testDb.insertEntry({
        id: 1,
        userId: 1,
        slug: 'garden',
        origin,
        sourceChatIds: [chatId(10)],
      })

      const result = await detachChatsFromMemory({
        db,
        userId: 1,
        chatIds: [chatId(10)],
      })

      expect(result).toEqual({ deleted: 0, detached: 1 })
      expect(readSources(1)).toEqual([])
    },
  )

  it('never deletes an extraction entry that already had no sources', async () => {
    testDb.insertEntry({
      id: 1,
      userId: 1,
      slug: 'garden',
      origin: 'extraction',
      sourceChatIds: [],
    })

    const result = await detachChatsFromMemory({
      db,
      userId: 1,
      chatIds: [chatId(10)],
    })

    expect(result).toEqual({ deleted: 0, detached: 0 })
    expect(readSources(1)).toEqual([])
  })

  it('leaves untouched entries unchanged', async () => {
    testDb.insertEntry({
      id: 1,
      userId: 1,
      slug: 'garden',
      origin: 'extraction',
      sourceChatIds: [chatId(20)],
    })
    testDb.insertEntry({
      id: 2,
      userId: 1,
      slug: 'cooking',
      origin: 'user',
      sourceChatIds: [chatId(21), chatId(22)],
    })

    const result = await detachChatsFromMemory({
      db,
      userId: 1,
      chatIds: [chatId(10)],
    })

    expect(result).toEqual({ deleted: 0, detached: 0 })
    expect(readSources(1)).toEqual([chatId(20)])
    expect(readSources(2)).toEqual([chatId(21), chatId(22)])
    expect(batchSizes).toEqual([])
  })

  it('preserves updatedAt when it drops the id', async () => {
    testDb.insertEntry({
      id: 1,
      userId: 1,
      slug: 'garden',
      origin: 'user',
      sourceChatIds: [chatId(10), chatId(11)],
      updatedAt: 1_700_000_000,
    })
    testDb.insertEntry({
      id: 2,
      userId: 1,
      slug: 'cooking',
      origin: 'tool',
      sourceChatIds: [chatId(10)],
      updatedAt: 1_650_000_000,
    })

    await detachChatsFromMemory({
      db,
      userId: 1,
      chatIds: [chatId(10)],
    })

    expect(readEntry(1)?.updated_at).toBe(1_700_000_000)
    expect(readEntry(2)?.updated_at).toBe(1_650_000_000)
  })

  it('does not touch another user entry that cites the same chat id', async () => {
    testDb.insertEntry({
      id: 1,
      userId: 1,
      slug: 'garden',
      origin: 'extraction',
      sourceChatIds: [chatId(10)],
    })
    testDb.insertEntry({
      id: 2,
      userId: 2,
      slug: 'garden',
      origin: 'extraction',
      sourceChatIds: [chatId(10)],
    })
    testDb.insertEntry({
      id: 3,
      userId: 2,
      slug: 'cooking',
      origin: 'user',
      sourceChatIds: [chatId(10), chatId(11)],
    })

    const result = await detachChatsFromMemory({
      db,
      userId: 1,
      chatIds: [chatId(10)],
    })

    expect(result).toEqual({ deleted: 1, detached: 0 })
    expect(readEntry(1)).toBeUndefined()
    expect(readSources(2)).toEqual([chatId(10)])
    expect(readSources(3)).toEqual([chatId(10), chatId(11)])
  })

  it('covers project-scoped entries as well', async () => {
    testDb.insertProject({ id: 5, userId: 1 })
    testDb.insertEntry({
      id: 1,
      userId: 1,
      projectId: 5,
      slug: 'stack',
      origin: 'extraction',
      sourceChatIds: [chatId(10)],
    })

    const result = await detachChatsFromMemory({
      db,
      userId: 1,
      chatIds: [chatId(10)],
    })

    expect(result).toEqual({ deleted: 1, detached: 0 })
    expect(testDb.countEntries(1)).toBe(0)
  })

  it('handles 100+ chat ids and many entries in chunked batches', async () => {
    const deletedIds = Array.from({ length: 120 }, (_value, index) => {
      return chatId(1000 + index)
    })
    const keptChatId = chatId(5)
    const entryCount = 130

    for (let index = 1; index <= entryCount; index++) {
      const isDetachedOnly = index % 2 === 0

      testDb.insertEntry({
        id: index,
        userId: 1,
        slug: `entry-${index}`,
        origin: isDetachedOnly ? 'user' : 'extraction',
        sourceChatIds: isDetachedOnly
          ? [deletedIds[index % 120]!, keptChatId]
          : [deletedIds[index % 120]!, deletedIds[(index + 1) % 120]!],
      })
    }

    const result = await detachChatsFromMemory({
      db,
      userId: 1,
      chatIds: deletedIds,
    })

    expect(result).toEqual({ deleted: 65, detached: 65 })
    expect(testDb.countEntries(1)).toBe(65)
    expect(readSources(2)).toEqual([keptChatId])
    expect(readEntry(1)).toBeUndefined()
    expect(batchSizes.length).toBeGreaterThan(1)
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(
      MEMORY_DETACH_STATEMENTS_PER_BATCH,
    )
  })

  it('does not query the database when there are no chat ids', async () => {
    const select = vi.spyOn(db, 'select')

    const result = await detachChatsFromMemory({
      db,
      userId: 1,
      chatIds: [],
    })

    expect(result).toEqual({ deleted: 0, detached: 0 })
    expect(select).not.toHaveBeenCalled()
  })

  it('logs counts only', async () => {
    const logger = { set: vi.fn() }

    testDb.insertEntry({
      id: 1,
      userId: 1,
      slug: 'garden',
      origin: 'extraction',
      sourceChatIds: [chatId(10)],
    })

    await detachChatsFromMemory({
      db,
      userId: 1,
      chatIds: [chatId(10)],
      logger,
    })

    expect(logger.set).toHaveBeenCalledWith({
      attributes: { memoryChatDeletion: { deleted: 1, detached: 0 } },
    })
  })

  it('propagates a batch failure', async () => {
    testDb.insertEntry({
      id: 1,
      userId: 1,
      slug: 'garden',
      origin: 'extraction',
      sourceChatIds: [chatId(10)],
    })

    const failingDb = Object.assign(Object.create(testDb.db), {
      batch: async () => {
        throw new Error('D1 batch failed')
      },
    })

    await expect(detachChatsFromMemory({
      db: failingDb,
      userId: 1,
      chatIds: [chatId(10)],
    })).rejects.toThrow('D1 batch failed')
  })
})
