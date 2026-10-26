import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedProject,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const mocks = vi.hoisted(() => ({
  extractChatMemory: vi.fn(),
  loggerSet: vi.fn(),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: mocks.loggerSet }),
}))

vi.mock('~~/server/utils/memory/extract', () => ({
  extractChatMemory: mocks.extractChatMemory,
}))

const SECRET_TEXT = 'secret entry text'

function createKvStub() {
  const store = new Map<string, string>()

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
  }
}

function createExtractionResult() {
  return {
    status: 'extracted',
    applied: { created: 2, updated: 1, deleted: 0 },
    dropped: { ungrounded: 1 },
    blocked: {},
    model: {
      source: 'chat',
      providerId: 'openai',
      gatewayId: null,
      modelId: 'gpt-test',
      skipped: [],
    },
    messages: 4,
    userChars: 800,
    proposed: 4,
    usage: { inputTokens: 100, outputTokens: 20 },
  }
}

async function loadHandler() {
  const module = await import('../../../server/api/v1/memory/extract-now.post')

  return module.default
}

function cooldownPutsOf(kv: { put: { mock: { calls: unknown[][] } } }) {
  return kv.put.mock.calls.filter(([key]) => {
    return !String(key).startsWith('memory-rate-limit:')
  })
}
describe('POST /api/v1/memory/extract-now', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let kv: ReturnType<typeof createKvStub>

  beforeEach(async () => {
    vi.resetModules()
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, { memoryEnabled: true })
    kv = createKvStub()
    mocks.extractChatMemory.mockResolvedValue(createExtractionResult())

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('assertNotCrossSiteRequest', vi.fn())
    vi.stubGlobal(
      'readValidatedBody',
      async (event: { body: unknown }, parser: (body: unknown) => unknown) => {
        return parser(event.body)
      },
    )
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: String(userId) },
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  async function call(chatSlug: unknown) {
    const handler = await loadHandler()

    return await handler({ body: { chatSlug } } as never)
  }

  it('rejects unauthenticated requests', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    await expect(call('slug')).rejects.toMatchObject({ status: 401 })
  })

  it('rejects an invalid body', async () => {
    await expect(call('')).rejects.toMatchObject({ status: 400 })
    await expect(call(42)).rejects.toMatchObject({ status: 400 })
    expect(mocks.extractChatMemory).not.toHaveBeenCalled()
  })

  it('answers 404 for unknown and foreign chats alike', async () => {
    const otherUserId = await seedUser(testDb.db, {})
    const foreignChat = await seedChat(testDb.db, otherUserId)

    await expect(call(foreignChat.slug)).rejects.toMatchObject({ status: 404 })
    await expect(call('does-not-exist')).rejects.toMatchObject({ status: 404 })
    expect(mocks.extractChatMemory).not.toHaveBeenCalled()
    expect(cooldownPutsOf(kv)).toHaveLength(0)
  })

  it('runs an account chat with the extraction toggle off', async () => {
    const chat = await seedChat(testDb.db, userId)

    await testDb.db.update(schema.userSettings)
      .set({ memoryExtractionEnabled: false })
      .where(eq(schema.userSettings.userId, userId))

    expect(await call(chat.slug)).toMatchObject({ status: 'extracted' })
    expect(mocks.extractChatMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        chat: { id: chat.id },
        ignoreIdle: true,
        explicit: true,
      }),
    )
  })

  it('runs a project chat with the extraction toggle off', async () => {
    const projectId = await seedProject(testDb.db, userId)
    const chat = await seedChat(testDb.db, userId, { projectId })

    await testDb.db.update(schema.userSettings)
      .set({ memoryExtractionEnabled: false })
      .where(eq(schema.userSettings.userId, userId))

    expect(await call(chat.slug)).toMatchObject({ status: 'extracted' })
    expect(mocks.extractChatMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        chat: { id: chat.id },
        ignoreIdle: true,
        explicit: true,
      }),
    )
  })

  it('answers 409 for a project chat when memory is off', async () => {
    const projectId = await seedProject(testDb.db, userId)
    const chat = await seedChat(testDb.db, userId, { projectId })

    await testDb.db.update(schema.userSettings)
      .set({ memoryEnabled: false })
      .where(eq(schema.userSettings.userId, userId))

    await expect(call(chat.slug)).rejects.toMatchObject({ status: 409 })
    expect(mocks.extractChatMemory).not.toHaveBeenCalled()
  })

  it('answers 409 with a fix when memory is off', async () => {
    const chat = await seedChat(testDb.db, userId)

    await testDb.db.update(schema.userSettings)
      .set({ memoryEnabled: false })
      .where(eq(schema.userSettings.userId, userId))

    await expect(call(chat.slug)).rejects.toMatchObject({
      status: 409,
      fix: expect.any(String),
    })
    expect(mocks.extractChatMemory).not.toHaveBeenCalled()
  })

  it('runs when the user has no settings row', async () => {
    const userWithoutSettings = await seedUser(testDb.db, null)
    const chat = await seedChat(testDb.db, userWithoutSettings)

    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: String(userWithoutSettings) },
    }))

    expect(await call(chat.slug)).toMatchObject({ status: 'extracted' })
  })

  it('answers 429 while the cooldown is active', async () => {
    const chat = await seedChat(testDb.db, userId)

    kv.store.set(`memory-extract-now:${userId}`, '1')

    await expect(call(chat.slug)).rejects.toMatchObject({ status: 429 })
    expect(mocks.extractChatMemory).not.toHaveBeenCalled()
  })

  it('runs one pass ignoring idle and starts the cooldown', async () => {
    const chat = await seedChat(testDb.db, userId)
    const response = await call(chat.slug)

    expect(mocks.extractChatMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        chat: { id: chat.id },
        userId,
        ignoreIdle: true,
        explicit: true,
      }),
    )
    expect(response).toEqual({
      status: 'extracted',
      reason: undefined,
      created: 2,
      updated: 1,
      deleted: 0,
      dropped: { ungrounded: 1 },
      model: { source: 'chat', modelId: 'gpt-test' },
    })
    expect(kv.put).toHaveBeenCalledWith(
      `memory-extract-now:${userId}`,
      '1',
      { expirationTtl: 60 },
    )
    await expect(call(chat.slug)).rejects.toMatchObject({ status: 429 })
  })

  it('starts the cooldown for a failed pass but not for skipped or leased',
    async () => {
      const chat = await seedChat(testDb.db, userId)

      mocks.extractChatMemory.mockResolvedValue({
        ...createExtractionResult(),
        status: 'leased',
      })
      await call(chat.slug)
      mocks.extractChatMemory.mockResolvedValue({
        ...createExtractionResult(),
        status: 'skipped',
        reason: 'too-short',
      })
      await call(chat.slug)

      expect(cooldownPutsOf(kv)).toHaveLength(0)

      mocks.extractChatMemory.mockResolvedValue({
        ...createExtractionResult(),
        status: 'failed',
        reason: 'no-model',
      })
      await call(chat.slug)

      expect(cooldownPutsOf(kv)).toHaveLength(1)
    })

  it('reports a null model when none resolved', async () => {
    const chat = await seedChat(testDb.db, userId)

    mocks.extractChatMemory.mockResolvedValue({
      ...createExtractionResult(),
      status: 'failed',
      reason: 'no-model',
      model: { source: null, providerId: null, gatewayId: null, modelId: null },
    })

    expect(await call(chat.slug)).toMatchObject({
      status: 'failed',
      reason: 'no-model',
      model: null,
    })
  })

  it('logs counts only', async () => {
    const chat = await seedChat(testDb.db, userId, { title: SECRET_TEXT })

    await call(chat.slug)

    const logged = JSON.stringify(mocks.loggerSet.mock.calls)

    expect(logged).toContain('chatsProcessed')
    expect(logged).not.toContain(SECRET_TEXT)
  })
})
