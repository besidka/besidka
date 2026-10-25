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
const SHORT_USER_TEXT = 'I write Rust on weekends. Short note.'
const BLOB = 'The user maintains a Rust CLI. Test card 4111 1111 1111 1111.'
const REDACTED_BLOB = 'The user maintains a Rust CLI. Test card [redacted].'

function createSelection(modelId = 'gpt-test') {
  return {
    scope: 'project',
    source: 'fallback',
    providerId: 'openai',
    gatewayId: null,
    modelId,
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

describe('manual memory extraction', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  async function seedUserWith(
    settings: Partial<typeof schema.userSettings.$inferInsert> | null,
  ) {
    return await seedUser(testDb.db, settings)
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUserWith({
      memoryEnabled: true,
      memoryExtractionEnabled: false,
    })
    mocks.release.mockResolvedValue(undefined)
    mocks.acquireMemoryLease.mockResolvedValue({ release: mocks.release })
    mocks.resolveMemoryModel.mockImplementation(async () => createSelection())
    mockOps([])
  })

  afterEach(() => {
    testDb.close()
  })

  async function seedProjectChat(
    options: {
      projectId?: string
      activityMinutesAgo?: number
      text?: string
      chatValues?: Partial<typeof schema.chats.$inferInsert>
    } = {},
  ) {
    const projectId = options.projectId ?? await seedProject(testDb.db, userId)
    const chat = await seedChat(testDb.db, userId, {
      projectId,
      activityAt: minutesBefore(options.activityMinutesAgo ?? 60),
      ...options.chatValues,
    })

    await seedMessage(
      testDb.db,
      chat.id,
      'user',
      [textPart(options.text ?? LONG_USER_TEXT)],
      minutesBefore(70),
    )

    return { chat, projectId }
  }

  async function runManual(
    chat: { id: string },
    overrides: Record<string, unknown> = {},
  ) {
    const { extractChatMemory } = await import(
      '~~/server/utils/memory/extract'
    )

    const stored = await readChat(chat.id)

    return await extractChatMemory({
      chat,
      userId,
      db: testDb.db,
      logger: { set: vi.fn() },
      now: EXTRACTION_NOW,
      trigger: 'manual',
      ...(stored?.projectId ? { expectedProjectId: stored.projectId } : {}),
      ...overrides,
    })
  }

  async function runSweep(chat: { id: string }) {
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

  async function readChat(chatId: string) {
    return await testDb.db.query.chats.findFirst({ where: { id: chatId } })
  }

  async function readProject(projectId: string) {
    return await testDb.db.query.projects.findFirst({
      where: { id: projectId },
    })
  }

  async function listEntries() {
    return await testDb.db.select().from(schema.memoryEntries)
  }

  describe('trigger gate', () => {
    it('runs with the extraction opt-in off', async () => {
      const { chat } = await seedProjectChat()

      mockOps([createOp()])

      const result = await runManual(chat)

      expect(result).toMatchObject({
        status: 'extracted',
        applied: { created: 1, updated: 0, deleted: 0 },
      })
      expect(await listEntries()).toHaveLength(1)
    })

    it('lets the sweep path run for a project chat with the opt-in off',
      async () => {
        const { chat } = await seedProjectChat()

        mockOps([createOp()])

        const result = await runSweep(chat)

        expect(result).toMatchObject({
          status: 'extracted',
          applied: { created: 1, updated: 0, deleted: 0 },
        })
        expect((await readChat(chat.id))?.projectMemorySummaryUpdatedAt)
          .toEqual(minutesBefore(70))
      })

    it('keeps the sweep path refused for an account chat with the opt-in off',
      async () => {
        const chat = await seedChat(testDb.db, userId)

        await seedMessage(
          testDb.db,
          chat.id,
          'user',
          [textPart(LONG_USER_TEXT)],
          minutesBefore(70),
        )

        const result = await runSweep(chat)

        expect(result).toMatchObject({ status: 'skipped', reason: 'disabled' })
        expect(mocks.generateObject).not.toHaveBeenCalled()
      })

    it('is refused when memory is turned off', async () => {
      const otherUserId = await seedUserWith({ memoryEnabled: false })
      const projectId = await seedProject(testDb.db, otherUserId)
      const chat = await seedChat(testDb.db, otherUserId, { projectId })

      await seedMessage(
        testDb.db,
        chat.id,
        'user',
        [textPart(LONG_USER_TEXT)],
        minutesBefore(70),
      )
      userId = otherUserId

      const result = await runManual(chat)

      expect(result).toMatchObject({ status: 'skipped', reason: 'disabled' })
      expect(mocks.generateObject).not.toHaveBeenCalled()
    })

    it('re-checks memory after the model call', async () => {
      const { chat } = await seedProjectChat()

      mocks.generateObject.mockImplementation(async () => {
        await testDb.db.update(schema.userSettings)
          .set({ memoryEnabled: false })

        return {
          object: { ops: [createOp()] },
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      })

      const result = await runManual(chat)

      expect(result).toMatchObject({ status: 'skipped', reason: 'disabled' })
      expect(await listEntries()).toHaveLength(0)
    })

    it('ignores the idle and dirty rule', async () => {
      const { chat } = await seedProjectChat({
        activityMinutesAgo: 0,
        chatValues: { memoryExtractedAt: EXTRACTION_NOW },
      })

      mockOps([createOp()])

      expect((await runManual(chat)).status).toBe('extracted')
    })
  })

  describe('own watermark', () => {
    it('reads and advances projectMemorySummaryUpdatedAt only', async () => {
      const optInStamp = minutesBefore(1)
      const { chat } = await seedProjectChat({
        chatValues: {
          memoryExtractedAt: optInStamp,
          memoryExtractionAttemptedAt: minutesBefore(5),
          memoryExtractionFailures: 2,
        },
      })

      mockOps([createOp()])

      const result = await runManual(chat)
      const stamped = await readChat(chat.id)

      expect(result.status).toBe('extracted')
      expect(stamped?.projectMemorySummaryUpdatedAt).toEqual(
        minutesBefore(70),
      )
      expect(stamped?.memoryExtractedAt).toEqual(optInStamp)
      expect(stamped?.memoryExtractionAttemptedAt).toEqual(minutesBefore(5))
      expect(stamped?.memoryExtractionFailures).toBe(2)
    })

    it('reads from the watermark, not from the sweep stamp', async () => {
      const { chat } = await seedProjectChat({
        chatValues: { projectMemorySummaryUpdatedAt: minutesBefore(65) },
      })

      await seedMessage(
        testDb.db,
        chat.id,
        'user',
        [textPart(`Newer note. ${LONG_USER_TEXT}`)],
        minutesBefore(40),
      )
      mockOps([])

      await runManual(chat)

      const prompt: string
        = mocks.generateObject.mock.calls[0]![0].messages[0].content

      expect(prompt).toContain('Newer note.')
      expect(prompt).not.toContain(`User: ${USER_SENTENCE}`)
      expect((await readChat(chat.id))?.projectMemorySummaryUpdatedAt)
        .toEqual(minutesBefore(40))
    })

    it('accumulates too-short text without touching any stamp', async () => {
      const { chat } = await seedProjectChat({ text: SHORT_USER_TEXT })

      const result = await runManual(chat)
      const stamped = await readChat(chat.id)

      expect(result).toMatchObject({ status: 'skipped', reason: 'too-short' })
      expect(mocks.generateObject).not.toHaveBeenCalled()
      expect(stamped?.projectMemorySummaryUpdatedAt).toBeNull()
      expect(stamped?.memoryExtractionFailures).toBeNull()
      expect(stamped?.memoryExtractionAttemptedAt).toBeNull()
    })

    it('advances the watermark when there is no user text', async () => {
      const projectId = await seedProject(testDb.db, userId)
      const chat = await seedChat(testDb.db, userId, { projectId })

      await seedMessage(
        testDb.db,
        chat.id,
        'assistant',
        [textPart('Only an assistant turn.')],
        minutesBefore(70),
      )

      const result = await runManual(chat)

      expect(result).toMatchObject({ status: 'skipped', reason: 'no-user-text' })
      expect((await readChat(chat.id))?.projectMemorySummaryUpdatedAt)
        .toBeInstanceOf(Date)
    })

    it('advances the watermark for a disabled project', async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'disabled',
      })
      const { chat } = await seedProjectChat({ projectId })

      const result = await runManual(chat)

      expect(result).toMatchObject({
        status: 'skipped',
        reason: 'project-unavailable',
      })
      expect((await readChat(chat.id))?.projectMemorySummaryUpdatedAt)
        .toBeInstanceOf(Date)
      expect((await readChat(chat.id))?.memoryExtractedAt).toBeNull()
    })

    it('never bumps the failure counter on a failed pass', async () => {
      const { chat } = await seedProjectChat()

      mocks.generateObject.mockRejectedValue(new Error('provider down'))

      const result = await runManual(chat)
      const stamped = await readChat(chat.id)

      expect(result.status).toBe('failed')
      expect(stamped?.memoryExtractionFailures).toBeNull()
      expect(stamped?.memoryExtractionAttemptedAt).toBeNull()
      expect(stamped?.projectMemorySummaryUpdatedAt).toBeNull()
    })
  })

  describe('resolved selection', () => {
    it('skips model resolution and reports the given model', async () => {
      const { chat } = await seedProjectChat()
      const selection = createSelection('given-model')

      const result = await runManual(chat, { selection })

      expect(mocks.resolveMemoryModel).not.toHaveBeenCalled()
      expect(selection.instantiate).toHaveBeenCalledOnce()
      expect(result.model).toMatchObject({ modelId: 'given-model' })
    })
  })

  describe('project row after a sweep pass', () => {
    beforeEach(async () => {
      await testDb.db.update(schema.userSettings)
        .set({ memoryExtractionEnabled: true })
    })

    it('bumps the card metadata when the pass applied ops', async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'stale',
      })
      const { chat } = await seedProjectChat({ projectId })

      mockOps([createOp()])

      const result = await runSweep(chat)
      const project = await readProject(projectId)

      expect(result.applied.created).toBe(1)
      expect(project).toMatchObject({
        memoryStatus: 'ready',
        memoryProvider: 'openai',
        memoryModel: 'gpt-test',
      })
      expect(project?.memoryUpdatedAt).toEqual(EXTRACTION_NOW)
    })

    it('leaves the project row alone when nothing was applied', async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'stale',
      })
      const { chat } = await seedProjectChat({ projectId })

      mockOps([])

      await runSweep(chat)

      expect(await readProject(projectId)).toMatchObject({
        memoryStatus: 'stale',
        memoryUpdatedAt: null,
        memoryModel: null,
      })
    })

    it('does not flip a refreshing project to ready', async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'refreshing',
      })
      const { chat } = await seedProjectChat({ projectId })

      mockOps([createOp()])

      await runSweep(chat)

      expect((await readProject(projectId))?.memoryStatus).toBe('refreshing')
    })

    it('does not touch the profile when the chat has no project', async () => {
      const chat = await seedChat(testDb.db, userId)

      await seedMessage(
        testDb.db,
        chat.id,
        'user',
        [textPart(LONG_USER_TEXT)],
        minutesBefore(70),
      )
      mockOps([createOp()])

      expect((await runSweep(chat)).applied.created).toBe(1)
    })
  })

  describe('blob-only pass', () => {
    async function runBlobPass(
      projectId: string,
      logger: { set: ReturnType<typeof vi.fn> } = { set: vi.fn() },
    ) {
      const { extractProjectLegacyBlob } = await import(
        '~~/server/utils/memory/extract'
      )

      return await extractProjectLegacyBlob({
        projectId,
        userId,
        selection: createSelection() as never,
        db: testDb.db,
        logger,
        now: EXTRACTION_NOW,
      })
    }

    function blobOp(overrides: Partial<MemoryExtractionOp> = {}) {
      return createOp({
        title: 'Rust CLI',
        description: 'Maintains a Rust CLI',
        body: 'The user maintains a Rust CLI.',
        evidence: 'maintains a Rust CLI',
        ...overrides,
      })
    }

    it('creates entries from the blob alone and marks it migrated', async () => {
      const projectId = await seedProject(testDb.db, userId, { memory: BLOB })

      mockOps([blobOp()])

      const result = await runBlobPass(projectId)
      const project = await readProject(projectId)
      const entries = await listEntries()

      expect(result).toMatchObject({
        status: 'migrated',
        applied: { created: 1, updated: 0, deleted: 0 },
      })
      expect(project?.memoryMigratedAt).toEqual(EXTRACTION_NOW)
      expect(project?.memory).toBe(REDACTED_BLOB)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        origin: 'extraction',
        sourceChatIds: [],
      })
      expect(result.blocked).toMatchObject({ 'payment-card': 1 })
    })

    it('sends the blob without any chat transcript text', async () => {
      const projectId = await seedProject(testDb.db, userId, { memory: BLOB })

      await runBlobPass(projectId)

      const options = mocks.generateObject.mock.calls[0]![0]

      expect(options.messages[0].content).toContain('<legacy-memory>')
      expect(options.instructions).toContain('at most 15 ops')
    })

    it('grounds evidence in the blob only', async () => {
      const projectId = await seedProject(testDb.db, userId, { memory: BLOB })

      mockOps([blobOp({ evidence: 'a quote nobody ever wrote anywhere' })])

      const result = await runBlobPass(projectId)

      expect(result.applied.created).toBe(0)
      expect(result.dropped).toEqual({ ungrounded: 1 })
    })

    it('drops flagged blob ops and ignores the sensitive opt-in', async () => {
      await testDb.db.update(schema.userSettings)
        .set({ memoryIncludeSensitive: true })

      const projectId = await seedProject(testDb.db, userId, { memory: BLOB })

      const logger = { set: vi.fn() }

      mockOps([blobOp({ body: 'The user has type 2 diabetes.' })])

      const result = await runBlobPass(projectId, logger)
      const options = mocks.generateObject.mock.calls[0]![0]

      expect(result.applied.created).toBe(0)
      expect(result.dropped).toEqual({ 'sensitive-topic': 1 })
      expect(await listEntries()).toHaveLength(0)
      expect(JSON.stringify(result)).not.toContain('diabetes')
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          memoryCompliance: {
            sensitive: {
              origin: 'memory-extraction',
              categories: ['health'],
            },
          },
        },
      })
      expect(JSON.stringify(logger.set.mock.calls)).not.toContain('diabetes')
      expect(options.instructions).toContain('Never record anything about')
      expect(options.instructions).not.toContain('may be stored only')
    })

    it('persists unflagged blob rows as non-sensitive', async () => {
      const projectId = await seedProject(testDb.db, userId, { memory: BLOB })

      mockOps([blobOp()])
      await runBlobPass(projectId)

      expect((await listEntries())[0]).toMatchObject({
        sensitivity: 'none',
        sensitiveCategory: null,
      })
    })

    it('keeps the marker null and redacts in place when nothing applied', async () => {
      const projectId = await seedProject(testDb.db, userId, { memory: BLOB })

      mockOps([])

      const result = await runBlobPass(projectId)
      const project = await readProject(projectId)

      expect(result.status).toBe('kept')
      expect(project?.memoryMigratedAt).toBeNull()
      expect(project?.memory).toBe(REDACTED_BLOB)
    })

    it('marks a blank blob migrated without calling the model', async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memory: '4111 1111 1111 1111',
      })

      const result = await runBlobPass(projectId)

      expect(result.status).toBe('migrated')
      expect(mocks.generateObject).not.toHaveBeenCalled()
      expect((await readProject(projectId))?.memoryMigratedAt)
        .toEqual(EXTRACTION_NOW)
    })

    it('reports a failed pass without nulling the blob', async () => {
      const projectId = await seedProject(testDb.db, userId, { memory: BLOB })

      mocks.generateObject.mockRejectedValue(new Error('provider down'))

      const result = await runBlobPass(projectId)
      const project = await readProject(projectId)

      expect(result.status).toBe('failed')
      expect(JSON.stringify(result)).not.toContain('provider down')
      expect(project?.memory).toBe(BLOB)
      expect(project?.memoryMigratedAt).toBeNull()
    })

    it('skips an already migrated project', async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memory: BLOB,
        memoryMigratedAt: minutesBefore(1000),
      })

      const result = await runBlobPass(projectId)

      expect(result).toMatchObject({
        status: 'skipped',
        reason: 'no-legacy-memory',
      })
      expect(mocks.generateObject).not.toHaveBeenCalled()
    })

    it('does nothing when memory is turned off', async () => {
      await testDb.db.update(schema.userSettings)
        .set({ memoryEnabled: false })

      const projectId = await seedProject(testDb.db, userId, { memory: BLOB })
      const result = await runBlobPass(projectId)

      expect(result).toMatchObject({ status: 'skipped', reason: 'disabled' })
      expect(mocks.generateObject).not.toHaveBeenCalled()
    })
  })

  describe('project change guard', () => {
    it('refuses a manual pass without an expected project', async () => {
      const { chat } = await seedProjectChat()

      const result = await runManual(chat, { expectedProjectId: undefined })

      expect(result).toMatchObject({
        status: 'skipped',
        reason: 'project-changed',
      })
      expect(mocks.generateObject).not.toHaveBeenCalled()
      expect(mocks.resolveMemoryModel).not.toHaveBeenCalled()
    })

    it('skips a chat moved out of the project without touching any watermark', async () => {
      const { chat, projectId } = await seedProjectChat()

      await testDb.db.update(schema.chats)
        .set({ projectId: null })
        .where(eq(schema.chats.id, chat.id))

      const result = await runManual(chat, { expectedProjectId: projectId })
      const stored = await readChat(chat.id)

      expect(result).toMatchObject({
        status: 'skipped',
        reason: 'project-changed',
      })
      expect(mocks.generateObject).not.toHaveBeenCalled()
      expect(mocks.resolveMemoryModel).not.toHaveBeenCalled()
      expect(stored?.projectMemorySummaryUpdatedAt).toBeNull()
      expect(stored?.memoryExtractedAt).toBeNull()
      expect(await listEntries()).toHaveLength(0)
    })

    it('skips a chat moved to another project', async () => {
      const { chat, projectId } = await seedProjectChat()
      const otherProjectId = await seedProject(testDb.db, userId)

      await testDb.db.update(schema.chats)
        .set({ projectId: otherProjectId })
        .where(eq(schema.chats.id, chat.id))

      const result = await runManual(chat, { expectedProjectId: projectId })

      expect(result).toMatchObject({
        status: 'skipped',
        reason: 'project-changed',
      })
      expect(mocks.generateObject).not.toHaveBeenCalled()
      expect(
        (await readChat(chat.id))?.projectMemorySummaryUpdatedAt,
      ).toBeNull()
    })

    it('skips without writing when the chat moves during the model call', async () => {
      const { chat, projectId } = await seedProjectChat()

      mocks.generateObject.mockImplementation(async () => {
        await testDb.db.update(schema.chats)
          .set({ projectId: null })
          .where(eq(schema.chats.id, chat.id))

        return {
          object: { ops: [createOp()] },
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      })

      const result = await runManual(chat, { expectedProjectId: projectId })

      expect(result).toMatchObject({
        status: 'skipped',
        reason: 'project-changed',
      })
      expect(await listEntries()).toHaveLength(0)
      expect(
        (await readChat(chat.id))?.projectMemorySummaryUpdatedAt,
      ).toBeNull()
    })

    it('honours an expected project for the sweep as well', async () => {
      const { chat } = await seedProjectChat()
      const otherProjectId = await seedProject(testDb.db, userId)
      const { extractChatMemory } = await import(
        '~~/server/utils/memory/extract'
      )

      const result = await extractChatMemory({
        chat,
        userId,
        db: testDb.db,
        now: EXTRACTION_NOW,
        expectedProjectId: otherProjectId,
      })

      expect(result).toMatchObject({
        status: 'skipped',
        reason: 'project-changed',
      })
    })
  })

  describe('blob grounding', () => {
    const RAW_BLOB_QUOTE = 'Test card 4111 1111 1111 1111'

    it('never sends the raw blob in the blob-only pass', async () => {
      const projectId = await seedProject(testDb.db, userId, { memory: BLOB })
      const { extractProjectLegacyBlob } = await import(
        '~~/server/utils/memory/extract'
      )

      await extractProjectLegacyBlob({
        projectId,
        userId,
        selection: createSelection() as never,
        db: testDb.db,
        now: EXTRACTION_NOW,
      })

      const content: string
        = mocks.generateObject.mock.calls[0]![0].messages[0].content

      expect(content).not.toContain('4111')
      expect(content).toContain('Test card [redacted]')
    })

    it('cannot ground a blob create op on never-store text', async () => {
      const projectId = await seedProject(testDb.db, userId, { memory: BLOB })
      const { extractProjectLegacyBlob } = await import(
        '~~/server/utils/memory/extract'
      )

      mockOps([createOp({ evidence: RAW_BLOB_QUOTE })])

      const result = await extractProjectLegacyBlob({
        projectId,
        userId,
        selection: createSelection() as never,
        db: testDb.db,
        now: EXTRACTION_NOW,
      })

      expect(result.applied.created).toBe(0)
      expect(result.dropped).toEqual({ ungrounded: 1 })
    })

    it('drops update and delete ops in the blob-only pass as invalid', async () => {
      const projectId = await seedProject(testDb.db, userId, { memory: BLOB })
      const entryId = await seedEntry(testDb.db, userId, {
        projectId,
        slug: 'seeded',
        title: 'Seeded',
        body: 'Original body text',
      })
      const { extractProjectLegacyBlob } = await import(
        '~~/server/utils/memory/extract'
      )

      mockOps([
        createOp({
          op: 'update',
          slug: 'seeded',
          body: 'Overwritten by the blob',
          evidence: 'maintains a Rust CLI',
        }),
        createOp({
          op: 'delete',
          slug: 'seeded',
          evidence: 'maintains a Rust CLI',
        }),
        createOp({
          title: 'Rust CLI',
          description: 'Maintains a Rust CLI',
          body: 'The user maintains a Rust CLI.',
          evidence: 'maintains a Rust CLI',
        }),
      ])

      const result = await extractProjectLegacyBlob({
        projectId,
        userId,
        selection: createSelection() as never,
        db: testDb.db,
        now: EXTRACTION_NOW,
      })
      const entries = await listEntries()
      const seeded = entries.find(entry => entry.id === entryId)

      expect(result.applied).toEqual({ created: 1, updated: 0, deleted: 0 })
      expect(result.dropped).toEqual({ invalid: 2 })
      expect(result.proposed).toBe(3)
      expect(seeded?.body).toBe('Original body text')
    })

    it('reports whether the blob pass called the model', async () => {
      const blankProjectId = await seedProject(testDb.db, userId, {
        memory: '4111 1111 1111 1111',
      })
      const projectId = await seedProject(testDb.db, userId, { memory: BLOB })
      const { extractProjectLegacyBlob } = await import(
        '~~/server/utils/memory/extract'
      )
      const run = async (id: string) => {
        return await extractProjectLegacyBlob({
          projectId: id,
          userId,
          selection: createSelection() as never,
          db: testDb.db,
          now: EXTRACTION_NOW,
        })
      }

      expect((await run(blankProjectId)).modelCalled).toBe(false)
      expect((await run(projectId)).modelCalled).toBe(true)

      mocks.generateObject.mockRejectedValue(new Error('provider down'))

      const failedProjectId = await seedProject(testDb.db, userId, {
        memory: BLOB,
      })

      expect(await run(failedProjectId)).toMatchObject({
        status: 'failed',
        modelCalled: true,
      })
    })

    it('sends the redacted blob and keeps update ops off blob evidence in a sweep pass', async () => {
      await testDb.db.update(schema.userSettings)
        .set({ memoryExtractionEnabled: true })

      const projectId = await seedProject(testDb.db, userId, { memory: BLOB })
      const { chat } = await seedProjectChat({ projectId })
      const entryId = await seedEntry(testDb.db, userId, {
        projectId,
        slug: 'seeded',
        title: 'Seeded',
        body: 'Original body text',
      })

      mockOps([
        createOp({
          op: 'update',
          slug: 'seeded',
          body: 'Overwritten by the blob',
          evidence: 'maintains a Rust CLI',
        }),
        createOp({
          title: 'Rust CLI',
          description: 'Maintains a Rust CLI',
          body: 'The user maintains a Rust CLI.',
          evidence: 'maintains a Rust CLI',
        }),
      ])

      const result = await runSweep(chat)
      const entries = await listEntries()
      const content: string
        = mocks.generateObject.mock.calls[0]![0].messages[0].content

      expect(content).not.toContain('4111')
      expect(result.dropped).toEqual({ ungrounded: 1 })
      expect(result.applied.created).toBe(1)
      expect(entries.find(entry => entry.id === entryId)?.body)
        .toBe('Original body text')
    })
  })

  describe('sweep bump status', () => {
    beforeEach(async () => {
      await testDb.db.update(schema.userSettings)
        .set({ memoryExtractionEnabled: true })
    })

    it('keeps the project stale while a dirty marker is set and clears the error', async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'stale',
        memoryDirtyAt: minutesBefore(5),
        memoryError: 'Error',
      })
      const { chat } = await seedProjectChat({ projectId })

      mockOps([createOp()])

      await runSweep(chat)

      const project = await readProject(projectId)

      expect(project?.memoryStatus).toBe('stale')
      expect(project?.memoryError).toBeNull()
      expect(project?.memoryDirtyAt).toEqual(minutesBefore(5))
    })

    it('settles to ready without a dirty marker', async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'failed',
        memoryError: 'Error',
      })
      const { chat } = await seedProjectChat({ projectId })

      mockOps([createOp()])

      await runSweep(chat)

      expect(await readProject(projectId)).toMatchObject({
        memoryStatus: 'ready',
        memoryError: null,
      })
    })
  })
})
