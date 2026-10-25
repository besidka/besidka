import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPersistedEmptyAnswerFailureText } from '#shared/utils/chat-failure-text'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import {
  READ_CHAT_CONTINUATION_PREFIX,
  READ_CHAT_MAX_CHARS,
  READ_CHAT_MESSAGE_MAX_CHARS,
  READ_CHAT_NEIGHBOR_MESSAGES,
  SEARCH_CHATS_TITLE_MAX_LENGTH,
} from '~~/server/utils/memory/tools/constants'
import {
  readChat,
  selectReadChatWindow,
} from '~~/server/utils/memory/tools/read-chat'
import { createSearchIndexTestDb } from '../../../../setup/helpers/search-index-db'

describe('readChat', () => {
  let testDb: ReturnType<typeof createSearchIndexTestDb>
  let nextMessageId = 1

  function seedChat(input: {
    id: number
    userId: number
    title?: string
    projectId?: number
  }): void {
    testDb.insertChat({
      id: input.id,
      userId: input.userId,
      slug: `slug-${input.id}`,
      title: input.title ?? `Chat ${input.id}`,
      projectId: input.projectId,
    })
  }

  function seedMessage(input: {
    chatId: number
    text?: string
    parts?: unknown[]
    role?: string
  }): string {
    const id = nextMessageId
    const publicId = `01MESSAGE${String(id).padStart(17, '0')}`

    nextMessageId += 1
    testDb.insertMessage({
      id,
      chatId: input.chatId,
      publicId,
      role: input.role ?? 'user',
      createdAt: 1_700_000_000 + id,
      parts: input.parts ?? [{ type: 'text', text: input.text ?? '' }],
    })

    return publicId
  }

  function read(input: {
    chatId?: string
    aroundMessageId?: string
    userId?: number
    currentChatId?: number
    projectId?: number
  }) {
    return readChat({
      db: testDb.db,
      userId: input.userId ?? 1,
      chatId: input.chatId ?? 'slug-1',
      aroundMessageId: input.aroundMessageId,
      currentChatId: encodePublicId(input.currentChatId ?? 9999),
      projectId: input.projectId === undefined
        ? undefined
        : encodePublicId(input.projectId),
    })
  }

  beforeEach(() => {
    nextMessageId = 1
    testDb = createSearchIndexTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  it('returns the chat header and wrapped messages', async () => {
    seedChat({ id: 1, userId: 1, title: 'Soup recipes' })
    const firstId = seedMessage({ chatId: 1, text: 'How do I cook borscht?' })

    seedMessage({ chatId: 1, text: 'Use beetroot.', role: 'assistant' })

    const result = await read({})

    expect(result.chat).toEqual({
      chatId: 'slug-1',
      title: 'Soup recipes',
      url: '/chats/slug-1',
    })
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]).toEqual({
      messageId: firstId,
      role: 'user',
      date: '2023-11-14T22:13:21.000Z',
      text: '<chat_excerpt>How do I cook borscht?</chat_excerpt>',
    })
    expect(result.messages[1]!.role).toBe('assistant')
    expect(result.truncated).toBe(false)
    expect(result.nextAroundMessageId).toBeUndefined()
  })

  it('rejects another user\'s chat with the same 404 as a missing chat', async () => {
    seedChat({ id: 1, userId: 2 })
    seedMessage({ chatId: 1, text: 'private' })

    const foreign = await read({ chatId: 'slug-1', userId: 1 })
      .catch(exception => exception)
    const missing = await read({ chatId: 'slug-404', userId: 1 })
      .catch(exception => exception)

    expect(foreign).toBeInstanceOf(Error)
    expect(foreign.status).toBe(404)
    expect(foreign.message).toBe('Chat not found.')
    expect(missing.status).toBe(foreign.status)
    expect(missing.message).toBe(foreign.message)
    expect(missing.why).toBe(foreign.why)
    expect(missing.fix).toBe(foreign.fix)
  })

  it('rejects a chat outside the project scope with the same 404', async () => {
    seedChat({ id: 1, userId: 1, projectId: 7 })
    seedChat({ id: 2, userId: 1 })
    seedMessage({ chatId: 1, text: 'in project' })
    seedMessage({ chatId: 2, text: 'outside project' })

    await expect(read({ chatId: 'slug-1', projectId: 8 }))
      .rejects.toMatchObject({ status: 404, message: 'Chat not found.' })
    await expect(read({ chatId: 'slug-2', projectId: 7 }))
      .rejects.toMatchObject({ status: 404, message: 'Chat not found.' })

    const inProject = await read({ chatId: 'slug-1', projectId: 7 })

    expect(inProject.messages).toHaveLength(1)
  })

  it('reads any of the user\'s chats when no project scope is given', async () => {
    seedChat({ id: 1, userId: 1, projectId: 7 })
    seedMessage({ chatId: 1, text: 'in project' })

    const result = await read({ chatId: 'slug-1' })

    expect(result.messages).toHaveLength(1)
  })

  it('rejects the current chat with a distinct message', async () => {
    seedChat({ id: 1, userId: 1 })
    seedMessage({ chatId: 1, text: 'already in context' })

    const exception = await read({ chatId: 'slug-1', currentChatId: 1 })
      .catch(caught => caught)

    expect(exception.status).toBe(404)
    expect(exception.message).not.toBe('Chat not found.')
    expect(exception.message).toContain('current chat')
  })

  it('does not resolve an aroundMessageId that belongs to another chat', async () => {
    seedChat({ id: 1, userId: 1 })
    seedChat({ id: 2, userId: 1 })
    seedMessage({ chatId: 1, text: 'first of chat one' })
    seedMessage({ chatId: 1, text: 'second of chat one' })
    const foreignId = seedMessage({ chatId: 2, text: 'only in chat two' })

    const result = await read({ chatId: 'slug-1', aroundMessageId: foreignId })

    expect(result.messages.map(message => message.messageId))
      .not.toContain(foreignId)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]!.text).toContain('first of chat one')
  })

  it('does not resolve an aroundMessageId of another user\'s chat', async () => {
    seedChat({ id: 1, userId: 1 })
    seedChat({ id: 2, userId: 2 })
    seedMessage({ chatId: 1, text: 'mine' })
    const foreignId = seedMessage({ chatId: 2, text: 'theirs' })

    const result = await read({ chatId: 'slug-1', aroundMessageId: foreignId })

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]!.text).toContain('mine')
  })

  it('centers the window on the anchor and bounds the neighbors', async () => {
    seedChat({ id: 1, userId: 1 })

    const messageIds = Array.from({ length: 40 }, (_unused, index) => {
      return seedMessage({ chatId: 1, text: `message ${index}` })
    })
    const anchorId = messageIds[20]!

    const result = await read({ aroundMessageId: anchorId })
    const returnedIds = result.messages.map(message => message.messageId)

    expect(returnedIds).toContain(anchorId)
    expect(returnedIds[0]).toBe(
      messageIds[20 - READ_CHAT_NEIGHBOR_MESSAGES],
    )
    expect(returnedIds.at(-1)).toBe(
      messageIds[20 + READ_CHAT_NEIGHBOR_MESSAGES],
    )
    expect(result.truncated).toBe(true)
    expect(result.nextAroundMessageId).toBe(
      `${READ_CHAT_CONTINUATION_PREFIX}${messageIds[20 + READ_CHAT_NEIGHBOR_MESSAGES + 1]}`,
    )
  })

  it('reports no truncation when the anchor window covers the whole chat', async () => {
    seedChat({ id: 1, userId: 1 })

    const messageIds = Array.from({ length: 5 }, (_unused, index) => {
      return seedMessage({ chatId: 1, text: `message ${index}` })
    })

    const result = await read({ aroundMessageId: messageIds[2] })

    expect(result.messages).toHaveLength(5)
    expect(result.truncated).toBe(false)
    expect(result.nextAroundMessageId).toBeUndefined()
  })

  it('flags truncation when only earlier messages exist beyond the window', async () => {
    seedChat({ id: 1, userId: 1 })

    const messageIds = Array.from({ length: 30 }, (_unused, index) => {
      return seedMessage({ chatId: 1, text: `message ${index}` })
    })

    const result = await read({ aroundMessageId: messageIds[29] })

    expect(result.messages.at(-1)!.messageId).toBe(messageIds[29])
    expect(result.truncated).toBe(true)
    expect(result.nextAroundMessageId).toBeUndefined()
  })

  it('keeps the total length within the character budget', async () => {
    seedChat({ id: 1, userId: 1 })

    const messageIds = Array.from({ length: 30 }, (_unused, index) => {
      return seedMessage({
        chatId: 1,
        text: `${index} `.concat('x'.repeat(1900)),
      })
    })
    const anchorId = messageIds[15]!

    const result = await read({ aroundMessageId: anchorId })
    const totalChars = result.messages.reduce((sum, message) => {
      return sum + message.text.length
    }, 0)

    expect(totalChars).toBeLessThanOrEqual(READ_CHAT_MAX_CHARS)
    expect(result.messages.map(message => message.messageId))
      .toContain(anchorId)
    expect(result.truncated).toBe(true)
    const lastReturnedIndex = messageIds.indexOf(
      result.messages.at(-1)!.messageId!,
    )

    expect(result.nextAroundMessageId).toBe(
      `${READ_CHAT_CONTINUATION_PREFIX}${messageIds[lastReturnedIndex + 1]}`,
    )
  })

  it('walks a chat of near-cap messages with the cursor without repeats', async () => {
    seedChat({ id: 1, userId: 1 })

    const messageIds = Array.from({ length: 12 }, (_unused, index) => {
      return seedMessage({
        chatId: 1,
        text: `${index} `.concat('x'.repeat(READ_CHAT_MESSAGE_MAX_CHARS)),
      })
    })
    const visitedIds: string[] = []
    let cursor: string | undefined
    let callCount = 0

    do {
      const result = await read({ aroundMessageId: cursor })
      const returnedIds = result.messages.map(message => message.messageId!)

      expect(returnedIds.length).toBeGreaterThan(0)
      expect(returnedIds.some(id => visitedIds.includes(id))).toBe(false)

      visitedIds.push(...returnedIds)
      cursor = result.nextAroundMessageId
      callCount += 1
    } while (cursor && callCount < 20)

    expect(visitedIds).toEqual(messageIds)
    expect(callCount).toBeLessThanOrEqual(messageIds.length)
  })

  it('starts the continuation window at the cursor message and flags earlier messages', async () => {
    seedChat({ id: 1, userId: 1 })

    const messageIds = Array.from({ length: 6 }, (_unused, index) => {
      return seedMessage({ chatId: 1, text: `message ${index}` })
    })

    const result = await read({
      aroundMessageId: `${READ_CHAT_CONTINUATION_PREFIX}${messageIds[3]}`,
    })

    expect(result.messages.map(message => message.messageId))
      .toEqual(messageIds.slice(3))
    expect(result.truncated).toBe(true)
    expect(result.nextAroundMessageId).toBeUndefined()
  })

  it('skips a legacy message without a publicId when choosing the cursor', async () => {
    seedChat({ id: 1, userId: 1 })

    const longText = 'z'.repeat(READ_CHAT_MESSAGE_MAX_CHARS)
    const firstId = seedMessage({ chatId: 1, text: longText })
    const secondId = seedMessage({ chatId: 1, text: longText })

    testDb.insertMessage({
      id: nextMessageId,
      chatId: 1,
      role: 'user',
      createdAt: 1_700_000_000 + nextMessageId,
      parts: [{ type: 'text', text: longText }],
    })
    nextMessageId += 1

    const fourthId = seedMessage({ chatId: 1, text: longText })

    const firstResult = await read({})

    expect(firstResult.messages.map(message => message.messageId))
      .toEqual([firstId, secondId])
    expect(firstResult.nextAroundMessageId)
      .toBe(`${READ_CHAT_CONTINUATION_PREFIX}${fourthId}`)

    const secondResult = await read({
      aroundMessageId: firstResult.nextAroundMessageId,
    })

    expect(secondResult.messages.map(message => message.messageId))
      .toEqual([fourthId])
    expect(secondResult.nextAroundMessageId).toBeUndefined()
  })

  it('omits the cursor when no later message has a publicId', async () => {
    seedChat({ id: 1, userId: 1 })

    const longText = 'z'.repeat(READ_CHAT_MESSAGE_MAX_CHARS)

    seedMessage({ chatId: 1, text: longText })
    seedMessage({ chatId: 1, text: longText })

    testDb.insertMessage({
      id: nextMessageId,
      chatId: 1,
      role: 'user',
      createdAt: 1_700_000_000 + nextMessageId,
      parts: [{ type: 'text', text: longText }],
    })

    const result = await read({})

    expect(result.messages).toHaveLength(2)
    expect(result.truncated).toBe(true)
    expect(result.nextAroundMessageId).toBeUndefined()
  })

  it('does not cut a surrogate pair at the message cap', async () => {
    seedChat({ id: 1, userId: 1 })
    seedMessage({
      chatId: 1,
      text: `${'a'.repeat(READ_CHAT_MESSAGE_MAX_CHARS - 1)}😀tail`,
    })

    const result = await read({})
    const text = result.messages[0]!.text

    expect(text.isWellFormed()).toBe(true)
    expect(text).toBe(
      `<chat_excerpt>${'a'.repeat(READ_CHAT_MESSAGE_MAX_CHARS - 1)}…</chat_excerpt>`,
    )
  })

  it('does not cut a surrogate pair at the title cap', async () => {
    seedChat({
      id: 1,
      userId: 1,
      title: `${'t'.repeat(SEARCH_CHATS_TITLE_MAX_LENGTH - 1)}😀tail`,
    })
    seedMessage({ chatId: 1, text: 'hello' })

    const result = await read({})

    expect(result.chat.title.isWellFormed()).toBe(true)
    expect(result.chat.title)
      .toBe('t'.repeat(SEARCH_CHATS_TITLE_MAX_LENGTH - 1))
  })

  it('falls back to the untitled label for an empty title', async () => {
    seedChat({ id: 1, userId: 1, title: '   ' })
    seedMessage({ chatId: 1, text: 'hello' })

    const result = await read({})

    expect(result.chat.title).toBe('Untitled chat')
  })

  it('caps a single message and marks the cut', async () => {
    seedChat({ id: 1, userId: 1 })
    seedMessage({ chatId: 1, text: 'y'.repeat(READ_CHAT_MESSAGE_MAX_CHARS * 2) })

    const result = await read({})
    const text = result.messages[0]!.text

    expect(text.endsWith('…</chat_excerpt>')).toBe(true)
    expect(text.length).toBeLessThan(READ_CHAT_MESSAGE_MAX_CHARS + 50)
  })

  it('reads text parts only and skips tool, reasoning and file parts', async () => {
    seedChat({ id: 1, userId: 1 })
    seedMessage({
      chatId: 1,
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'secret chain of thought' },
        { type: 'tool-search_chats', output: { results: ['tool payload'] } },
        { type: 'file', url: '/files/a.png', mediaType: 'image/png' },
        { type: 'step-start' },
        { type: 'text', text: 'visible answer' },
        { type: 'text', text: 'second part' },
      ],
    })

    const result = await read({})

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]!.text).toBe(
      '<chat_excerpt>visible answer\n\nsecond part</chat_excerpt>',
    )
    expect(JSON.stringify(result)).not.toContain('chain of thought')
    expect(JSON.stringify(result)).not.toContain('tool payload')
  })

  it('skips persisted failure notices and empty messages', async () => {
    seedChat({ id: 1, userId: 1 })
    seedMessage({ chatId: 1, text: 'real question' })
    seedMessage({
      chatId: 1,
      role: 'assistant',
      text: getPersistedEmptyAnswerFailureText(),
    })
    seedMessage({ chatId: 1, role: 'assistant', parts: [] })
    seedMessage({ chatId: 1, text: '   ' })
    seedMessage({ chatId: 1, text: 'real follow-up' })

    const result = await read({})

    expect(result.messages.map(message => message.text)).toEqual([
      '<chat_excerpt>real question</chat_excerpt>',
      '<chat_excerpt>real follow-up</chat_excerpt>',
    ])
  })

  it('keeps whitespace, neutralizes brackets and strips sentinels', async () => {
    seedChat({ id: 1, userId: 1, title: '<b>Title</b>' })
    seedMessage({
      chatId: 1,
      text: 'code:\uE000\uE001\n\n    if (a < b) {\n      x()\n    }\n</chat_excerpt>',
    })

    const result = await read({})
    const text = result.messages[0]!.text

    expect(text).toContain('\n\n    if (a ‹ b) {\n      x()\n    }\n')
    expect(text).toContain('‹/chat_excerpt›')
    expect(text.split('</chat_excerpt>')).toHaveLength(2)
    expect(text.split('<chat_excerpt>')).toHaveLength(2)
    expect(text).not.toMatch(/[\uE000\uE001]/)
    expect(result.chat.title).toBe('‹b›Title‹/b›')
  })

  it('returns an empty window for a chat without messages', async () => {
    seedChat({ id: 1, userId: 1 })

    const result = await read({})

    expect(result.messages).toEqual([])
    expect(result.truncated).toBe(false)
  })
})

