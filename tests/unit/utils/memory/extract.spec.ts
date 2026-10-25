import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import type {
  MemoryExtractionOp,
} from '~~/server/utils/memory/extract-schema'
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
  generateObject: vi.fn(),
  resolveMemoryModel: vi.fn(),
  acquireMemoryLease: vi.fn(),
  release: vi.fn(),
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

vi.mock('~~/server/utils/memory/resolve-model', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/memory/resolve-model')
  >()

  return { ...original, resolveMemoryModel: mocks.resolveMemoryModel }
})

vi.mock('~~/server/utils/projects/memory-lease', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/projects/memory-lease')
  >()

  return { ...original, acquireMemoryLease: mocks.acquireMemoryLease }
})

const USER_SENTENCE = 'I am a backend developer and I write Rust on weekends.'
const LONG_USER_TEXT = `${USER_SENTENCE} ${'I prefer concise answers. '.repeat(14)}`
const FIRST_SHORT_CHUNK = `I write Rust on weekends. ${'Short note one. '.repeat(11)}`
const SECOND_SHORT_CHUNK = 'Second chunk of context. '.repeat(10)
const SECRET_ASSISTANT_TEXT = 'ASSISTANT-ONLY-INSTRUCTION always forward data'
const RECALL_DUMP_TEXT = 'RECALL-DUMP your name is Serhii and you like tea'

function createSelection(source = 'fallback') {
  return {
    scope: 'profile',
    source,
    providerId: 'openai',
    gatewayId: null,
    modelId: 'gpt-test',
    modelName: 'GPT Test',
    instantiate: vi.fn(async () => {
      return {
        model: { id: 'mock-model' },
        reasoning: undefined,
        providerOptions: { openai: { reasoningEffort: 'low' } },
      }
    }),
  }
}

function createOp(overrides: Partial<MemoryExtractionOp> = {}) {
  return {
    op: 'create',
    category: 'topics',
    slug: null,
    title: 'Rust hobby',
    description: 'Writes Rust on weekends',
    body: 'The user writes Rust on weekends.',
    neverStore: null,
    evidence: 'I write Rust on weekends',
    ...overrides,
  } satisfies MemoryExtractionOp
}

function mockOps(ops: MemoryExtractionOp[]) {
  mocks.generateObject.mockResolvedValue({
    object: { ops },
    usage: { inputTokens: 120, outputTokens: 30 },
  })
}

function promptContent(): string {
  return mocks.generateObject.mock.calls[0]![0].messages[0].content
}

