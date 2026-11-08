import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createChatContextTestDb } from '../../../setup/helpers/chat-context-db'
import type { ChatContextTestDb } from '../../../setup/helpers/chat-context-db'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const OWNER_ID = 1
const OTHER_USER_ID = 2
const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const OTHER_CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAW'
const UNKNOWN_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAX'

const ASSISTANT_USAGE = {
  model: 'gpt-5.4',
  provider: 'openai',
  inputTokens: 100,
  outputTokens: 100,
  totalTokens: 200,
  inputCost: 0.01,
  outputCost: 0.02,
}

async function loadHandler() {
  const module = await import('~~/server/api/v1/chats/[slug]/context.get')

  return module.default as unknown as (
    event: { params: Record<string, string>, context: object },
  ) => Promise<Record<string, any>>
}

function createEvent(slug: string) {
  return { params: { slug }, context: {} }
}

function stubServerGlobals(
  testDb: ChatContextTestDb,
  session: { user: { id: string } } | null,
) {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('z', z)
  vi.stubGlobal('useDb', () => testDb.db)
  vi.stubGlobal('useUserSession', async () => session)
  vi.stubGlobal('useRequestLogger', () => ({ set: mocks.loggerSet }))
  vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
    return event.params
  })
  vi.stubGlobal('useUnauthorizedError', async () => {
    const { createError } = await import('evlog')

    throw createError({ message: 'Unauthorized', status: 401 })
  })
}

function seedOwnedChat(testDb: ChatContextTestDb) {
  testDb.insertChat({ id: 1, userId: OWNER_ID, slug: CHAT_SLUG })
  testDb.insertMessage({
    id: 1,
    chatId: 1,
    role: 'user',
    parts: [
      { type: 'text', text: 'Summarize this' },
      {
        type: 'file',
        url: '/files/key-1',
        mediaType: 'application/pdf',
        filename: 'report.pdf',
      },
    ],
  })
  testDb.insertMessage({
    id: 2,
    chatId: 1,
    role: 'assistant',
    parts: [
      {
        type: 'tool-generate_image',
        toolCallId: 'call-1',
        state: 'output-available',
        output: {
          status: 'ready',
          file: { id: 'file-1', name: 'cat.png', url: '/files/key-2' },
        },
      },
      { type: 'source-url', url: 'https://example.com/a', title: 'A' },
      {
        type: 'tool-memory_write',
        toolCallId: 'call-2',
        state: 'output-available',
        input: { title: 'Likes cats', body: 'SECRET BODY' },
      },
      { type: 'text', text: 'Done' },
    ],
    usage: ASSISTANT_USAGE,
  })
}

