import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import {
  EXTRACTION_NOW,
  createMemoryExtractionTestDb,
  minutesBefore,
  seedChat,
  seedEntry,
  seedMessage,
  seedProject,
  seedUser,
  textPart,
} from '../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => ({
  getModel: vi.fn(),
  getCachedGatewayCatalog: vi.fn(),
  getCachedCloudflareGatewayCatalog: vi.fn(),
  getCloudflareGatewayCredentials: vi.fn(),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('#shared/utils/model', () => ({ getModel: mocks.getModel }))

vi.mock('~~/server/utils/gateways/catalog', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/gateways/catalog')
  >()

  return {
    ...original,
    getCachedGatewayCatalog: mocks.getCachedGatewayCatalog,
    getCachedCloudflareGatewayCatalog:
      mocks.getCachedCloudflareGatewayCatalog,
  }
})

vi.mock('~~/server/utils/gateways/cloudflare', () => ({
  getCloudflareGatewayCredentials: mocks.getCloudflareGatewayCredentials,
}))

const DIRECT_SELECTION = {
  scope: 'profile',
  source: 'setting',
  providerId: 'openai',
  gatewayId: null,
  modelId: 'gpt-test',
  modelName: 'GPT Test',
} as const

describe('estimateBackfill', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, { memoryEnabled: true })
    mocks.getModel.mockReturnValue({
      model: { price: { tokens: 1_000_000, input: '$1.00', output: '$4.00' } },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    testDb.close()
  })

  async function chatWith(
    messages: Array<{ role: 'user' | 'assistant', text: string }>,
    owner = userId,
    values: Parameters<typeof seedChat>[2] = {},
  ) {
    const chat = await seedChat(testDb.db, owner, values)

    for (const [index, message] of messages.entries()) {
      await seedMessage(
        testDb.db,
        chat.id,
        message.role,
        [textPart(message.text)],
        minutesBefore(100 - index),
      )
    }

    return chat
  }

  async function estimate(selection: Parameters<
    typeof import('~~/server/utils/memory/backfill-estimate').estimateBackfill
  >[0]['selection'] = DIRECT_SELECTION) {
    const { estimateBackfill } = await import(
      '~~/server/utils/memory/backfill-estimate'
    )

    return await estimateBackfill({
      userId,
      selection,
      createdBefore: EXTRACTION_NOW,
      db: testDb.db,
    })
  }

  it('reads json_each over message parts in the test database', () => {
    const row = testDb.sqlite.prepare(`
      select json_extract(part.value, '$.text') as text
      from json_each('[{"type":"text","text":"hi"},{"type":"file"}]') as part
      where json_extract(part.value, '$.type') = 'text'
    `).get() as { text: string }

    expect(row.text).toBe('hi')
  })

  it('sums user and transcript characters per chat from SQL', async () => {
    await chatWith([
      { role: 'user', text: 'a'.repeat(400) },
      { role: 'assistant', text: 'b'.repeat(300) },
      { role: 'user', text: 'c'.repeat(100) },
    ])

    const result = await estimate()

    expect(result.chats).toBe(1)
    expect(result.userChars).toBe(500)
    expect(result.transcriptChars).toBe(800)
    expect(result.approximate).toBe(true)
  })

  it('caps each message by role and each chat at the transcript budget',
    async () => {
      await chatWith([
        { role: 'user', text: 'a'.repeat(10_000) },
        { role: 'assistant', text: 'b'.repeat(10_000) },
      ])

      const result = await estimate()

      expect(result.userChars).toBe(3000)
      expect(result.transcriptChars).toBe(4000)

      const manyMessages = Array.from({ length: 20 }, () => {
        return { role: 'user' as const, text: 'd'.repeat(3000) }
      })

      await chatWith(manyMessages)

      const capped = await estimate()

      expect(capped.chats).toBe(2)
      expect(capped.userChars).toBe(3000 + 36_000)
      expect(capped.transcriptChars).toBe(4000 + 36_000)
    })

  it('counts only the user\'s own account chats with a user message',
    async () => {
      const otherUser = await seedUser(testDb.db, { memoryEnabled: true })
      const projectId = await seedProject(testDb.db, userId)

      await chatWith([{ role: 'user', text: 'mine' }])
      await chatWith([{ role: 'user', text: 'other' }], otherUser)
      await chatWith([{ role: 'user', text: 'project' }], userId, {
        projectId,
      })
      await chatWith([{ role: 'assistant', text: 'no user message' }])
      await chatWith([{ role: 'user', text: 'newer than cutoff' }], userId, {
        createdAt: new Date(EXTRACTION_NOW.getTime() + 60_000),
      })

      const result = await estimate()

      expect(result.chats).toBe(1)
      expect(result.userChars).toBe(4)
    })

  it('survives a malformed parts value and non-text parts', async () => {
    const chat = await chatWith([{ role: 'user', text: 'x'.repeat(50) }])

    testDb.sqlite.prepare(
      'insert into messages (chat_id, role, parts, tools, reasoning, '
      + 'created_at, updated_at, public_id) values (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      Number(chat.id.slice(4)),
      'user',
      'not json',
      '[]',
      'off',
      1,
      1,
      'malformed-parts',
    )
    await seedMessage(testDb.db, chat.id, 'user', [
      { type: 'file', url: 'x' },
    ], minutesBefore(50))

    const result = await estimate()

    expect(result.chats).toBe(1)
    expect(result.userChars).toBe(50)
  })

  it('aggregates only the newest backfillMaxChats chats the job can reach',
    async () => {
      await chatWith(
        [{ role: 'user', text: 'z'.repeat(5000) }],
        userId,
        { activityAt: minutesBefore(5000) },
      )

      for (let index = 0; index < MEMORY_LIMITS.backfillMaxChats; index++) {
        await chatWith(
          [{ role: 'user', text: 'a'.repeat(10) }],
          userId,
          { activityAt: minutesBefore(60 + index) },
        )
      }

      const result = await estimate()

      expect(result.chats).toBe(MEMORY_LIMITS.backfillMaxChats)
      expect(result.userChars).toBe(MEMORY_LIMITS.backfillMaxChats * 10)
    })

  it('estimates only the chats after a continuation cursor', async () => {
    const newest = await chatWith(
      [{ role: 'user', text: 'n'.repeat(700) }],
      userId,
      { activityAt: minutesBefore(10) },
    )

    await chatWith(
      [{ role: 'user', text: 'o'.repeat(40) }],
      userId,
      { activityAt: minutesBefore(20) },
    )
    await chatWith(
      [{ role: 'user', text: 'p'.repeat(60) }],
      userId,
      { activityAt: minutesBefore(30) },
    )

    const { estimateBackfill } = await import(
      '~~/server/utils/memory/backfill-estimate'
    )
    const result = await estimateBackfill({
      userId,
      selection: DIRECT_SELECTION,
      window: {
        createdBefore: EXTRACTION_NOW,
        cursor: { activityAt: minutesBefore(10), chatId: newest.id },
        isContinuation: true,
      },
      db: testDb.db,
    })

    expect(result.chats).toBe(2)
    expect(result.userChars).toBe(100)
    expect(result.continuesPreviousRun).toBe(true)
  })

  it('marks a fresh window as not continuing a previous run', async () => {
    await chatWith([{ role: 'user', text: 'a'.repeat(50) }])

    expect((await estimate()).continuesPreviousRun).toBe(false)
  })

  it('returns zeros and a zero cost for a user without chats', async () => {
    const result = await estimate()

    expect(result).toMatchObject({
      chats: 0,
      userChars: 0,
      transcriptChars: 0,
      outputTokens: 0,
      costUsd: 0,
    })
    expect(result.inputTokens).toBe(0)
  })

  it('prices tokens from the direct model price per million', async () => {
    await chatWith([{ role: 'user', text: 'a'.repeat(4000) }])

    const result = await estimate()
    const expected = (
      result.inputTokens * 1 + result.outputTokens * 4
    ) / 1_000_000

    expect(result.pricePerMillion).toEqual({ input: 1, output: 4 })
    expect(result.costUsd).toBeCloseTo(expected, 10)
    expect(result.inputTokens).toBeGreaterThan(
      result.overheadTokensPerChat,
    )
    expect(result.model).toEqual({
      source: 'setting',
      providerId: 'openai',
      gatewayId: null,
      modelId: 'gpt-test',
      modelName: 'GPT Test',
    })
  })

  it('reads the floor of a tiered "from" price', async () => {
    mocks.getModel.mockReturnValue({
      model: {
        price: { tokens: 1_000_000, input: 'from $2.00', output: 'from $8' },
      },
    })
    await chatWith([{ role: 'user', text: 'a'.repeat(500) }])

    expect((await estimate()).pricePerMillion).toEqual({
      input: 2,
      output: 8,
    })
  })

  it('gives a null price and cost when the price is unknown', async () => {
    await chatWith([{ role: 'user', text: 'a'.repeat(500) }])

    mocks.getModel.mockReturnValue({ model: null })
    expect(await estimate()).toMatchObject({
      pricePerMillion: null,
      costUsd: null,
    })

    mocks.getModel.mockReturnValue({
      model: { price: { tokens: 1_000, input: '$1', output: '$2' } },
    })
    expect(await estimate()).toMatchObject({ costUsd: null })

    mocks.getModel.mockReturnValue({
      model: { price: { tokens: 1_000_000, input: '', output: '' } },
    })
    expect(await estimate()).toMatchObject({ costUsd: null })
  })

  it('converts per-token gateway pricing to per million', async () => {
    await chatWith([{ role: 'user', text: 'a'.repeat(500) }])
    mocks.getCachedGatewayCatalog.mockResolvedValue([
      {
        id: 'vendor/model',
        name: 'Model',
        pricing: { input: '0.0000025', output: '0.00001' },
      },
    ])

    const result = await estimate({
      scope: 'profile',
      source: 'setting',
      providerId: null,
      gatewayId: 'vercel',
      modelId: 'vendor/model',
      modelName: 'vendor/model',
    })

    expect(result.pricePerMillion?.input).toBeCloseTo(2.5, 10)
    expect(result.pricePerMillion?.output).toBeCloseTo(10, 10)
    expect(result.costUsd).not.toBeNull()
  })

  it('gives a null price when the gateway catalog fails or lacks pricing',
    async () => {
      await chatWith([{ role: 'user', text: 'a'.repeat(500) }])

      const gatewaySelection = {
        scope: 'profile',
        source: 'setting',
        providerId: null,
        gatewayId: 'openrouter',
        modelId: 'vendor/model',
        modelName: 'vendor/model',
      } as const

      mocks.getCachedGatewayCatalog.mockRejectedValue(new Error('down'))
      expect((await estimate(gatewaySelection)).costUsd).toBeNull()

      mocks.getCachedGatewayCatalog.mockResolvedValue([
        { id: 'vendor/model', name: 'Model' },
      ])
      expect((await estimate(gatewaySelection)).pricePerMillion).toBeNull()
    })

  it('gives a null price for a Cloudflare gateway without credentials',
    async () => {
      await chatWith([{ role: 'user', text: 'a'.repeat(500) }])
      mocks.getCloudflareGatewayCredentials.mockResolvedValue(undefined)

      const result = await estimate({
        scope: 'profile',
        source: 'chat',
        providerId: null,
        gatewayId: 'cloudflare',
        modelId: 'x',
        modelName: 'x',
      })

      expect(result.pricePerMillion).toBeNull()
      expect(mocks.getCachedCloudflareGatewayCatalog).not.toHaveBeenCalled()
    })

  it('returns a null model for a null selection', async () => {
    await chatWith([{ role: 'user', text: 'a'.repeat(500) }])

    expect(await estimate(null)).toMatchObject({
      model: null,
      pricePerMillion: null,
      costUsd: null,
    })
  })

  it('counts Cyrillic text as more tokens than the same Latin length',
    async () => {
      const latinUser = userId
      const cyrillicUser = await seedUser(testDb.db, { memoryEnabled: true })

      await chatWith([{ role: 'user', text: 'a'.repeat(2000) }], latinUser)
      await chatWith([{ role: 'user', text: 'я'.repeat(2000) }], cyrillicUser)

      const { estimateBackfill } = await import(
        '~~/server/utils/memory/backfill-estimate'
      )
      const latin = await estimateBackfill({
        userId: latinUser,
        selection: null,
        createdBefore: EXTRACTION_NOW,
        db: testDb.db,
      })
      const cyrillic = await estimateBackfill({
        userId: cyrillicUser,
        selection: null,
        createdBefore: EXTRACTION_NOW,
        db: testDb.db,
      })

      expect(cyrillic.overheadTokensPerChat)
        .toBeGreaterThan(latin.overheadTokensPerChat)
      expect(cyrillic.inputTokens).toBeGreaterThan(latin.inputTokens)
    })

  it('adds the per-chat overhead for every chat and grows with the index',
    async () => {
      await chatWith([{ role: 'user', text: 'hello' }])
      await chatWith([{ role: 'user', text: 'again' }])

      const before = await estimate()

      expect(before.inputTokens).toBeGreaterThanOrEqual(
        2 * before.overheadTokensPerChat,
      )

      await seedEntry(testDb.db, userId, { body: '- fact\n'.repeat(400) })

      const after = await estimate()

      expect(after.overheadTokensPerChat)
        .toBeGreaterThan(before.overheadTokensPerChat)
    })

  it('caps output tokens per chat at the extraction limit', async () => {
    await chatWith([{ role: 'user', text: 'a'.repeat(3000) }])

    const result = await estimate()

    expect(result.outputTokens).toBeGreaterThanOrEqual(300)
    expect(result.outputTokens).toBeLessThanOrEqual(12_000)
  })

  it('ignores non-object elements in the parts array', async () => {
    const chat = await chatWith([{ role: 'user', text: 'x'.repeat(50) }])

    testDb.sqlite.prepare(
      'insert into messages (chat_id, role, parts, tools, reasoning, '
      + 'created_at, updated_at, public_id) values (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      Number(chat.id.slice(4)),
      'user',
      '[1, "text", null, [{"type":"text","text":"nested"}], '
      + '{"type":"text","text":"abcde"}]',
      '[]',
      'off',
      1,
      1,
      'non-object-parts',
    )

    const result = await estimate()

    expect(result.userChars).toBe(55)
  })

  it('samples the newest user messages for the script mix', async () => {
    const mixedUser = userId
    const latinUser = await seedUser(testDb.db, { memoryEnabled: true })
    const mixedChat = await seedChat(testDb.db, mixedUser)
    const latinChat = await seedChat(testDb.db, latinUser)

    for (let index = 0; index < 5; index++) {
      await seedMessage(testDb.db, mixedChat.id, 'user',
        [textPart('я'.repeat(500))], minutesBefore(500 - index))
    }

    for (let index = 0; index < 40; index++) {
      await seedMessage(testDb.db, mixedChat.id, 'user',
        [textPart('a'.repeat(100))], minutesBefore(100 - index))
      await seedMessage(testDb.db, latinChat.id, 'user',
        [textPart('a'.repeat(100))], minutesBefore(100 - index))
    }

    const { estimateBackfill } = await import(
      '~~/server/utils/memory/backfill-estimate'
    )
    const forUser = async (owner: number) => {
      return await estimateBackfill({
        userId: owner,
        selection: null,
        createdBefore: EXTRACTION_NOW,
        db: testDb.db,
      })
    }

    expect((await forUser(mixedUser)).overheadTokensPerChat)
      .toBe((await forUser(latinUser)).overheadTokensPerChat)
  })

  describe('getBackfillEstimate cache', () => {
    function createKvStub() {
      const store = new Map<string, string>()

      return {
        store,
        get: vi.fn(async (key: string) => store.get(key) ?? null),
        put: vi.fn(async (key: string, value: string) => {
          store.set(key, value)
        }),
        delete: vi.fn(async (key: string) => {
          store.delete(key)
        }),
      }
    }

    async function cached(selection: Parameters<
      typeof import('~~/server/utils/memory/backfill-estimate').getBackfillEstimate
    >[0]['selection'] = DIRECT_SELECTION) {
      const { getBackfillEstimate } = await import(
        '~~/server/utils/memory/backfill-estimate'
      )

      return await getBackfillEstimate({
        userId,
        selection,
        createdBefore: EXTRACTION_NOW,
        db: testDb.db,
      })
    }

    it('serves the second call from KV for ten minutes', async () => {
      const kv = createKvStub()

      vi.stubGlobal('useKV', () => kv)
      await chatWith([{ role: 'user', text: 'a'.repeat(500) }])

      const first = await cached()

      await chatWith([{ role: 'user', text: 'b'.repeat(500) }])

      const second = await cached()

      expect(second).toEqual(first)
      expect(kv.put).toHaveBeenCalledTimes(1)
      expect(kv.put).toHaveBeenCalledWith(
        `memory-backfill-estimate:${userId}`,
        expect.any(String),
        { expirationTtl: 600 },
      )
      vi.unstubAllGlobals()
    })

    it('recomputes for a different window', async () => {
      const kv = createKvStub()

      vi.stubGlobal('useKV', () => kv)

      const newest = await chatWith(
        [{ role: 'user', text: 'a'.repeat(500) }],
        userId,
        { activityAt: minutesBefore(10) },
      )

      await chatWith(
        [{ role: 'user', text: 'b'.repeat(500) }],
        userId,
        { activityAt: minutesBefore(20) },
      )

      const fresh = await cached()
      const { getBackfillEstimate } = await import(
        '~~/server/utils/memory/backfill-estimate'
      )
      const continued = await getBackfillEstimate({
        userId,
        selection: DIRECT_SELECTION,
        window: {
          createdBefore: EXTRACTION_NOW,
          cursor: { activityAt: minutesBefore(10), chatId: newest.id },
          isContinuation: true,
        },
        db: testDb.db,
      })

      expect(fresh.chats).toBe(2)
      expect(continued.chats).toBe(1)
      expect(kv.put).toHaveBeenCalledTimes(2)
      vi.unstubAllGlobals()
    })

    it('recomputes for a different resolved model', async () => {
      const kv = createKvStub()

      vi.stubGlobal('useKV', () => kv)
      await chatWith([{ role: 'user', text: 'a'.repeat(500) }])
      await cached()

      const other = await cached({ ...DIRECT_SELECTION, modelId: 'other' })

      expect(other.model?.modelId).toBe('other')
      expect(kv.put).toHaveBeenCalledTimes(2)
      vi.unstubAllGlobals()
    })

    it('recomputes after invalidation', async () => {
      const kv = createKvStub()

      vi.stubGlobal('useKV', () => kv)
      await chatWith([{ role: 'user', text: 'a'.repeat(500) }])
      await cached()

      const { invalidateBackfillEstimate } = await import(
        '~~/server/utils/memory/backfill-estimate'
      )

      await invalidateBackfillEstimate(userId)
      await chatWith([{ role: 'user', text: 'b'.repeat(500) }])

      expect((await cached()).chats).toBe(2)
      vi.unstubAllGlobals()
    })

    it('falls through to a fresh estimate when KV fails', async () => {
      vi.stubGlobal('useKV', () => ({
        get: vi.fn().mockRejectedValue(new Error('kv down')),
        put: vi.fn().mockRejectedValue(new Error('kv down')),
        delete: vi.fn().mockRejectedValue(new Error('kv down')),
      }))
      await chatWith([{ role: 'user', text: 'a'.repeat(500) }])

      expect((await cached()).chats).toBe(1)

      const { invalidateBackfillEstimate } = await import(
        '~~/server/utils/memory/backfill-estimate'
      )

      await expect(invalidateBackfillEstimate(userId)).resolves.toBeUndefined()
      vi.unstubAllGlobals()
    })

    it('ignores a corrupt cached value', async () => {
      const kv = createKvStub()

      kv.store.set(`memory-backfill-estimate:${userId}`, 'not json')
      vi.stubGlobal('useKV', () => kv)
      await chatWith([{ role: 'user', text: 'a'.repeat(500) }])

      expect((await cached()).chats).toBe(1)
      vi.unstubAllGlobals()
    })
  })
})