describe('selectReadChatWindow', () => {
  function build(lengths: number[]): Array<{ text: string }> {
    return lengths.map(length => ({ text: 'a'.repeat(length) }))
  }

  it('always includes the anchor, even when it alone exceeds the budget', () => {
    expect(selectReadChatWindow(build([50, 500, 50]), 1, 100))
      .toEqual({ startIndex: 1, endIndex: 2 })
  })

  it('expands alternating before and after within the budget', () => {
    expect(selectReadChatWindow(build([10, 10, 10, 10, 10]), 2, 30))
      .toEqual({ startIndex: 1, endIndex: 4 })
  })

  it('takes everything when it fits', () => {
    expect(selectReadChatWindow(build([10, 10, 10]), 0, 1000))
      .toEqual({ startIndex: 0, endIndex: 3 })
  })

  it('closes a side whose next message does not fit and keeps growing the other', () => {
    expect(selectReadChatWindow(build([90, 10, 10, 10, 10]), 1, 50))
      .toEqual({ startIndex: 1, endIndex: 5 })
  })

  it('stays contiguous and never exceeds the budget beyond the anchor', () => {
    const messages = build([30, 30, 30, 30, 30, 30])
    const { startIndex, endIndex } = selectReadChatWindow(messages, 3, 100)
    const total = messages.slice(startIndex, endIndex)
      .reduce((sum, message) => sum + message.text.length, 0)

    expect(startIndex).toBeLessThanOrEqual(3)
    expect(endIndex).toBeGreaterThan(3)
    expect(total).toBeLessThanOrEqual(100)
  })

  it('clamps an out-of-range anchor and handles an empty list', () => {
    expect(selectReadChatWindow(build([10, 10]), 99, 1000))
      .toEqual({ startIndex: 0, endIndex: 2 })
    expect(selectReadChatWindow([], 0, 100))
      .toEqual({ startIndex: 0, endIndex: 0 })
  })
})

describe('readChat logging', () => {
  it('reports the returned window to the logger', async () => {
    const testDb = createSearchIndexTestDb()
    const logger = { set: vi.fn() }

    testDb.insertChat({ id: 1, userId: 1, slug: 'slug-1', title: 'T' })
    testDb.insertMessage({
      id: 1,
      chatId: 1,
      publicId: '01MSG',
      role: 'user',
      createdAt: 1_700_000_000,
      parts: [{ type: 'text', text: 'hello' }],
    })

    await readChat({
      db: testDb.db,
      userId: 1,
      chatId: 'slug-1',
      currentChatId: encodePublicId(9999),
      logger,
    })

    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        chatSearch: {
          stage: 'read-chat',
          messages: 1,
          truncated: false,
        },
      },
    })

    testDb.close()
  })
})