describe('GET /api/v1/chats/[slug]/context', () => {
  let testDb: ChatContextTestDb

  beforeEach(() => {
    vi.resetModules()
    mocks.loggerSet.mockReset()
    testDb = createChatContextTestDb()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  it('returns the context of the owner\'s chat', async () => {
    seedOwnedChat(testDb)
    stubServerGlobals(testDb, { user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()
    const response = await handler(createEvent(CHAT_SLUG))

    expect(response.chat).toMatchObject({
      slug: CHAT_SLUG,
      title: 'A chat',
      project: null,
      memoryExcluded: false,
      share: { active: false },
      models: ['gpt-5.4'],
    })
    expect(response.chat.cost.amount).toBeCloseTo(0.03)
    expect(response.chat.cost.isEstimated).toBe(false)
    expect(response.outputs.map((item: { kind: string }) => {
      return item.kind
    })).toEqual(['image'])
    expect(response.inputs.map((item: { title: string }) => {
      return item.title
    })).toEqual(['report.pdf'])
    expect(response.used.map((item: { kind: string }) => {
      return item.kind
    })).toEqual(['memory', 'web-source'])
    expect(response.counts).toEqual({ outputs: 1, inputs: 1, used: 2 })
    expect(JSON.stringify(response)).not.toContain('SECRET BODY')
  })

  it('addresses items by the public message id', async () => {
    seedOwnedChat(testDb)
    stubServerGlobals(testDb, { user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()
    const response = await handler(createEvent(CHAT_SLUG))

    expect(response.inputs[0].messageId).toBe('message-1')
    expect(response.outputs[0].messageId).toBe('message-2')
  })

  it('reports the project, the memory exclusion and an active share',
    async () => {
      testDb.insertProject({ id: 3, userId: OWNER_ID, name: 'Vaimo' })
      testDb.insertChat({
        id: 1,
        userId: OWNER_ID,
        slug: CHAT_SLUG,
        projectId: 3,
        memoryExcluded: true,
      })
      testDb.insertShare({ id: 1, chatId: 1, slug: 'share-slug' })
      stubServerGlobals(testDb, { user: { id: String(OWNER_ID) } })

      const handler = await loadHandler()
      const response = await handler(createEvent(CHAT_SLUG))

      expect(response.chat.project).toEqual({ id: 'pub-3', name: 'Vaimo' })
      expect(response.chat.memoryExcluded).toBe(true)
      expect(response.chat.share).toEqual({
        active: true,
        url: '/shared/share-slug',
        expiresAt: null,
      })
    })

  it('ignores a revoked or expired share', async () => {
    testDb.insertChat({ id: 1, userId: OWNER_ID, slug: CHAT_SLUG })
    testDb.insertShare({ id: 1, chatId: 1, slug: 'revoked', revoked: true })
    testDb.insertChat({ id: 2, userId: OWNER_ID, slug: OTHER_CHAT_SLUG })
    testDb.insertShare({
      id: 2,
      chatId: 2,
      slug: 'expired',
      expiresAtSeconds: 1_000_000_000,
    })
    stubServerGlobals(testDb, { user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()

    expect((await handler(createEvent(CHAT_SLUG))).chat.share)
      .toEqual({ active: false })
    expect((await handler(createEvent(OTHER_CHAT_SLUG))).chat.share)
      .toEqual({ active: false })
  })

  it('returns an empty context and no cost for a chat without messages',
    async () => {
      testDb.insertChat({
        id: 1,
        userId: OWNER_ID,
        slug: CHAT_SLUG,
        title: null,
      })
      stubServerGlobals(testDb, { user: { id: String(OWNER_ID) } })

      const handler = await loadHandler()
      const response = await handler(createEvent(CHAT_SLUG))

      expect(response.chat.title).toBe('')
      expect(response.chat.cost).toBeNull()
      expect(response.chat.models).toEqual([])
      expect(response.counts).toEqual({ outputs: 0, inputs: 0, used: 0 })
    })

  it('orders messages oldest first so the first sighting wins', async () => {
    testDb.insertChat({ id: 1, userId: OWNER_ID, slug: CHAT_SLUG })
    testDb.insertMessage({
      id: 1,
      chatId: 1,
      role: 'user',
      parts: [
        { type: 'file', url: '/files/key-1', mediaType: 'image/png' },
      ],
    })
    testDb.insertMessage({
      id: 2,
      chatId: 1,
      role: 'user',
      parts: [
        { type: 'file', url: '/files/key-1', mediaType: 'image/png' },
      ],
    })
    stubServerGlobals(testDb, { user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()
    const response = await handler(createEvent(CHAT_SLUG))

    expect(response.inputs).toHaveLength(1)
    expect(response.inputs[0].messageId).toBe('message-1')
  })

  it('is not truncated for a normal chat', async () => {
    seedOwnedChat(testDb)
    stubServerGlobals(testDb, { user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()
    const response = await handler(createEvent(CHAT_SLUG))

    expect(response.truncated).toBe(false)
  })

  it('reads only the newest 1000 messages and says so', async () => {
    testDb.insertChat({ id: 1, userId: OWNER_ID, slug: CHAT_SLUG })

    for (let id = 1; id <= 1001; id += 1) {
      testDb.insertMessage({
        id,
        chatId: 1,
        role: 'user',
        parts: [
          {
            type: 'file',
            url: `/files/key-${id}`,
            mediaType: 'text/plain',
            filename: `file-${id}.txt`,
          },
        ],
      })
    }

    stubServerGlobals(testDb, { user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()
    const response = await handler(createEvent(CHAT_SLUG))

    expect(response.truncated).toBe(true)
    expect(response.counts.inputs).toBe(1000)
    expect(response.inputs).toHaveLength(200)
    expect(response.inputs[0].title).toBe('file-802.txt')
  })

  it('logs the section counts', async () => {
    seedOwnedChat(testDb)
    stubServerGlobals(testDb, { user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()

    await handler(createEvent(CHAT_SLUG))

    expect(mocks.loggerSet).toHaveBeenCalledWith({
      chatContext: { outputs: 1, inputs: 1, used: 2 },
    })
  })

  it('answers 404 for another user\'s chat', async () => {
    testDb.insertChat({ id: 1, userId: OTHER_USER_ID, slug: CHAT_SLUG })
    testDb.insertMessage({
      id: 1,
      chatId: 1,
      role: 'user',
      parts: [{ type: 'text', text: 'private' }],
    })
    stubServerGlobals(testDb, { user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()

    await expect(handler(createEvent(CHAT_SLUG)))
      .rejects.toMatchObject({ status: 404, message: 'Chat not found.' })
  })

  it('answers 404 for a missing chat', async () => {
    seedOwnedChat(testDb)
    stubServerGlobals(testDb, { user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()

    await expect(handler(createEvent(UNKNOWN_SLUG)))
      .rejects.toMatchObject({ status: 404 })
  })

  it('answers 400 for a malformed slug before checking the session',
    async () => {
      stubServerGlobals(testDb, null)

      const handler = await loadHandler()

      await expect(handler(createEvent('not-a-ulid')))
        .rejects.toMatchObject({
          status: 400,
          message: 'Invalid request parameters',
        })
    })

  it('answers 401 without a session', async () => {
    seedOwnedChat(testDb)
    stubServerGlobals(testDb, null)

    const handler = await loadHandler()

    await expect(handler(createEvent(CHAT_SLUG)))
      .rejects.toMatchObject({ status: 401 })
  })
})
