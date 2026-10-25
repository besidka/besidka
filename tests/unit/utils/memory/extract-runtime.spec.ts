import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EXTRACTION_NOW,
  createMemoryExtractionTestDb,
  minutesBefore,
  seedChat,
  seedKey,
  seedMessage,
  seedUser,
  textPart,
} from '../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  useOpenAI: vi.fn(),
}))

vi.mock('ai', () => ({
  generateObject: mocks.generateObject,
  generateText: vi.fn(),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const LONG_USER_TEXT = `I write Rust on weekends. ${'I prefer concise answers. '.repeat(14)}`
const LEASE_TTL_MS = 120_000

function createKvStub() {
  const store = new Map<string, number>()

  return {
    store,
    get: vi.fn(async (key: string) => {
      const expiresAt = store.get(key)

      if (expiresAt === undefined || expiresAt <= Date.now()) {
        return null
      }

      return '1'
    }),
    put: vi.fn(async (
      key: string,
      _value: string,
      options?: { expirationTtl?: number },
    ) => {
      store.set(key, Date.now() + (options?.expirationTtl ?? 60) * 1000)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }
}

describe('extraction runtime wiring', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, { memoryEnabled: true })
    mocks.generateObject.mockResolvedValue({
      object: { ops: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    mocks.useOpenAI.mockImplementation(async () => {
      return {
        instance: { id: 'openai-instance' },
        reasoning: 'low',
        providerOptions: {},
      }
    })
    vi.stubGlobal('useOpenAI', mocks.useOpenAI)
    vi.stubGlobal('useKV', () => createKvStub())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    testDb.close()
  })

  async function seedDueChat() {
    const chat = await seedChat(testDb.db, userId, {
      activityAt: minutesBefore(60),
    })

    await seedMessage(testDb.db, chat.id, 'user', [textPart(LONG_USER_TEXT)],
      minutesBefore(70))
    await seedMessage(testDb.db, chat.id, 'assistant', [textPart('Noted')],
      minutesBefore(69), {
        usage: { model: 'claude-unknown', provider: 'anthropic' } as never,
      })

    return chat
  }

  async function run(chat: { id: string }) {
    const { extractChatMemory } = await import(
      '~~/server/utils/memory/extract'
    )

    return await extractChatMemory({
      chat,
      userId,
      db: testDb.db,
      logger: { set: vi.fn() },
      now: EXTRACTION_NOW,
    })
  }

  it('falls back to the cheapest keyed provider when the chat model is unusable',
    async () => {
      await seedKey(testDb.db, userId, 'openai')

      const chat = await seedDueChat()
      const result = await run(chat)

      expect(result.status).toBe('extracted')
      expect(result.model).toMatchObject({
        source: 'fallback',
        providerId: 'openai',
      })
      expect(result.model?.skipped.some((reason) => {
        return reason.startsWith('chat:')
      })).toBe(true)
      expect(mocks.useOpenAI).toHaveBeenCalled()
      expect(mocks.generateObject.mock.calls[0]![0].model)
        .toEqual({ id: 'openai-instance' })
    })

  it('fails with no-model when the user has no saved key', async () => {
    const chat = await seedDueChat()
    const result = await run(chat)

    expect(result).toMatchObject({ status: 'failed', reason: 'no-model' })
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })

  it('recovers once the lease of a dead holder has expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(EXTRACTION_NOW)
    await seedKey(testDb.db, userId, 'openai')

    const kv = createKvStub()
    const { memoryExtractionLeaseKey } = await import(
      '~~/server/utils/projects/memory-lease'
    )
    const chat = await seedDueChat()

    vi.stubGlobal('useKV', () => kv)
    await kv.put(memoryExtractionLeaseKey(chat.id), '1', {
      expirationTtl: LEASE_TTL_MS / 1000,
    })

    const whileHeld = await run(chat)

    expect(whileHeld.status).toBe('leased')
    expect(mocks.generateObject).not.toHaveBeenCalled()

    vi.setSystemTime(new Date(EXTRACTION_NOW.getTime() + LEASE_TTL_MS + 1000))

    const afterExpiry = await run(chat)

    expect(afterExpiry.status).toBe('extracted')
    expect(mocks.generateObject).toHaveBeenCalledOnce()
    expect(kv.store.has(memoryExtractionLeaseKey(chat.id))).toBe(false)
  })

  it('takes and releases the real lease around a pass', async () => {
    await seedKey(testDb.db, userId, 'openai')

    const kv = createKvStub()
    const { memoryExtractionLeaseKey } = await import(
      '~~/server/utils/projects/memory-lease'
    )
    const chat = await seedDueChat()
    let keyHeldDuringPass = false

    vi.stubGlobal('useKV', () => kv)
    mocks.generateObject.mockImplementation(async () => {
      keyHeldDuringPass = kv.store.has(memoryExtractionLeaseKey(chat.id))

      return { object: { ops: [] }, usage: {} }
    })

    await run(chat)

    expect(keyHeldDuringPass).toBe(true)
    expect(kv.store.has(memoryExtractionLeaseKey(chat.id))).toBe(false)
  })
})
