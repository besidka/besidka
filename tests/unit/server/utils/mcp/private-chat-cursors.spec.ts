import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    decodeKnowledgeEntityId: vi.fn(),
    findChatsMatchingMessageContent: vi.fn(),
    logger: { set: vi.fn() },
  }
})

vi.mock('~~/server/utils/knowledge/access', () => {
  return { decodeKnowledgeEntityId: mocks.decodeKnowledgeEntityId }
})

vi.mock('~~/server/utils/chats/history/search', () => {
  return {
    MAX_SEARCH_RESULTS: 200,
    SEARCH_CANDIDATE_MESSAGE_LIMIT: 200,
    findChatsMatchingMessageContent: mocks.findChatsMatchingMessageContent,
  }
})

const { listMcpChats } = await import('~~/server/utils/mcp/private/chats')

function createDb() {
  const query = vi.fn()
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => {
      query()

      return []
    },
  }

  return {
    query,
    db: { select: () => chain } as unknown as ReturnType<typeof useDb>,
  }
}

const VALID_CURSOR = JSON.stringify({
  activityAt: '2026-10-01T00:00:00.000Z',
  id: 'abc',
})

describe('listMcpChats cursor', () => {
  beforeEach(() => {
    mocks.decodeKnowledgeEntityId.mockReset()
    mocks.decodeKnowledgeEntityId.mockReturnValue(5)
    mocks.findChatsMatchingMessageContent.mockReset()
    mocks.findChatsMatchingMessageContent.mockResolvedValue([])
  })

  it('rejects malformed cursors with a 400 before querying', async () => {
    const malformed = [
      'not json',
      '{}',
      '{"activityAt":"nope","id":"x"}',
      '{"activityAt":"2026-10-01T00:00:00.000Z"}',
      '{"offset":3}',
    ]

    for (const cursor of malformed) {
      const { db, query } = createDb()

      await expect(listMcpChats(db, 1, { cursor }, mocks.logger))
        .rejects.toMatchObject({ status: 400 })
      expect(query).not.toHaveBeenCalled()
    }
  })

  it('rejects a cursor id the canonical decoder refuses', async () => {
    mocks.decodeKnowledgeEntityId.mockReturnValue(null)

    const { db, query } = createDb()

    await expect(listMcpChats(db, 1, { cursor: VALID_CURSOR }, mocks.logger))
      .rejects.toMatchObject({ status: 400 })
    expect(mocks.decodeKnowledgeEntityId).toHaveBeenCalledWith('abc')
    expect(query).not.toHaveBeenCalled()
  })

  it('accepts a valid cursor and no cursor', async () => {
    const withCursor = createDb()

    await expect(listMcpChats(
      withCursor.db,
      1,
      { cursor: VALID_CURSOR },
      mocks.logger,
    )).resolves.toEqual({ chats: [], nextCursor: null })
    expect(withCursor.query).toHaveBeenCalledTimes(1)

    const withoutCursor = createDb()

    await expect(listMcpChats(withoutCursor.db, 1, {}, mocks.logger))
      .resolves.toEqual({ chats: [], nextCursor: null })
  })

  it('rejects a malformed search cursor and accepts an offset cursor',
    async () => {
      const rejected = createDb()

      await expect(listMcpChats(
        rejected.db,
        1,
        { search: 'roadmap', cursor: VALID_CURSOR },
        mocks.logger,
      )).rejects.toMatchObject({ status: 400 })
      expect(mocks.findChatsMatchingMessageContent).not.toHaveBeenCalled()

      const accepted = createDb()

      await expect(listMcpChats(
        accepted.db,
        1,
        { search: 'roadmap', cursor: '{"offset":20}' },
        mocks.logger,
      )).resolves.toMatchObject({ chats: [], nextCursor: null })
    })
})
