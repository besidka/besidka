import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildChatSharedColumn,
  durationToExpiresAt,
  enumerateChatFileIds,
  getActiveShareForChat,
  resolveActiveShareBySlug,
  syncChatShareFiles,
} from '../../../server/utils/chats/share'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  chatSharesFindFirst: vi.fn(),
  messagesFindMany: vi.fn(),
  getOwnedFilesByStorageKeys: vi.fn(),
  insertValues: vi.fn(),
  insertOnConflictDoNothing: vi.fn(),
  dbBatch: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('~~/server/utils/files/file-governance', async () => {
  const actual = await vi.importActual<any>(
    '~~/server/utils/files/file-governance',
  )

  return {
    ...actual,
    getOwnedFilesByStorageKeys: mocks.getOwnedFilesByStorageKeys,
  }
})

function createDb(overrides: Record<string, unknown> = {}) {
  return {
    query: {
      chatShares: {
        findFirst: mocks.chatSharesFindFirst,
      },
      messages: {
        findMany: mocks.messagesFindMany,
      },
    },
    insert: vi.fn(() => {
      return {
        values: mocks.insertValues.mockReturnValue({
          onConflictDoNothing: mocks.insertOnConflictDoNothing,
        }),
      }
    }),
    batch: mocks.dbBatch,
    ...overrides,
  }
}

describe('durationToExpiresAt', () => {
  const now = new Date('2026-07-05T12:00:00.000Z')

  it('offsets by 7 days for week', () => {
    expect(durationToExpiresAt('week', now)).toEqual(
      new Date('2026-07-12T12:00:00.000Z'),
    )
  })

  it('offsets by 30 days for month', () => {
    expect(durationToExpiresAt('month', now)).toEqual(
      new Date('2026-08-04T12:00:00.000Z'),
    )
  })

  it('offsets by 365 days for year', () => {
    expect(durationToExpiresAt('year', now)).toEqual(
      new Date('2027-07-05T12:00:00.000Z'),
    )
  })

  it('returns null for forever', () => {
    expect(durationToExpiresAt('forever', now)).toBeNull()
  })
})

describe('buildChatSharedColumn', () => {
  it('returns a boolean-mapped SQL expression', () => {
    const now = new Date('2026-07-05T12:00:00.000Z')
    const column = buildChatSharedColumn(now)

    expect(column).toBeDefined()
    expect(typeof column.getSQL).toBe('function')
    expect(typeof column.mapWith).toBe('function')
  })
})

describe('resolveActiveShareBySlug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the active share row when found', async () => {
    mocks.chatSharesFindFirst.mockResolvedValue({
      id: 'share-1',
      slug: 'abc123',
      chatId: 'chat-1',
      revoked: false,
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
    })

    const db = createDb()
    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useEvent', () => ({}))

    const share = await resolveActiveShareBySlug('abc123')

    expect(mocks.chatSharesFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slug: 'abc123',
          revoked: false,
        }),
      }),
    )
    expect(share?.id).toBe('share-1')
  })

  it('returns null when no active share matches', async () => {
    mocks.chatSharesFindFirst.mockResolvedValue(undefined)

    const db = createDb()
    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useEvent', () => ({}))

    const share = await resolveActiveShareBySlug('missing-slug')

    expect(share).toBeNull()
  })
})

describe('getActiveShareForChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the active share row for the chat', async () => {
    mocks.chatSharesFindFirst.mockResolvedValue({
      id: 'share-1',
      slug: 'abc123',
      chatId: 'chat-1',
      revoked: false,
      expiresAt: null,
      indexable: true,
      showFiles: true,
      showMetadata: true,
    })

    const db = createDb()
    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useEvent', () => ({}))

    const share = await getActiveShareForChat('chat-1')

    expect(mocks.chatSharesFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          chatId: 'chat-1',
          revoked: false,
        }),
      }),
    )
    expect(share?.chatId).toBe('chat-1')
  })

  it('returns null when the chat has no active share', async () => {
    mocks.chatSharesFindFirst.mockResolvedValue(undefined)

    const db = createDb()
    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useEvent', () => ({}))

    const share = await getActiveShareForChat('chat-1')

    expect(share).toBeNull()
  })
})

describe('enumerateChatFileIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('useEvent', () => ({}))
  })

  it('resolves owned files referenced by file parts, skipping data urls', async () => {
    mocks.messagesFindMany.mockResolvedValue([
      {
        parts: [
          { type: 'text', text: 'hello' },
          { type: 'file', url: '/files/owned-key.png' },
          { type: 'file', url: 'data:image/png;base64,aaaa' },
          { type: 'file', url: '/files/foreign-key.png' },
        ],
      },
    ])
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([
      ['owned-key.png', {
        id: 'file-1',
        storageKey: 'owned-key.png',
        size: 10,
      }],
    ]))

    const db = createDb()
    vi.stubGlobal('useDb', () => db)

    const references = await enumerateChatFileIds('chat-1', 42)

    expect(mocks.getOwnedFilesByStorageKeys).toHaveBeenCalledWith(
      42,
      ['owned-key.png', 'foreign-key.png'],
    )
    expect(references).toEqual([
      { fileId: 'file-1', storageKey: 'owned-key.png' },
    ])
  })

  it('returns an empty array when the chat has no file parts', async () => {
    mocks.messagesFindMany.mockResolvedValue([
      { parts: [{ type: 'text', text: 'hello' }] },
    ])
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map())

    const db = createDb()
    vi.stubGlobal('useDb', () => db)

    const references = await enumerateChatFileIds('chat-1', 42)

    expect(mocks.getOwnedFilesByStorageKeys).toHaveBeenCalledWith(42, [])
    expect(references).toEqual([])
  })
})

describe('syncChatShareFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('useEvent', () => ({}))
  })

  it('inserts a chat_share_files row per resolved file via db.batch', async () => {
    mocks.messagesFindMany.mockResolvedValue([
      {
        parts: [
          { type: 'file', url: '/files/first.png' },
          { type: 'file', url: '/files/second.png' },
        ],
      },
    ])
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([
      ['first.png', { id: 'file-1', storageKey: 'first.png', size: 1 }],
      ['second.png', { id: 'file-2', storageKey: 'second.png', size: 2 }],
    ]))
    mocks.dbBatch.mockResolvedValue(undefined)

    const db = createDb()
    vi.stubGlobal('useDb', () => db)

    await syncChatShareFiles('share-1', 'chat-1', 42)

    expect(mocks.insertValues).toHaveBeenCalledWith({
      chatShareId: 'share-1',
      fileId: 'file-1',
    })
    expect(mocks.insertValues).toHaveBeenCalledWith({
      chatShareId: 'share-1',
      fileId: 'file-2',
    })
    expect(mocks.dbBatch).toHaveBeenCalledTimes(1)
    expect(mocks.dbBatch.mock.calls[0]?.[0]).toHaveLength(2)
  })

  it('skips the batch call entirely when the chat has no files', async () => {
    mocks.messagesFindMany.mockResolvedValue([
      { parts: [{ type: 'text', text: 'hello' }] },
    ])
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map())

    const db = createDb()
    vi.stubGlobal('useDb', () => db)

    await syncChatShareFiles('share-1', 'chat-1', 42)

    expect(mocks.dbBatch).not.toHaveBeenCalled()
  })
})
