import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import { buildDueChatsQuery } from '~~/server/utils/memory/extract-sweep'
import {
  EXTRACTION_NOW,
  createMemoryExtractionTestDb,
  minutesBefore,
  seedChat,
  seedMessage,
  seedProject,
  seedUser,
  textPart,
} from '../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  resolveMemoryModel: vi.fn(),
  acquireMemoryLease: vi.fn(),
  release: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return { ...actual, generateText: mocks.generateText }
})

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

const LONG_USER_TEXT = `I write Rust on weekends. ${'I prefer concise answers. '.repeat(14)}`
const SHORT_USER_TEXT = 'Just a quick question.'
const SECRET_TITLE = 'Secret Rust title'

type ChatValues = Partial<typeof schema.chats.$inferInsert>

describe('sweepMemoryExtraction', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, {
      memoryEnabled: true,
      memoryExtractionEnabledAt: minutesBefore(1000),
    })
    mocks.release.mockResolvedValue(undefined)
    mocks.acquireMemoryLease.mockResolvedValue({ release: mocks.release })
    mocks.resolveMemoryModel.mockImplementation(async () => {
      return {
        scope: 'profile',
        source: 'setting',
        providerId: 'openai',
        gatewayId: null,
        modelId: 'gpt-test',
        modelName: 'GPT',
        instantiate: async () => {
          return { model: {}, reasoning: undefined, providerOptions: {} }
        },
      }
    })
    mocks.generateText.mockResolvedValue({
      output: { ops: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
    })
  })

  afterEach(() => {
    testDb.close()
  })

  async function dueChat(
    values: ChatValues = {},
    owner = userId,
    text = LONG_USER_TEXT,
  ) {
    const chat = await seedChat(testDb.db, owner, {
      activityAt: minutesBefore(60),
      ...values,
    })

    await seedMessage(testDb.db, chat.id, 'user', [textPart(text)],
      minutesBefore(70))

    return chat
  }

  async function sweep(
    options: { batchSize?: number, maxRuntimeMs?: number } = {},
    logger = { set: vi.fn() },
  ) {
    const { sweepMemoryExtraction } = await import(
      '~~/server/utils/memory/extract-sweep'
    )

    return await sweepMemoryExtraction({
      batchSize: options.batchSize ?? 20,
      maxRuntimeMs: options.maxRuntimeMs ?? 60_000,
      logger,
      db: testDb.db,
      now: EXTRACTION_NOW,
    })
  }

  async function wasProcessed(chatId: string) {
    const chat = await testDb.db.query.chats.findFirst({
      where: { id: chatId },
    })

    return chat?.memoryExtractedAt !== null
      || chat?.memoryExtractionAttemptedAt !== null
  }

  async function readChat(chatId: string) {
    return await testDb.db.query.chats.findFirst({ where: { id: chatId } })
  }

  async function readProjectId(chatId: string) {
    return (await readChat(chatId))?.projectId ?? undefined
  }

  describe('selection', () => {
    it('selects a due chat and extracts it', async () => {
      const chat = await dueChat()
      const result = await sweep()

      expect(result).toMatchObject({
        selectedCount: 1,
        extractedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        erroredCount: 0,
        leasedCount: 0,
      })
      expect(await wasProcessed(chat.id)).toBe(true)
    })

    it('requires extraction on and memory not off', async () => {
      const enabledChat = await dueChat()
      const extractionOff = await seedUser(testDb.db, {
        memoryExtractionEnabled: false,
      })
      const memoryOff = await seedUser(testDb.db, { memoryEnabled: false })
      const memoryNull = await seedUser(testDb.db, { memoryEnabled: null })
      const noSettings = await seedUser(testDb.db, null)
      const offChats = [
        await dueChat({}, extractionOff),
        await dueChat({}, memoryOff),
        await dueChat({}, noSettings),
      ]
      const nullChat = await dueChat({}, memoryNull)

      const result = await sweep()

      expect(result.selectedCount).toBe(2)
      expect(await wasProcessed(enabledChat.id)).toBe(true)
      expect(await wasProcessed(nullChat.id)).toBe(true)

      for (const chat of offChats) {
        expect(await wasProcessed(chat.id)).toBe(false)
      }
    })

    it('skips users without a current consent', async () => {
      const consentedChat = await dueChat()
      const noConsent = await seedUser(testDb.db, {
        memoryEnabled: true,
        sensitiveContentConsentAt: null,
        sensitiveContentConsentVersion: null,
      })
      const withdrawn = await seedUser(testDb.db, {
        memoryEnabled: true,
        sensitiveContentConsentWithdrawnAt: minutesBefore(5),
      })
      const oldVersion = await seedUser(testDb.db, {
        memoryEnabled: true,
        sensitiveContentConsentVersion: '2026-10-a',
        termsVersion: '2026-10-a',
      })
      const skippedChats = [
        await dueChat({}, noConsent),
        await dueChat({}, withdrawn),
        await dueChat({}, oldVersion),
      ]

      const result = await sweep()

      expect(result.selectedCount).toBe(1)
      expect(await wasProcessed(consentedChat.id)).toBe(true)

      for (const chat of skippedChats) {
        expect(await wasProcessed(chat.id)).toBe(false)
      }
    })

    it('never selects a chat excluded from memory', async () => {
      const excluded = await dueChat({ memoryExcluded: true })
      const included = await dueChat({ memoryExcluded: false })
      const unset = await dueChat()
      const projectId = await seedProject(testDb.db, userId)
      const excludedProjectChat = await dueChat({
        projectId,
        memoryExcluded: true,
      })

      const result = await sweep()

      expect(result.selectedCount).toBe(2)
      expect(await wasProcessed(excluded.id)).toBe(false)
      expect(await wasProcessed(excludedProjectChat.id)).toBe(false)
      expect(await wasProcessed(included.id)).toBe(true)
      expect(await wasProcessed(unset.id)).toBe(true)
    })

    it('waits for the chat to be idle', async () => {
      const recent = await dueChat({ activityAt: minutesBefore(5) })
      const idle = await dueChat({ activityAt: minutesBefore(11) })

      await sweep()

      expect(await wasProcessed(recent.id)).toBe(false)
      expect(await wasProcessed(idle.id)).toBe(true)
    })

    it('selects only dirty chats', async () => {
      const clean = await dueChat({ memoryExtractedAt: minutesBefore(30) })
      const dirty = await dueChat({ memoryExtractedAt: minutesBefore(90) })

      await sweep()

      expect((await testDb.db.query.chats.findFirst({
        where: { id: clean.id },
      }))?.memoryExtractedAt).toEqual(minutesBefore(30))
      expect(await wasProcessed(dirty.id)).toBe(true)
    })

    it('honours the attempt backoff', async () => {
      const backedOff = await dueChat({
        memoryExtractionAttemptedAt: minutesBefore(10),
      })
      const retry = await dueChat({
        memoryExtractionAttemptedAt: minutesBefore(31),
      })
      const result = await sweep()

      expect(result.selectedCount).toBe(1)
      expect((await testDb.db.query.chats.findFirst({
        where: { id: backedOff.id },
      }))?.memoryExtractedAt).toBeNull()
      expect(await wasProcessed(retry.id)).toBe(true)
    })

    it('parks chats at the failure cap until new activity', async () => {
      const parked = await dueChat({
        memoryExtractionFailures: 3,
        memoryExtractionAttemptedAt: minutesBefore(40),
        activityAt: minutesBefore(50),
      })
      const reactivated = await dueChat({
        memoryExtractionFailures: 3,
        memoryExtractionAttemptedAt: minutesBefore(100),
        activityAt: minutesBefore(60),
      })
      const belowCap = await dueChat({
        memoryExtractionFailures: 2,
        memoryExtractionAttemptedAt: minutesBefore(40),
      })

      const result = await sweep()

      expect(result.selectedCount).toBe(2)
      expect((await testDb.db.query.chats.findFirst({
        where: { id: parked.id },
      }))?.memoryExtractionFailures).toBe(3)
      expect(await wasProcessed(reactivated.id)).toBe(true)
      expect((await testDb.db.query.chats.findFirst({
        where: { id: belowCap.id },
      }))?.memoryExtractedAt).not.toBeNull()
    })

    it('does not reselect an unchanged too-short chat', async () => {
      const waiting = await dueChat({
        memoryExtractionFailures: 0,
        memoryExtractionAttemptedAt: minutesBefore(500),
        activityAt: minutesBefore(600),
      })
      const result = await sweep()

      expect(result.selectedCount).toBe(0)
      expect(await readChat(waiting.id)).toMatchObject({
        memoryExtractedAt: null,
        memoryExtractionFailures: 0,
      })
    })

    it('reselects a too-short chat once new activity arrives', async () => {
      const waiting = await dueChat({
        memoryExtractionFailures: 0,
        memoryExtractionAttemptedAt: minutesBefore(100),
        activityAt: minutesBefore(20),
      })
      const result = await sweep()

      expect(result.selectedCount).toBe(1)
      expect((await readChat(waiting.id))?.memoryExtractedAt).not.toBeNull()
    })

    it('keeps the backoff and cap for failed chats', async () => {
      const backedOff = await dueChat({
        memoryExtractionFailures: 1,
        memoryExtractionAttemptedAt: minutesBefore(10),
        activityAt: minutesBefore(60),
      })
      const retry = await dueChat({
        memoryExtractionFailures: 1,
        memoryExtractionAttemptedAt: minutesBefore(40),
        activityAt: minutesBefore(60),
      })
      const capped = await dueChat({
        memoryExtractionFailures: 3,
        memoryExtractionAttemptedAt: minutesBefore(40),
        activityAt: minutesBefore(50),
      })
      const reactivatedBackedOff = await dueChat({
        memoryExtractionFailures: 3,
        memoryExtractionAttemptedAt: minutesBefore(20),
        activityAt: minutesBefore(15),
      })
      const result = await sweep()

      expect(result.selectedCount).toBe(1)
      expect((await readChat(backedOff.id))?.memoryExtractedAt).toBeNull()
      expect((await readChat(capped.id))?.memoryExtractionFailures).toBe(3)
      expect((await readChat(reactivatedBackedOff.id))?.memoryExtractedAt)
        .toBeNull()
      expect((await readChat(retry.id))?.memoryExtractedAt).not.toBeNull()
    })

    it('retries a crashed pass after the backoff', async () => {
      const recentlyCrashed = await dueChat({
        memoryExtractionAttemptedAt: minutesBefore(10),
        activityAt: minutesBefore(60),
      })
      const crashed = await dueChat({
        memoryExtractionAttemptedAt: minutesBefore(40),
        activityAt: minutesBefore(60),
      })
      const result = await sweep()

      expect(result.selectedCount).toBe(1)
      expect((await readChat(recentlyCrashed.id))?.memoryExtractedAt)
        .toBeNull()
      expect((await readChat(crashed.id))?.memoryExtractedAt).not.toBeNull()
    })

    it('caps the chats taken per user per tick', async () => {
      const otherUser = await seedUser(testDb.db, { memoryEnabled: true })

      for (let index = 0; index < 8; index++) {
        await dueChat({ activityAt: minutesBefore(100 - index) })
      }

      const otherChat = await dueChat({ activityAt: minutesBefore(10 + 1) },
        otherUser)
      const result = await sweep()

      expect(result.selectedCount).toBe(6)
      expect(await wasProcessed(otherChat.id)).toBe(true)
    })

    it('applies the per-user cap in SQL so a busy user cannot fill the pool',
      async () => {
        const otherUser = await seedUser(testDb.db, { memoryEnabled: true })

        for (let index = 0; index < 100; index++) {
          await dueChat({ activityAt: minutesBefore(1000 - index) })
        }

        const otherChat = await dueChat({ activityAt: minutesBefore(15) },
          otherUser)
        const result = await sweep({ batchSize: 10 })

        expect(result.selectedCount).toBe(6)
        expect(await wasProcessed(otherChat.id)).toBe(true)
      })

    it('caps the batch and prefers never-attempted, then oldest activity',
      async () => {
        const users = [
          await seedUser(testDb.db, {}),
          await seedUser(testDb.db, {}),
          await seedUser(testDb.db, {}),
          await seedUser(testDb.db, {}),
        ]
        const attempted = await dueChat({
          memoryExtractionAttemptedAt: minutesBefore(200),
          activityAt: minutesBefore(500),
        }, users[0])
        const newest = await dueChat({ activityAt: minutesBefore(30) },
          users[1])
        const oldestA = await dueChat({ activityAt: minutesBefore(300) },
          users[2])
        const oldestB = await dueChat({ activityAt: minutesBefore(200) },
          users[3])
        const result = await sweep({ batchSize: 2 })

        expect(result.selectedCount).toBe(2)
        expect(await wasProcessed(oldestA.id)).toBe(true)
        expect(await wasProcessed(oldestB.id)).toBe(true)
        expect((await testDb.db.query.chats.findFirst({
          where: { id: newest.id },
        }))?.memoryExtractedAt).toBeNull()
        expect((await testDb.db.query.chats.findFirst({
          where: { id: attempted.id },
        }))?.memoryExtractedAt).toBeNull()
      })

    it('stops when the runtime budget is spent', async () => {
      const first = await dueChat({ activityAt: minutesBefore(200) })
      const second = await dueChat({ activityAt: minutesBefore(100) })

      mocks.generateText.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 80))

        return { output: { ops: [] }, usage: {} }
      })

      const result = await sweep({ maxRuntimeMs: 40 })

      expect(result.selectedCount).toBe(2)
      expect(result.extractedCount).toBe(1)
      expect(await wasProcessed(first.id)).toBe(true)
      expect(await wasProcessed(second.id)).toBe(false)
    })

    it('keeps a short chat waiting without advancing the stamp',
      async () => {
        const chat = await dueChat({}, userId, SHORT_USER_TEXT)
        const first = await sweep()
        const second = await sweep()

        expect(first).toMatchObject({ selectedCount: 1, skippedCount: 1 })
        expect(second.selectedCount).toBe(0)
        expect(mocks.generateText).not.toHaveBeenCalled()
        expect(await readChat(chat.id)).toMatchObject({
          memoryExtractedAt: null,
          memoryExtractionFailures: 0,
        })
      })
  })

  describe('project chats', () => {
    async function projectChat(
      owner = userId,
      projectValues: Partial<typeof schema.projects.$inferInsert> = {},
      values: ChatValues = {},
    ) {
      const projectId = await seedProject(testDb.db, owner, projectValues)

      return await dueChat({ projectId, ...values }, owner)
    }

    async function wasProjectProcessed(chatId: string) {
      const chat = await readChat(chatId)

      return chat?.projectMemorySummaryUpdatedAt !== null
    }

    it('selects nothing while the extraction toggle is off', async () => {
      const toggleOff = await seedUser(testDb.db, {
        memoryEnabled: true,
        memoryExtractionEnabled: false,
        memoryExtractionEnabledAt: minutesBefore(1000),
      })
      const toggleNull = await seedUser(testDb.db, {
        memoryEnabled: true,
        memoryExtractionEnabled: null,
        memoryExtractionEnabledAt: minutesBefore(1000),
      })
      const noSettings = await seedUser(testDb.db, null)
      const chats = []

      for (const owner of [toggleOff, toggleNull, noSettings]) {
        chats.push(await dueChat({}, owner))
        chats.push(await dueChat({ activityAt: minutesBefore(15) }, owner))
        chats.push(await projectChat(owner))
        chats.push(await projectChat(owner, {}, {
          activityAt: minutesBefore(15),
        }))
      }

      const result = await sweep()

      expect(result.selectedCount).toBe(0)
      expect(mocks.generateText).not.toHaveBeenCalled()

      for (const chat of chats) {
        expect(await wasProcessed(chat.id)).toBe(false)
        expect(await wasProjectProcessed(chat.id)).toBe(false)
      }
    })

    it('sweeps project chats of an opted-in user', async () => {
      const chat = await projectChat()
      const result = await sweep()

      expect(result).toMatchObject({ selectedCount: 1, extractedCount: 1 })
      expect(await wasProjectProcessed(chat.id)).toBe(true)
      expect((await readChat(chat.id))?.memoryExtractedAt).toBeNull()
    })

    it('selects only project chats active after the cut-over', async () => {
      const optedIn = await seedUser(testDb.db, {
        memoryEnabled: true,
        memoryExtractionEnabledAt: minutesBefore(50),
      })
      const before = await projectChat(optedIn, {}, {
        activityAt: minutesBefore(60),
      })
      const after = await projectChat(optedIn, {}, {
        activityAt: minutesBefore(40),
      })
      const result = await sweep()

      expect(result.selectedCount).toBe(1)
      expect(await wasProjectProcessed(before.id)).toBe(false)
      expect(await wasProjectProcessed(after.id)).toBe(true)
    })

    it('does not select a project chat when the cut-over was never recorded',
      async () => {
        const legacy = await seedUser(testDb.db, {
          memoryEnabled: true,
          memoryExtractionEnabledAt: null,
        })
        const projectOne = await projectChat(legacy)
        const accountChat = await dueChat({}, legacy)
        const result = await sweep()

        expect(result.selectedCount).toBe(1)
        expect(await wasProjectProcessed(projectOne.id)).toBe(false)
        expect(await wasProcessed(accountChat.id)).toBe(true)
      })

    it('never selects an account chat idle since before the opt-in, even '
      + 'without a stamp', async () => {
      const lateOptIn = await seedUser(testDb.db, {
        memoryEnabled: true,
        memoryExtractionEnabledAt: minutesBefore(50),
      })
      const before = await dueChat({ activityAt: minutesBefore(60) }, lateOptIn)
      const after = await dueChat({ activityAt: minutesBefore(40) }, lateOptIn)
      const result = await sweep()

      expect(result.selectedCount).toBe(1)
      expect(await wasProcessed(before.id)).toBe(false)
      expect(await wasProcessed(after.id)).toBe(true)
    })

    it('keeps selecting account chats of a legacy opt-in without a cut-over',
      async () => {
        const legacy = await seedUser(testDb.db, {
          memoryEnabled: true,
          memoryExtractionEnabledAt: null,
        })
        const accountChat = await dueChat({}, legacy)
        const result = await sweep()

        expect(result.selectedCount).toBe(1)
        expect(await wasProcessed(accountChat.id)).toBe(true)
      })

    it('never reads project chat messages from before the cut-over',
      async () => {
        const optedIn = await seedUser(testDb.db, {
          memoryEnabled: true,
          memoryExtractionEnabledAt: minutesBefore(50),
        })
        const chat = await projectChat(optedIn, {}, {
          activityAt: minutesBefore(20),
        })

        await seedMessage(testDb.db, chat.id, 'user',
          [textPart(`Fresh note. ${'I now prefer tabs. '.repeat(20)}`)],
          minutesBefore(25))

        const result = await sweep()
        const prompt = mocks.generateText.mock.calls[0]![0]
          .messages[0].content as string

        expect(result.extractedCount).toBe(1)
        expect(prompt).toContain('I now prefer tabs.')
        expect(prompt).not.toContain('I write Rust on weekends')
      })

    it('does not create a backfill job when extraction is opted into',
      async () => {
        await dueChat()
        await sweep()

        expect(await testDb.db.select().from(schema.memoryBackfillJobs))
          .toHaveLength(0)
      })

    it('skips a project chat whose project is disabled', async () => {
      const chat = await projectChat(userId, { memoryStatus: 'disabled' })
      const result = await sweep()

      expect(result.selectedCount).toBe(0)
      expect(await wasProjectProcessed(chat.id)).toBe(false)
    })

    it('skips project chats when memory is turned off', async () => {
      const memoryOff = await seedUser(testDb.db, {
        memoryEnabled: false,
        memoryExtractionEnabled: true,
      })
      const chat = await projectChat(memoryOff)
      const result = await sweep()

      expect(result.selectedCount).toBe(0)
      expect(await wasProjectProcessed(chat.id)).toBe(false)
    })

    it('skips a chat pointing at a project of another user', async () => {
      const otherUser = await seedUser(testDb.db, { memoryEnabled: true })
      const foreignProjectId = await seedProject(testDb.db, otherUser)
      const chat = await dueChat({ projectId: foreignProjectId })
      const result = await sweep()

      expect(result.selectedCount).toBe(0)
      expect(await wasProjectProcessed(chat.id)).toBe(false)
      expect(mocks.generateText).not.toHaveBeenCalled()
    })

    it('decides dirtiness on the project watermark only', async () => {
      const clean = await projectChat(userId, {}, {
        projectMemorySummaryUpdatedAt: minutesBefore(30),
      })
      const dirtyOnlyForAccount = await projectChat(userId, {}, {
        memoryExtractedAt: minutesBefore(30),
      })
      const result = await sweep()

      expect(result.selectedCount).toBe(1)
      expect((await readChat(clean.id))?.projectMemorySummaryUpdatedAt)
        .toEqual(minutesBefore(30))
      expect(await wasProjectProcessed(dirtyOnlyForAccount.id)).toBe(true)
    })

    it('keeps the idle window, backoff and per-user cap for project chats',
      async () => {
        const recent = await projectChat(userId, {}, {
          activityAt: minutesBefore(5),
        })
        const backedOff = await projectChat(userId, {}, {
          memoryExtractionAttemptedAt: minutesBefore(5),
        })

        const result = await sweep()

        expect(result.selectedCount).toBe(0)
        expect(await wasProjectProcessed(recent.id)).toBe(false)
        expect(await wasProjectProcessed(backedOff.id)).toBe(false)
      })

    it('keeps a short project chat waiting on the project watermark',
      async () => {
        const projectId = await seedProject(testDb.db, userId)
        const chat = await dueChat({ projectId }, userId, SHORT_USER_TEXT)
        const first = await sweep()
        const second = await sweep()

        expect(first).toMatchObject({ selectedCount: 1, skippedCount: 1 })
        expect(second.selectedCount).toBe(0)
        expect(await readChat(chat.id)).toMatchObject({
          projectMemorySummaryUpdatedAt: null,
          memoryExtractedAt: null,
          memoryExtractionFailures: 0,
        })
      })

    it('does not reprocess the same messages after a manual refresh',
      async () => {
        const chat = await projectChat()
        const { extractChatMemory } = await import(
          '~~/server/utils/memory/extract'
        )

        await extractChatMemory({
          chat,
          userId,
          db: testDb.db,
          trigger: 'manual',
          expectedProjectId: await readProjectId(chat.id),
          now: EXTRACTION_NOW,
        })

        expect(mocks.generateText).toHaveBeenCalledOnce()

        const result = await sweep()

        expect(result).toMatchObject({ selectedCount: 1, skippedCount: 1 })
        expect(mocks.generateText).toHaveBeenCalledOnce()
      })

    it('does not reprocess the same messages when the manual refresh follows',
      async () => {
        const chat = await projectChat()
        const { extractChatMemory } = await import(
          '~~/server/utils/memory/extract'
        )

        await sweep()
        expect(mocks.generateText).toHaveBeenCalledOnce()

        const manual = await extractChatMemory({
          chat,
          userId,
          db: testDb.db,
          trigger: 'manual',
          expectedProjectId: await readProjectId(chat.id),
          now: EXTRACTION_NOW,
        })

        expect(manual).toMatchObject({
          status: 'skipped',
          reason: 'no-user-text',
        })
        expect(mocks.generateText).toHaveBeenCalledOnce()
      })
  })

  describe('query plan', () => {
    function explain() {
      const { sql: statement, params } = buildDueChatsQuery(
        testDb.db,
        20,
        EXTRACTION_NOW,
      ).toSQL()

      return (testDb.sqlite
        .prepare(`explain query plan ${statement}`)
        .all(...params) as { detail: string }[])
        .map(row => row.detail)
    }

    function bulkInsertChats(owner: number, count: number) {
      testDb.sqlite.prepare(`
        with recursive n(i) as (
          select 1 union all select i + 1 from n where i < ?
        )
        insert into chats (created_at, updated_at, slug, user_id, activity_at)
        select ?, ?, 'bulk-' || ? || '-' || i, ?, ? from n
      `).run(
        count,
        Math.floor(minutesBefore(500).getTime() / 1000),
        Math.floor(minutesBefore(500).getTime() / 1000),
        owner,
        owner,
        Math.floor(minutesBefore(120).getTime() / 1000),
      )
    }

    it('starts from the partial opted-in index and reaches chats by the '
      + 'partial due-chats index', () => {
      const plan = explain()

      expect(plan.some((detail) => {
        return /SCAN user_settings USING INDEX idx_user_settings_extraction_enabled/
          .test(detail)
      })).toBe(true)
      expect(plan.some((detail) => {
        return /SEARCH.*chats.*idx_chats_memory_due/.test(detail)
      })).toBe(true)
      expect(plan.some((detail) => {
        return /SCAN (chats|c)\b/.test(detail)
      })).toBe(false)
    })

    it('drives the override arm from projects and reaches chats by the '
      + 'same partial due-chats index, ranged by the project cut-over', () => {
      const plan = explain()

      expect(plan.some(detail => /SCAN projects$/.test(detail))).toBe(true)
      expect(plan.filter((detail) => {
        return /SEARCH chats USING INDEX idx_chats_memory_due \(user_id=\? AND activity_at>\? AND activity_at<\?\)/
          .test(detail)
      })).toHaveLength(2)
    })

    it('ranges the due-chats index from the opt-in cut-over to the idle '
      + 'cutoff, so idle chats from before the opt-in are never read', () => {
      expect(explain().some((detail) => {
        return /idx_chats_memory_due \(user_id=\? AND activity_at>\? AND activity_at<\?\)/
          .test(detail)
      })).toBe(true)
    })

    it('selects nothing without opted-in users however many chats exist',
      async () => {
        const idle = await seedUser(testDb.db, {
          memoryExtractionEnabled: false,
        })
        const unset = await seedUser(testDb.db, null)

        bulkInsertChats(idle, 3000)
        bulkInsertChats(unset, 3000)

        testDb.sqlite.prepare(
          'update user_settings set memory_extraction_enabled = 0',
        ).run()

        const result = await sweep()

        expect(result.selectedCount).toBe(0)
        expect(mocks.generateText).not.toHaveBeenCalled()
        expect(explain().some((detail) => {
          return /SCAN (chats|c)\b/.test(detail)
        })).toBe(false)
      })
  })

  describe('processing', () => {
    it('processes chats sequentially', async () => {
      let running = 0
      let maxRunning = 0

      for (let index = 0; index < 3; index++) {
        await dueChat({ activityAt: minutesBefore(100 - index) })
      }

      mocks.generateText.mockImplementation(async () => {
        running += 1
        maxRunning = Math.max(maxRunning, running)
        await new Promise(resolve => setTimeout(resolve, 10))
        running -= 1

        return { output: { ops: [] }, usage: {} }
      })

      await sweep()

      expect(maxRunning).toBe(1)
    })

    it('skips a leased chat without a model call', async () => {
      const leasedChat = await dueChat({ activityAt: minutesBefore(100) })
      const freeChat = await dueChat({ activityAt: minutesBefore(90) })

      mocks.acquireMemoryLease.mockImplementation(async (key: string) => {
        return key.endsWith(leasedChat.id)
          ? null
          : { release: mocks.release }
      })

      const result = await sweep()

      expect(result).toMatchObject({ leasedCount: 1, extractedCount: 1 })
      expect(mocks.generateText).toHaveBeenCalledOnce()
      expect(await wasProcessed(leasedChat.id)).toBe(false)
      expect(await wasProcessed(freeChat.id)).toBe(true)
    })

    it('counts a failing chat and keeps going', async () => {
      await dueChat({ activityAt: minutesBefore(100) })
      await dueChat({ activityAt: minutesBefore(90) })
      mocks.generateText
        .mockRejectedValueOnce(new Error('provider down'))
        .mockResolvedValueOnce({ output: { ops: [] }, usage: {} })

      const result = await sweep()

      expect(result).toMatchObject({ failedCount: 1, extractedCount: 1 })
    })

    it('survives a pass that throws out of the extractor', async () => {
      await dueChat({ activityAt: minutesBefore(100) })
      await dueChat({ activityAt: minutesBefore(90) })
      mocks.acquireMemoryLease
        .mockRejectedValueOnce(new Error('kv exploded'))
        .mockResolvedValue({ release: mocks.release })

      const result = await sweep()

      expect(result).toMatchObject({ erroredCount: 1, extractedCount: 1 })
    })

    it('stamps the attempt and a failure when a pass throws outright',
      async () => {
        const chat = await dueChat()

        mocks.acquireMemoryLease.mockRejectedValue(new Error('kv exploded'))

        const result = await sweep()
        const stamped = await testDb.db.query.chats.findFirst({
          where: { id: chat.id },
        })

        expect(result.erroredCount).toBe(1)
        expect(stamped?.memoryExtractionAttemptedAt).toEqual(EXTRACTION_NOW)
        expect(stamped?.memoryExtractionFailures).toBe(1)
        expect((await sweep()).selectedCount).toBe(0)
      })

    it('aggregates ops, drops and models across chats', async () => {
      await dueChat({ activityAt: minutesBefore(100) })
      await dueChat({ activityAt: minutesBefore(90) })
      mocks.generateText.mockResolvedValue({
        output: {
          ops: [
            {
              op: 'create',
              category: 'topics',
              slug: null,
              title: SECRET_TITLE,
              description: 'Writes Rust',
              body: 'Writes Rust on weekends.',
              neverStore: null,
              evidence: 'I write Rust on weekends',
            },
            {
              op: 'create',
              category: 'topics',
              slug: null,
              title: 'Made up',
              description: 'Made up',
              body: 'Made up',
              neverStore: null,
              evidence: 'never said by the user',
            },
          ],
        },
        usage: { inputTokens: 10, outputTokens: 5 },
      })

      const result = await sweep()

      expect(result.opsApplied).toEqual({ created: 1, updated: 1, deleted: 0 })
      expect(result.opsDropped).toEqual({ ungrounded: 2 })
      expect(result.models).toEqual([
        {
          source: 'setting',
          providerId: 'openai',
          gatewayId: null,
          modelId: 'gpt-test',
          chats: 2,
        },
      ])
    })

    it('resolves the model once per user and scope within a tick', async () => {
      await dueChat({ activityAt: minutesBefore(100) })
      await dueChat({ activityAt: minutesBefore(90) })
      await dueChat({ activityAt: minutesBefore(80) })

      await sweep()

      expect(mocks.resolveMemoryModel).toHaveBeenCalledOnce()
    })
  })

  describe('logging', () => {
    it('logs counts and ids only', async () => {
      const logger = { set: vi.fn() }

      await dueChat()
      mocks.generateText.mockResolvedValue({
        output: {
          ops: [
            {
              op: 'create',
              category: 'topics',
              slug: null,
              title: SECRET_TITLE,
              description: 'Writes Rust on weekends',
              body: 'Secret Rust body text',
              neverStore: null,
              evidence: 'I write Rust on weekends',
            },
          ],
        },
        usage: { inputTokens: 10, outputTokens: 5 },
      })

      const result = await sweep({}, logger)
      const logged = JSON.stringify([
        ...logger.set.mock.calls,
        result,
      ])

      expect(result.opsApplied.created).toBe(1)
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          memoryExtraction: expect.objectContaining({
            chatsProcessed: 1,
            ops: expect.objectContaining({ proposed: 1 }),
            usage: { inputTokens: 10, outputTokens: 5 },
          }),
        },
      })
      expect(logged).not.toContain(SECRET_TITLE)
      expect(logged).not.toContain('Secret Rust body')
      expect(logged).not.toContain('I write Rust')
      expect(logged).not.toContain('concise answers')
    })
  })
})