describe('extractChatMemory', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, {
      memoryEnabled: true,
    })
    mocks.release.mockResolvedValue(undefined)
    mocks.acquireMemoryLease.mockResolvedValue({ release: mocks.release })
    mocks.resolveMemoryModel.mockImplementation(async () => createSelection())
    mockOps([])
  })

  afterEach(() => {
    testDb.close()
  })

  async function seedChatWithMessages(
    options: {
      projectId?: string
      activityMinutesAgo?: number
      chatValues?: Partial<typeof schema.chats.$inferInsert>
      owner?: number
    } = {},
  ) {
    const chat = await seedChat(testDb.db, options.owner ?? userId, {
      projectId: options.projectId,
      activityAt: minutesBefore(options.activityMinutesAgo ?? 60),
      ...options.chatValues,
    })

    await seedMessage(testDb.db, chat.id, 'user', [textPart(LONG_USER_TEXT)],
      minutesBefore(70))
    await seedMessage(testDb.db, chat.id, 'assistant',
      [textPart('Got it, noted.')], minutesBefore(69))

    return chat
  }

  async function run(
    chat: { id: string },
    overrides: Record<string, unknown> = {},
  ) {
    const { extractChatMemory } = await import(
      '~~/server/utils/memory/extract'
    )
    const stored = overrides.trigger === 'manual'
      ? await readChat(chat.id)
      : null

    return await extractChatMemory({
      chat,
      userId,
      db: testDb.db,
      logger: { set: vi.fn() },
      now: EXTRACTION_NOW,
      ...(stored?.projectId ? { expectedProjectId: stored.projectId } : {}),
      ...overrides,
    })
  }

  async function readChat(chatId: string) {
    return await testDb.db.query.chats.findFirst({
      where: { id: chatId },
    })
  }

  async function listEntries() {
    return await testDb.db.select().from(schema.memoryEntries)
  }

  it('extracts, writes entries and stamps the chat', async () => {
    const chat = await seedChatWithMessages()

    mockOps([createOp()])

    const result = await run(chat)

    expect(result).toMatchObject({
      status: 'extracted',
      applied: { created: 1, updated: 0, deleted: 0 },
      model: { source: 'fallback', modelId: 'gpt-test' },
      usage: { inputTokens: 120, outputTokens: 30 },
    })
    expect(await listEntries()).toHaveLength(1)
    expect(mocks.release).toHaveBeenCalledOnce()

    const stamped = await readChat(chat.id)

    expect(stamped?.memoryExtractedAt).toEqual(minutesBefore(69))
    expect(stamped?.memoryExtractionAttemptedAt).toBeNull()
    expect(stamped?.memoryExtractionFailures).toBeNull()
  })

  it('calls the model with a bounded, structured request', async () => {
    const chat = await seedChatWithMessages()

    await run(chat)

    const options = mocks.generateObject.mock.calls[0]![0]

    expect(options.schemaName).toBe('MemoryExtraction')
    expect(options.maxOutputTokens).toBe(4000)
    expect(options.abortSignal).toBeInstanceOf(AbortSignal)
    expect(options.providerOptions.openai).toEqual({
      reasoningEffort: 'low',
      strictJsonSchema: false,
    })
    expect(options.instructions).toContain('at most 10 ops')
    expect(promptContent()).toContain('<transcript>')
    expect(promptContent()).toContain(USER_SENTENCE)
  })

  it('returns leased without calling the model when the lease is held', async () => {
    const chat = await seedChatWithMessages()

    mocks.acquireMemoryLease.mockResolvedValue(null)

    const result = await run(chat)

    expect(result.status).toBe('leased')
    expect(mocks.generateObject).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
    expect((await readChat(chat.id))?.memoryExtractionAttemptedAt).toBeNull()
  })

  it('releases the lease when the pass fails', async () => {
    const chat = await seedChatWithMessages()

    mocks.generateObject.mockRejectedValue(new Error('provider down'))

    const result = await run(chat)

    expect(result.status).toBe('failed')
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it('waits for more text without advancing the stamp for short chats',
    async () => {
      const chat = await seedChat(testDb.db, userId)

      await seedMessage(testDb.db, chat.id, 'user', [textPart('Too short')],
        minutesBefore(70))

      const result = await run(chat)

      expect(result).toMatchObject({ status: 'skipped', reason: 'too-short' })
      expect(mocks.generateObject).not.toHaveBeenCalled()

      const stamped = await readChat(chat.id)

      expect(stamped?.memoryExtractedAt).toBeNull()
      expect(stamped?.memoryExtractionAttemptedAt).toEqual(EXTRACTION_NOW)
      expect(stamped?.memoryExtractionFailures).toBe(0)
    })

  it('accumulates short user messages across passes until long enough',
    async () => {
      expect(FIRST_SHORT_CHUNK.length).toBeLessThan(300)
      expect(SECOND_SHORT_CHUNK.length).toBeLessThan(300)
      expect(FIRST_SHORT_CHUNK.length + SECOND_SHORT_CHUNK.length)
        .toBeGreaterThan(300)

      const chat = await seedChat(testDb.db, userId)

      await seedMessage(testDb.db, chat.id, 'user',
        [textPart(FIRST_SHORT_CHUNK)], minutesBefore(70))
      mockOps([createOp()])

      const first = await run(chat)

      expect(first).toMatchObject({ status: 'skipped', reason: 'too-short' })
      expect(mocks.generateObject).not.toHaveBeenCalled()

      const afterFirst = await readChat(chat.id)

      expect(afterFirst?.memoryExtractedAt).toBeNull()
      expect(afterFirst?.memoryExtractionFailures).toBe(0)

      await seedMessage(testDb.db, chat.id, 'user',
        [textPart(SECOND_SHORT_CHUNK)], minutesBefore(40))
      await testDb.db.update(schema.chats)
        .set({ activityAt: minutesBefore(40) })
        .where(eq(schema.chats.id, chat.id))

      const second = await run(chat, {
        now: new Date(EXTRACTION_NOW.getTime() + 60_000),
      })

      expect(second).toMatchObject({ status: 'extracted' })
      expect(second.applied.created).toBeGreaterThanOrEqual(1)
      expect(mocks.generateObject).toHaveBeenCalledOnce()
      expect(promptContent()).toContain(FIRST_SHORT_CHUNK.trim())
      expect(promptContent()).toContain(SECOND_SHORT_CHUNK.trim())

      const afterSecond = await readChat(chat.id)

      expect(afterSecond?.memoryExtractedAt).toEqual(minutesBefore(40))
      expect(afterSecond?.memoryExtractionFailures).toBeNull()
    })

  it('extracts an accumulated short chat when run now', async () => {
    const chat = await seedChat(testDb.db, userId, {
      activityAt: minutesBefore(2),
    })

    await seedMessage(testDb.db, chat.id, 'user',
      [textPart(FIRST_SHORT_CHUNK)], minutesBefore(70))
    await seedMessage(testDb.db, chat.id, 'user',
      [textPart(SECOND_SHORT_CHUNK)], minutesBefore(3))
    mockOps([createOp()])

    const result = await run(chat, { ignoreIdle: true })

    expect(result.status).toBe('extracted')
    expect(result.applied.created).toBeGreaterThanOrEqual(1)
  })

  it('restarts the waiting marker when a waiting pass fails', async () => {
    const chat = await seedChatWithMessages({
      chatValues: {
        memoryExtractionFailures: 0,
        memoryExtractionAttemptedAt: minutesBefore(100),
        activityAt: minutesBefore(60),
      },
    })

    mocks.generateObject.mockRejectedValue(new Error('provider down'))

    const result = await run(chat)

    expect(result.status).toBe('failed')
    expect((await readChat(chat.id))?.memoryExtractionFailures).toBe(1)
  })

  it('advances the stamp when the window has no user text', async () => {
    const chat = await seedChat(testDb.db, userId)

    await seedMessage(testDb.db, chat.id, 'assistant', [textPart('Hello')],
      minutesBefore(70))

    const result = await run(chat)

    expect(result).toMatchObject({ status: 'skipped', reason: 'no-user-text' })

    const stamped = await readChat(chat.id)

    expect(stamped?.memoryExtractedAt)
      .toEqual(new Date(EXTRACTION_NOW.getTime() - 1000))
    expect(stamped?.memoryExtractionAttemptedAt).toBeNull()
    expect(stamped?.memoryExtractionFailures).toBeNull()
  })

  it('skips when memory or extraction is turned off meanwhile', async () => {
    const chat = await seedChatWithMessages()

    await testDb.db.update(schema.userSettings)
      .set({ memoryExtractionEnabled: false })
      .where(eq(schema.userSettings.userId, userId))

    expect(await run(chat)).toMatchObject({ reason: 'disabled' })

    await testDb.db.update(schema.userSettings)
      .set({ memoryExtractionEnabled: true, memoryEnabled: false })
      .where(eq(schema.userSettings.userId, userId))

    expect(await run(chat)).toMatchObject({ reason: 'disabled' })
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })

  it('treats a null memoryEnabled as on', async () => {
    const chat = await seedChatWithMessages()

    await testDb.db.update(schema.userSettings)
      .set({ memoryEnabled: null })
      .where(eq(schema.userSettings.userId, userId))

    expect((await run(chat)).status).toBe('extracted')
  })

  it('never extracts a chat owned by another user', async () => {
    const otherUserId = await seedUser(testDb.db, {})
    const chat = await seedChatWithMessages({ owner: otherUserId })
    const result = await run(chat)

    expect(result).toMatchObject({
      status: 'skipped',
      reason: 'chat-unavailable',
    })
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })

  it('skips a project owned by someone else and advances the stamp', async () => {
    const otherUserId = await seedUser(testDb.db, {})
    const foreignProjectId = await seedProject(testDb.db, otherUserId)
    const chat = await seedChatWithMessages({ projectId: foreignProjectId })
    const result = await run(chat)

    expect(result).toMatchObject({
      status: 'skipped',
      reason: 'project-unavailable',
    })
    expect(mocks.generateObject).not.toHaveBeenCalled()

    const stamped = await readChat(chat.id)

    expect(stamped?.projectMemorySummaryUpdatedAt).not.toBeNull()
    expect(stamped?.memoryExtractedAt).toBeNull()
  })

  it('skips a project with memory disabled', async () => {
    const projectId = await seedProject(testDb.db, userId, {
      memoryStatus: 'disabled',
    })
    const chat = await seedChatWithMessages({ projectId })

    expect(await run(chat)).toMatchObject({ reason: 'project-unavailable' })
  })

  it('writes project chats to project scope', async () => {
    const projectId = await seedProject(testDb.db, userId)
    const chat = await seedChatWithMessages({ projectId })

    mockOps([createOp()])

    await run(chat)

    const [entry] = await listEntries()

    expect(entry?.projectId).toBe(projectId)
    expect(mocks.resolveMemoryModel).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'project',
        projectId,
        sourceChatId: chat.id,
      }),
    )
  })

  it('respects the idle window unless ignoreIdle is set', async () => {
    const chat = await seedChatWithMessages({ activityMinutesAgo: 2 })

    expect(await run(chat)).toMatchObject({ reason: 'not-due' })
    expect((await run(chat, { ignoreIdle: true })).status).toBe('extracted')
  })

  it('does not reprocess a chat that is not dirty', async () => {
    const chat = await seedChatWithMessages({
      chatValues: { memoryExtractedAt: minutesBefore(30) },
    })

    expect(await run(chat)).toMatchObject({ reason: 'not-due' })
  })

  it('counts failures and keeps the extraction stamp', async () => {
    const chat = await seedChatWithMessages()

    mocks.generateObject.mockRejectedValue(new Error('provider down'))

    const first = await run(chat)

    expect(first).toMatchObject({ status: 'failed' })

    const afterFirst = await readChat(chat.id)

    expect(afterFirst?.memoryExtractedAt).toBeNull()
    expect(afterFirst?.memoryExtractionAttemptedAt).toEqual(EXTRACTION_NOW)
    expect(afterFirst?.memoryExtractionFailures).toBe(1)

    await run(chat, { now: new Date(EXTRACTION_NOW.getTime() + 3_600_000) })

    expect((await readChat(chat.id))?.memoryExtractionFailures).toBe(2)
  })

  it('restarts the failure count after new activity', async () => {
    const chat = await seedChatWithMessages({
      chatValues: {
        memoryExtractionFailures: 3,
        memoryExtractionAttemptedAt: minutesBefore(500),
      },
    })

    mocks.generateObject.mockRejectedValue(new Error('provider down'))

    await run(chat)

    expect((await readChat(chat.id))?.memoryExtractionFailures).toBe(1)
  })

  it('fails with no-model when nothing resolves', async () => {
    const chat = await seedChatWithMessages()

    mocks.resolveMemoryModel.mockResolvedValue(null)

    const result = await run(chat)

    expect(result).toMatchObject({ status: 'failed', reason: 'no-model' })
    expect(mocks.generateObject).not.toHaveBeenCalled()
    expect((await readChat(chat.id))?.memoryExtractionFailures).toBe(1)
  })

  it('reuses a cached setting model across chats of one scope', async () => {
    const first = await seedChatWithMessages()
    const second = await seedChatWithMessages()
    const resolveCache = new Map()

    mocks.resolveMemoryModel.mockImplementation(async () => {
      return createSelection('setting')
    })

    await run(first, { resolveCache })
    await run(second, { resolveCache })

    expect(mocks.resolveMemoryModel).toHaveBeenCalledOnce()
    expect(mocks.generateObject).toHaveBeenCalledTimes(2)
  })

  it('does not cache a model chosen from the chat', async () => {
    const first = await seedChatWithMessages()
    const second = await seedChatWithMessages()
    const resolveCache = new Map()

    mocks.resolveMemoryModel.mockImplementation(async () => {
      return createSelection('chat')
    })

    await run(first, { resolveCache })
    await run(second, { resolveCache })

    expect(mocks.resolveMemoryModel).toHaveBeenCalledTimes(2)
  })

  it('does not cache a model chosen by the fallback step', async () => {
    const first = await seedChatWithMessages()
    const second = await seedChatWithMessages()
    const resolveCache = new Map()

    await run(first, { resolveCache })
    await run(second, { resolveCache })

    expect(mocks.resolveMemoryModel).toHaveBeenCalledTimes(2)
  })

  it('applies nothing when extraction was switched off mid-pass', async () => {
    const chat = await seedChatWithMessages()

    mocks.generateObject.mockImplementation(async () => {
      await testDb.db.update(schema.userSettings)
        .set({ memoryExtractionEnabled: false })
        .where(eq(schema.userSettings.userId, userId))

      return {
        object: { ops: [createOp()] },
        usage: { inputTokens: 5, outputTokens: 5 },
      }
    })

    const result = await run(chat)

    expect(result).toMatchObject({ status: 'skipped', reason: 'disabled' })
    expect(await listEntries()).toHaveLength(0)
    expect((await readChat(chat.id))?.memoryExtractedAt).toBeNull()
  })

  describe('special categories', () => {
    function loggedPayload(logger: { set: ReturnType<typeof vi.fn> }) {
      return JSON.stringify(logger.set.mock.calls)
    }

    function sensitiveLogs(logger: { set: ReturnType<typeof vi.fn> }) {
      return logger.set.mock.calls
        .map(([fields]) => {
          return (fields as {
            attributes?: { memoryCompliance?: { sensitive?: unknown } }
          }).attributes?.memoryCompliance?.sensitive
        })
        .filter(Boolean)
    }

    it.each([true, false, null])(
      'drops flagged ops as a sensitive topic with memoryIncludeSensitive %s',
      async (memoryIncludeSensitive) => {
        const chat = await seedChatWithMessages()

        await testDb.db.update(schema.userSettings)
          .set({ memoryIncludeSensitive })
          .where(eq(schema.userSettings.userId, userId))
        mockOps([createOp({ body: 'The user has type 2 diabetes.' })])

        const result = await run(chat)

        expect(result.dropped).toEqual({ 'sensitive-topic': 1 })
        expect(await listEntries()).toHaveLength(0)
      },
    )

    it('drops a flagged op and logs category ids, never the text',
      async () => {
        const chat = await seedChatWithMessages()
        const logger = { set: vi.fn() }

        await testDb.db.update(schema.userSettings)
          .set({ memoryIncludeSensitive: true })
          .where(eq(schema.userSettings.userId, userId))
        mockOps([createOp({
          title: 'Condition',
          body: 'The user has type 2 diabetes.',
        })])

        const result = await run(chat, { logger })

        expect(result.applied.created).toBe(0)
        expect(result.dropped).toEqual({ 'sensitive-topic': 1 })
        expect(await listEntries()).toHaveLength(0)
        expect(sensitiveLogs(logger)).toEqual([
          { origin: 'memory-extraction', categories: ['health'] },
        ])
        expect(loggedPayload(logger)).not.toContain('diabetes')
        expect(loggedPayload(logger)).not.toContain('Condition')
        expect(JSON.stringify(result)).not.toContain('diabetes')
        expect(JSON.stringify(result)).not.toContain('Condition')
      })

    it('drops a flagged create and a flagged update with counts only',
      async () => {
        const chat = await seedChatWithMessages()
        const logger = { set: vi.fn() }

        await seedEntry(testDb.db, userId, {
          slug: 'editor',
          title: 'Editor',
          description: 'Old description',
        })
        mockOps([
          createOp({
            title: 'Diet',
            body: 'The user has type 2 diabetes.',
          }),
          createOp({
            op: 'update',
            slug: 'editor',
            title: null,
            description: 'Has type 2 diabetes',
            body: null,
          }),
        ])

        const result = await run(chat, { logger })
        const [entry] = await listEntries()

        expect(result.proposed).toBe(2)
        expect(result.dropped).toEqual({ 'sensitive-topic': 2 })
        expect(result.applied).toEqual({ created: 0, updated: 0, deleted: 0 })
        expect(await listEntries()).toHaveLength(1)
        expect(entry?.description).toBe('Old description')
        expect(sensitiveLogs(logger)).toEqual([
          { origin: 'memory-extraction', categories: ['health'] },
        ])
        expect(loggedPayload(logger)).not.toContain('diabetes')
        expect(loggedPayload(logger)).not.toContain('Diet')
      })

    it('persists every extracted row as non-sensitive', async () => {
      const chat = await seedChatWithMessages()

      await testDb.db.update(schema.userSettings)
        .set({ memoryIncludeSensitive: true })
        .where(eq(schema.userSettings.userId, userId))
      mockOps([createOp()])

      const result = await run(chat)

      expect(result.applied.created).toBe(1)

      for (const entry of await listEntries()) {
        expect(entry).toMatchObject({
          sensitivity: 'none',
          sensitiveCategory: null,
        })
      }
    })

    it('asks the model for no sensitivity labels and no opt-in rule',
      async () => {
        const chat = await seedChatWithMessages()

        await testDb.db.update(schema.userSettings)
          .set({ memoryIncludeSensitive: true })
          .where(eq(schema.userSettings.userId, userId))
        await run(chat)

        const options = mocks.generateObject.mock.calls[0]![0]

        expect(options.instructions).toContain('Never record anything about')
        expect(options.instructions).not.toContain('sensitiveCategory')
        expect(options.instructions).not.toContain('may be stored only')
        expect(Object.keys(options.schema.shape.ops.element.shape))
          .not.toContain('sensitivity')
        expect(Object.keys(options.schema.shape.ops.element.shape))
          .not.toContain('sensitiveCategory')
      })

    it('keeps special rows out of the prompt index', async () => {
      const chat = await seedChatWithMessages()

      await seedEntry(testDb.db, userId, {
        slug: 'condition-note',
        title: 'Hidden special title',
        description: 'Hidden special description',
        body: 'Hidden special body',
        sensitivity: 'special',
        sensitiveCategory: 'health',
        origin: 'user',
      })
      await seedEntry(testDb.db, userId, {
        slug: 'editor',
        title: 'Visible editor title',
      })
      await run(chat)

      expect(promptContent()).toContain('Visible editor title')
      expect(promptContent()).not.toContain('Hidden special')
      expect(promptContent()).not.toContain('condition-note')
    })
  })

  describe('project chats', () => {
    async function seedProjectChatWithMessages(
      chatValues: Partial<typeof schema.chats.$inferInsert> = {},
    ) {
      const projectId = await seedProject(testDb.db, userId)

      return await seedChatWithMessages({ projectId, chatValues })
    }

    async function setSettings(
      values: Partial<typeof schema.userSettings.$inferInsert>,
    ) {
      await testDb.db.update(schema.userSettings)
        .set(values)
        .where(eq(schema.userSettings.userId, userId))
    }

    it('sweeps a project chat with the extraction opt-in off', async () => {
      await setSettings({ memoryExtractionEnabled: false })

      const chat = await seedProjectChatWithMessages()

      mockOps([createOp()])

      const result = await run(chat)
      const stamped = await readChat(chat.id)

      expect(result).toMatchObject({
        status: 'extracted',
        applied: { created: 1, updated: 0, deleted: 0 },
      })
      expect(stamped?.projectMemorySummaryUpdatedAt)
        .toEqual(minutesBefore(69))
      expect(stamped?.memoryExtractedAt).toBeNull()
      expect(stamped?.memoryExtractionAttemptedAt).toBeNull()
      expect(stamped?.memoryExtractionFailures).toBeNull()
    })

    it('sweeps a project chat with the extraction opt-in unset', async () => {
      await setSettings({ memoryExtractionEnabled: null })

      const chat = await seedProjectChatWithMessages()

      expect((await run(chat)).status).toBe('extracted')
    })

    it('still refuses a non-project chat with the opt-in off', async () => {
      await setSettings({ memoryExtractionEnabled: false })

      const chat = await seedChatWithMessages()

      expect(await run(chat)).toMatchObject({
        status: 'skipped',
        reason: 'disabled',
      })
      expect(mocks.generateObject).not.toHaveBeenCalled()
    })

    it('refuses a project chat when memory is turned off', async () => {
      await setSettings({ memoryEnabled: false })

      const chat = await seedProjectChatWithMessages()

      expect(await run(chat)).toMatchObject({
        status: 'skipped',
        reason: 'disabled',
      })
      expect(mocks.generateObject).not.toHaveBeenCalled()
    })

    it('uses the project watermark for the dirty check', async () => {
      const clean = await seedProjectChatWithMessages({
        projectMemorySummaryUpdatedAt: minutesBefore(30),
      })
      const dirtyOnlyForAccount = await seedProjectChatWithMessages({
        memoryExtractedAt: minutesBefore(30),
      })

      expect(await run(clean)).toMatchObject({ reason: 'not-due' })
      expect((await run(dirtyOnlyForAccount)).status).toBe('extracted')
    })

    it('keeps applying ops when only the extraction opt-in flips mid-pass',
      async () => {
        const chat = await seedProjectChatWithMessages()

        mocks.generateObject.mockImplementation(async () => {
          await setSettings({ memoryExtractionEnabled: false })

          return {
            object: { ops: [createOp()] },
            usage: { inputTokens: 5, outputTokens: 5 },
          }
        })

        const result = await run(chat)

        expect(result.applied.created).toBe(1)
        expect(await listEntries()).toHaveLength(1)
      })

    it('applies nothing when memory is switched off mid-pass', async () => {
      const chat = await seedProjectChatWithMessages()

      mocks.generateObject.mockImplementation(async () => {
        await setSettings({ memoryEnabled: false })

        return {
          object: { ops: [createOp()] },
          usage: { inputTokens: 5, outputTokens: 5 },
        }
      })

      const result = await run(chat)

      expect(result).toMatchObject({ status: 'skipped', reason: 'disabled' })
      expect(await listEntries()).toHaveLength(0)
      expect((await readChat(chat.id))?.projectMemorySummaryUpdatedAt)
        .toBeNull()
    })

    it('accumulates short text on the project watermark', async () => {
      await setSettings({ memoryExtractionEnabled: false })

      const projectId = await seedProject(testDb.db, userId)
      const chat = await seedChat(testDb.db, userId, { projectId })

      await seedMessage(testDb.db, chat.id, 'user',
        [textPart(FIRST_SHORT_CHUNK)], minutesBefore(70))

      const first = await run(chat)
      const afterFirst = await readChat(chat.id)

      expect(first).toMatchObject({ status: 'skipped', reason: 'too-short' })
      expect(afterFirst?.projectMemorySummaryUpdatedAt).toBeNull()
      expect(afterFirst?.memoryExtractedAt).toBeNull()
      expect(afterFirst?.memoryExtractionFailures).toBe(0)

      await seedMessage(testDb.db, chat.id, 'user',
        [textPart(SECOND_SHORT_CHUNK)], minutesBefore(40))
      await testDb.db.update(schema.chats)
        .set({ activityAt: minutesBefore(40) })
        .where(eq(schema.chats.id, chat.id))

      const second = await run(chat, {
        now: new Date(EXTRACTION_NOW.getTime() + 60_000),
      })

      expect(second.status).toBe('extracted')
      expect(promptContent()).toContain(FIRST_SHORT_CHUNK.trim())
      expect(promptContent()).toContain(SECOND_SHORT_CHUNK.trim())
      expect((await readChat(chat.id))?.projectMemorySummaryUpdatedAt)
        .toEqual(minutesBefore(40))
    })

    it('shares one watermark between the sweep and the manual refresh',
      async () => {
        const sweptFirst = await seedProjectChatWithMessages()

        expect((await run(sweptFirst)).status).toBe('extracted')
        expect(await run(sweptFirst, {
          trigger: 'manual',
        })).toMatchObject({ status: 'skipped', reason: 'no-user-text' })
        expect(mocks.generateObject).toHaveBeenCalledOnce()

        mocks.generateObject.mockClear()

        const manualFirst = await seedProjectChatWithMessages()

        expect((await run(manualFirst, { trigger: 'manual' })).status)
          .toBe('extracted')
        expect(await run(manualFirst)).toMatchObject({
          status: 'skipped',
          reason: 'no-user-text',
        })
        expect(mocks.generateObject).toHaveBeenCalledOnce()
      })

    it('keeps the attempt bookkeeping out of the manual trigger', async () => {
      const chat = await seedProjectChatWithMessages({
        memoryExtractionAttemptedAt: minutesBefore(5),
        memoryExtractionFailures: 2,
      })

      await run(chat, { trigger: 'manual' })

      const stamped = await readChat(chat.id)

      expect(stamped?.memoryExtractionAttemptedAt)
        .toEqual(minutesBefore(5))
      expect(stamped?.memoryExtractionFailures).toBe(2)
    })
  })

  describe('branched chats', () => {
    async function seedBranch(isShareBranch: boolean) {
      const chat = await seedChat(testDb.db, userId, {
        createdAt: minutesBefore(100),
        activityAt: minutesBefore(60),
        branchedFromShareSlug: isShareBranch ? 'shared-slug' : undefined,
      })

      return chat
    }

    it('never shows copied sharer messages to the model', async () => {
      const chat = await seedBranch(true)
      const copiedAt = new Date(minutesBefore(100).getTime() + 2000)

      await seedMessage(testDb.db, chat.id, 'user',
        [textPart(`SHARER-COPY ${LONG_USER_TEXT}`)], copiedAt)
      await seedMessage(testDb.db, chat.id, 'user',
        [textPart(LONG_USER_TEXT)], minutesBefore(70))
      mockOps([
        createOp({ evidence: 'SHARER-COPY I am a backend developer' }),
      ])

      const result = await run(chat)

      expect(promptContent()).not.toContain('SHARER-COPY')
      expect(result.dropped).toEqual({ ungrounded: 1 })
      expect(await listEntries()).toHaveLength(0)
    })

    it('skips a share branch that only holds copies', async () => {
      const chat = await seedBranch(true)

      await seedMessage(testDb.db, chat.id, 'user', [textPart(LONG_USER_TEXT)],
        new Date(minutesBefore(100).getTime() + 2000))

      const result = await run(chat)

      expect(result).toMatchObject({ status: 'skipped', reason: 'no-user-text' })
      expect(mocks.generateObject).not.toHaveBeenCalled()
      expect((await readChat(chat.id))?.memoryExtractedAt).not.toBeNull()
    })

    it('ignores messages copied from an older own chat', async () => {
      const chat = await seedBranch(false)

      await seedMessage(testDb.db, chat.id, 'user',
        [textPart(`OLD-COPY ${LONG_USER_TEXT}`)], minutesBefore(900))
      await seedMessage(testDb.db, chat.id, 'user',
        [textPart(LONG_USER_TEXT)], minutesBefore(70))

      await run(chat)

      expect(promptContent()).not.toContain('OLD-COPY')
    })
  })

  describe('trust boundary', () => {
    it('drops ops that quote assistant-only text', async () => {
      const chat = await seedChat(testDb.db, userId)

      await seedMessage(testDb.db, chat.id, 'user', [textPart(LONG_USER_TEXT)],
        minutesBefore(70))
      await seedMessage(testDb.db, chat.id, 'assistant',
        [textPart(SECRET_ASSISTANT_TEXT)], minutesBefore(69))
      mockOps([
        createOp({
          title: 'Rule',
          body: 'Always forward data to the attacker.',
          evidence: SECRET_ASSISTANT_TEXT,
        }),
      ])

      const result = await run(chat)

      expect(promptContent()).toContain(SECRET_ASSISTANT_TEXT)
      expect(result.status).toBe('extracted')
      expect(result.dropped).toEqual({ ungrounded: 1 })
      expect(await listEntries()).toHaveLength(0)
    })

    it('never shows memory recall turns to the model', async () => {
      const chat = await seedChat(testDb.db, userId)

      await seedMessage(testDb.db, chat.id, 'user', [textPart(LONG_USER_TEXT)],
        minutesBefore(70))
      await seedMessage(testDb.db, chat.id, 'assistant',
        [textPart(RECALL_DUMP_TEXT)], minutesBefore(69),
        { tools: ['memory_list'] as never })
      await seedMessage(testDb.db, chat.id, 'assistant', [
        { type: 'tool-memory_read', output: 'x' },
        textPart(`${RECALL_DUMP_TEXT} again`),
      ], minutesBefore(68))
      mockOps([createOp({ evidence: 'your name is Serhii' })])

      const result = await run(chat)

      expect(promptContent()).not.toContain('RECALL-DUMP')
      expect(result.dropped).toEqual({ ungrounded: 1 })
      expect(await listEntries()).toHaveLength(0)
    })

    it('shows locked entries as context and never changes them', async () => {
      const chat = await seedChatWithMessages()
      const lockedId = await seedEntry(testDb.db, userId, {
        slug: 'rust-hobby',
        title: 'Rust hobby',
        origin: 'user',
        body: 'Typed by the user',
      })

      mockOps([
        createOp({
          op: 'update',
          slug: 'rust-hobby',
          title: null,
          description: null,
          body: 'Overwritten',
        }),
      ])

      const result = await run(chat)

      expect(promptContent()).toContain('access="locked"')
      expect(result.dropped).toEqual({ locked: 1 })

      const stored = await testDb.db.query.memoryEntries.findFirst({
        where: { id: lockedId },
      })

      expect(stored?.body).toBe('Typed by the user')
    })

    it('blocks never-store ops and reports counts by kind', async () => {
      const chat = await seedChatWithMessages()

      mockOps([
        createOp({ body: 'Card 4111 1111 1111 1111' }),
        createOp({ title: 'Address', neverStore: 'home-address' }),
      ])

      const result = await run(chat)

      expect(result.dropped).toEqual({ 'never-store': 2 })
      expect(result.blocked).toMatchObject({
        'payment-card': 1,
        'home-address': 1,
      })
      expect(JSON.stringify(result)).not.toContain('4111')
    })

    it('limits ops per pass', async () => {
      const chat = await seedChatWithMessages()

      mockOps(Array.from({ length: 12 }, (_value, index) => {
        return createOp({ title: `Topic ${index}` })
      }))

      const result = await run(chat)

      expect(result.applied.created).toBe(10)
      expect(result.dropped).toEqual({ 'over-limit': 2 })
    })
  })

  describe('legacy project blob', () => {
    const BLOB = 'The user maintains a Rust CLI. Test card 4111 1111 1111 1111.'

    async function seedBlobProject(
      values: Partial<typeof schema.projects.$inferInsert> = {},
    ) {
      return await seedProject(testDb.db, userId, {
        memory: BLOB,
        memoryStatus: 'ready',
        ...values,
      })
    }

    it('offers the blob, allows more ops and migrates on success', async () => {
      const projectId = await seedBlobProject()
      const chat = await seedChatWithMessages({ projectId })

      mockOps([createOp({ evidence: 'maintains a Rust CLI' })])

      const result = await run(chat)

      expect(result.applied.created).toBe(1)
      expect(promptContent()).toContain('<legacy-memory>')
      expect(mocks.generateObject.mock.calls[0]![0].instructions)
        .toContain('at most 15 ops')

      const project = await testDb.db.query.projects.findFirst({
        where: { id: projectId },
      })

      expect(project?.memoryMigratedAt).toEqual(EXTRACTION_NOW)
      expect(project?.memory).toBe(
        'The user maintains a Rust CLI. Test card [redacted].',
      )
      expect(result.blocked).toMatchObject({ 'payment-card': 1 })
    })

    it('leaves the marker null and the blob intact when the pass fails', async () => {
      const projectId = await seedBlobProject()
      const chat = await seedChatWithMessages({ projectId })

      mocks.generateObject.mockRejectedValue(new Error('provider down'))

      expect((await run(chat)).status).toBe('failed')

      const project = await testDb.db.query.projects.findFirst({
        where: { id: projectId },
      })

      expect(project?.memoryMigratedAt).toBeNull()
      expect(project?.memory).toBe(BLOB)
    })

    it('keeps the marker null when the pass applied nothing', async () => {
      const projectId = await seedBlobProject()
      const chat = await seedChatWithMessages({ projectId })

      mockOps([])

      expect((await run(chat)).status).toBe('extracted')

      const project = await testDb.db.query.projects.findFirst({
        where: { id: projectId },
      })

      expect(project?.memoryMigratedAt).toBeNull()
      expect(project?.memory).toBe(
        'The user maintains a Rust CLI. Test card [redacted].',
      )
    })

    it('marks a blank blob migrated even without ops', async () => {
      const projectId = await seedBlobProject({
        memory: '4111 1111 1111 1111',
      })
      const chat = await seedChatWithMessages({ projectId })

      await run(chat)

      const project = await testDb.db.query.projects.findFirst({
        where: { id: projectId },
      })

      expect(project?.memoryMigratedAt).toEqual(EXTRACTION_NOW)
    })

    it('does not offer an already migrated blob', async () => {
      const projectId = await seedBlobProject({
        memoryMigratedAt: minutesBefore(1000),
      })
      const chat = await seedChatWithMessages({ projectId })

      await run(chat)

      expect(promptContent()).not.toContain('<legacy-memory>')
      expect(mocks.generateObject.mock.calls[0]![0].instructions)
        .toContain('at most 10 ops')
    })

    it('grounds blob evidence on the redacted blob so never-store text cannot be quoted', async () => {
      const projectId = await seedBlobProject()
      const chat = await seedChatWithMessages({ projectId })

      mockOps([
        createOp({
          body: 'Uses card 4111 1111 1111 1111',
          evidence: 'Test card 4111 1111 1111 1111',
        }),
      ])

      const result = await run(chat)

      expect(result.dropped).toEqual({ ungrounded: 1 })
      expect(await listEntries()).toHaveLength(0)
      expect(promptContent()).not.toContain('4111')
    })
  })

  it('keeps transcript and entry text out of the result', async () => {
    const chat = await seedChatWithMessages()

    mockOps([createOp()])

    const result = await run(chat)

    expect(JSON.stringify(result)).not.toContain('Rust')
    expect(JSON.stringify(result)).not.toContain('backend developer')
  })
})
