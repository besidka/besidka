import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import {
  REPLY_STOPPED_PART_TYPE,
  createReplyStoppedPart,
} from '#shared/utils/chat-reply-stopped'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedMessage,
  seedUser,
  textPart,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => ({
  deleteChatMessage: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/chats/lifecycle', () => ({
  deleteChatMessage: mocks.deleteChatMessage,
}))

const {
  deleteStoppedReplies,
  finalizeStoppedReplyParts,
  findStoppedRepliesAfter,
  loadMessagesAfterUserMessage,
  takeTurnReplies,
} = await import('~~/server/utils/chats/stopped-replies')

const stoppedPart = createReplyStoppedPart(new Date('2026-11-20T20:38:30Z'))

describe('stopped replies', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let chatId: string

  beforeEach(async () => {
    mocks.deleteChatMessage.mockClear()
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db)
    chatId = (await seedChat(testDb.db, userId)).id
  })

  afterEach(() => {
    testDb.close()
  })

  async function seed(
    role: 'user' | 'assistant',
    publicId: string,
    parts: unknown[],
  ) {
    await seedMessage(testDb.db, chatId, role, parts, new Date(), {
      publicId,
    })
  }

  it('drops unfinished tool calls and ends with the stopped marker', () => {
    const parts = [
      { type: 'text', text: 'Half an answ', state: 'streaming' },
      { type: 'tool-web_search', toolCallId: 'a', state: 'input-available' },
      {
        type: 'dynamic-tool',
        toolName: 'mcp__linear__create_issue',
        toolCallId: 'c',
        state: 'input-streaming',
      },
      {
        type: 'tool-web_search',
        toolCallId: 'b',
        state: 'output-available',
        input: {},
        output: {},
      },
    ] as unknown as UIMessage['parts']

    const finalized = finalizeStoppedReplyParts(parts)

    expect(finalized.map(part => part.type)).toEqual([
      'text',
      'tool-web_search',
      REPLY_STOPPED_PART_TYPE,
    ])
    expect(finalized[0]).toMatchObject({ text: 'Half an answ', state: 'done' })
  })

  it('finds the stopped replies of one user message only', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [textPart('Hi')] },
      { id: 'a1', role: 'assistant', parts: [textPart('Hal'), stoppedPart] },
      { id: 'a2', role: 'assistant', parts: [textPart('Fine')] },
      { id: 'u2', role: 'user', parts: [textPart('Next')] },
      { id: 'a3', role: 'assistant', parts: [textPart('Ne'), stoppedPart] },
    ]

    expect(findStoppedRepliesAfter(messages, 0)).toEqual(['a1'])
    expect(findStoppedRepliesAfter(messages, 3)).toEqual(['a3'])
    expect(findStoppedRepliesAfter(messages, -1)).toEqual([])
  })

  it('loads what follows the user message and cuts it at the next turn',
    async () => {
      await seed('user', 'u0', [textPart('Earlier')])
      await seed('assistant', 'a0', [textPart('Old stop'), stoppedPart])
      await seed('user', 'u1', [textPart('Hi')])

      expect(await loadMessagesAfterUserMessage({
        db: testDb.db as never,
        chatId,
        userMessagePublicId: 'u1',
      })).toEqual([])

      await seed('assistant', 'a1', [textPart('Hal'), stoppedPart])
      await seed('user', 'u2', [textPart('Next')])
      await seed('assistant', 'a2', [textPart('Ne'), stoppedPart])

      const later = await loadMessagesAfterUserMessage({
        db: testDb.db as never,
        chatId,
        userMessagePublicId: 'u1',
      })

      expect(later.map(message => message.publicId))
        .toEqual(['a1', 'u2', 'a2'])
      expect(takeTurnReplies(later).map(message => message.publicId))
        .toEqual(['a1'])
    })

  it('deletes only the stopped replies it is given', async () => {
    const logger = { set: vi.fn() }
    const replies = [
      { id: '1', publicId: 'a1', role: 'assistant', parts: [stoppedPart] },
      { id: '2', publicId: 'a2', role: 'assistant', parts: [textPart('Ok')] },
    ]

    expect(await deleteStoppedReplies({
      db: testDb.db as never,
      userId,
      chatId,
      replies,
      logger,
    })).toBe(1)
    expect(mocks.deleteChatMessage).toHaveBeenCalledTimes(1)
    expect(mocks.deleteChatMessage).toHaveBeenCalledWith(
      testDb.db,
      userId,
      chatId,
      'a1',
      logger,
    )
  })

  it('logs a failed delete and goes on with the next one', async () => {
    mocks.deleteChatMessage.mockRejectedValueOnce(new Error('D1 down'))

    const logger = { set: vi.fn() }

    expect(await deleteStoppedReplies({
      db: testDb.db as never,
      userId,
      chatId,
      replies: [
        { id: '1', publicId: 'a1', role: 'assistant', parts: [stoppedPart] },
        { id: '2', publicId: 'a2', role: 'assistant', parts: [stoppedPart] },
      ],
      logger,
    })).toBe(1)
    expect(logger.set).toHaveBeenCalledWith({
      attributes: { stoppedReplies: { deleteError: 'D1 down' } },
    })
  })
})
