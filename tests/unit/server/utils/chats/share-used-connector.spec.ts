import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  minutesBefore,
  seedChat,
  seedMessage,
  seedUser,
  textPart,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const { chatUsedConnector } = await import('~~/server/utils/chats/share')

describe('chatUsedConnector', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db)
    vi.stubGlobal('useDb', () => testDb.db)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('is true when an answer called a connector tool', async () => {
    const chat = await seedChat(testDb.db, userId)

    await seedMessage(testDb.db, chat.id, 'assistant', [
      {
        type: 'dynamic-tool',
        toolName: 'mcp__linear__list_issues',
        toolCallId: 'c1',
        state: 'output-available',
        input: {},
        output: 'x',
      },
      textPart('Done'),
    ], minutesBefore(10))

    expect(await chatUsedConnector(chat.id)).toBe(true)
  })

  it('is true on a branched chat that kept only the marker', async () => {
    const chat = await seedChat(testDb.db, userId)

    await seedMessage(testDb.db, chat.id, 'assistant', [
      textPart('Done'),
      {
        type: 'data-connectors-notice',
        data: { lines: [], usedConnector: true },
      },
    ], minutesBefore(10))

    expect(await chatUsedConnector(chat.id)).toBe(true)
  })

  it('is false for a notice without the marker', async () => {
    const chat = await seedChat(testDb.db, userId)

    await seedMessage(testDb.db, chat.id, 'assistant', [
      textPart('Done'),
      { type: 'data-connectors-notice', data: { lines: ['A notice'] } },
    ], minutesBefore(10))

    expect(await chatUsedConnector(chat.id)).toBe(false)
  })

  it('is false for other tools and for a chat without tool calls', async () => {
    const chat = await seedChat(testDb.db, userId)

    await seedMessage(testDb.db, chat.id, 'assistant', [
      { type: 'tool-web_search', output: 'x' },
      {
        type: 'dynamic-tool',
        toolName: 'other_tool',
        toolCallId: 'c1',
        state: 'output-available',
        input: {},
        output: 'x',
      },
      textPart('Done'),
    ], minutesBefore(10))

    expect(await chatUsedConnector(chat.id)).toBe(false)
    expect(await chatUsedConnector((await seedChat(testDb.db, userId)).id))
      .toBe(false)
  })
})
