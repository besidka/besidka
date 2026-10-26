import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import * as schema from '~~/server/db/schema'
import {
  EXTRACTION_NOW,
  createMemoryExtractionTestDb,
  minutesBefore,
  seedChat,
  seedKey,
  seedMessage,
  seedProject,
  seedUser,
  textPart,
} from '../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../setup/helpers/memory-extraction-db'
import { seedBackfillJob } from '../../../setup/helpers/memory-backfill-db'

const mocks = vi.hoisted(() => ({
  extractChatMemory: vi.fn(),
  resolveMemoryModel: vi.fn(),
  getBackfillEstimate: vi.fn(),
  invalidateBackfillEstimate: vi.fn(),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/memory/extract', () => ({
  extractChatMemory: mocks.extractChatMemory,
}))

vi.mock('~~/server/utils/memory/backfill-estimate', () => ({
  getBackfillEstimate: mocks.getBackfillEstimate,
  invalidateBackfillEstimate: mocks.invalidateBackfillEstimate,
}))

vi.mock('~~/server/utils/memory/resolve-model', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/memory/resolve-model')
  >()

  return { ...original, resolveMemoryModel: mocks.resolveMemoryModel }
})

const SECRET_TITLE = 'Secret chat title'
const SECRET_TEXT = 'secret user text'

const ESTIMATE = {
  chats: 3,
  userChars: 900,
  transcriptChars: 1800,
  inputTokens: 100,
  outputTokens: 10,
  overheadTokensPerChat: 50,
  pricePerMillion: null,
  costUsd: null,
  approximate: true,
  model: {
    source: 'setting',
    providerId: 'openai',
    gatewayId: null,
    modelId: 'gpt-test',
    modelName: 'GPT Test',
  },
}

function extractionResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 'extracted',
    applied: { created: 1, updated: 0, deleted: 0 },
    dropped: {},
    blocked: {},
    model: null,
    messages: 2,
    userChars: 400,
    proposed: 1,
    usage: { inputTokens: 1, outputTokens: 1 },
    ...overrides,
  }
}

describe('memory backfill', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let logger: { set: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, { memoryEnabled: true })
    await seedKey(testDb.db, userId, 'openai')
    logger = { set: vi.fn() }
    mocks.invalidateBackfillEstimate.mockResolvedValue(undefined)
    mocks.getBackfillEstimate.mockResolvedValue(ESTIMATE)
    mocks.extractChatMemory.mockResolvedValue(extractionResult())
    mocks.resolveMemoryModel.mockResolvedValue({
      scope: 'profile',
      source: 'setting',
      providerId: 'openai',
      gatewayId: null,
      modelId: 'gpt-test',
      modelName: 'GPT Test',
      instantiate: vi.fn(),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    testDb.close()
  })

  async function chat(
    minutesAgo: number,
    owner = userId,
    values: Partial<typeof schema.chats.$inferInsert> = {},
  ) {
    const created = await seedChat(testDb.db, owner, {
      createdAt: minutesBefore(1000),
      activityAt: minutesBefore(minutesAgo),
      title: SECRET_TITLE,
      ...values,
    })

    await seedMessage(testDb.db, created.id, 'user', [textPart(SECRET_TEXT)],
      minutesBefore(minutesAgo + 1))

    return created
  }

  async function start(owner = userId) {
    const { startBackfill } = await import('~~/server/utils/memory/backfill')

    return await startBackfill({
      userId: owner,
      db: testDb.db,
      logger,
      now: EXTRACTION_NOW,
    })
  }

  async function advance(
    jobId: string,
    options: {
      chatsLimit?: number
      deadlineMs?: number
      owner?: number
      isInteractive?: boolean
    } = {},
  ) {
    const { advanceBackfill } = await import('~~/server/utils/memory/backfill')

    return await advanceBackfill({
      job: { id: jobId, userId: options.owner ?? userId },
      chatsLimit: options.chatsLimit ?? 2,
      deadlineMs: options.deadlineMs ?? 60_000,
      isInteractive: options.isInteractive,
      db: testDb.db,
      logger,
    })
  }

  async function readJob(jobId: string) {
    return await testDb.db.query.memoryBackfillJobs.findFirst({
      where: { id: jobId },
    })
  }

  function processedChatIds(): string[] {
    return mocks.extractChatMemory.mock.calls.map((call) => {
      return (call[0] as { chat: { id: string } }).chat.id
    })
  }

  describe('startBackfill', () => {
    it('refuses with a 409 and a fix when memory is off', async () => {
      await testDb.db.update(schema.userSettings)
        .set({ memoryEnabled: false })
        .where(eq(schema.userSettings.userId, userId))

      await expect(start()).rejects.toMatchObject({
        status: 409,
        fix: expect.any(String),
      })
      expect(mocks.resolveMemoryModel).not.toHaveBeenCalled()
    })

    it('refuses when automatic memory updates are off', async () => {
      await testDb.db.update(schema.userSettings)
        .set({ memoryExtractionEnabled: false })
        .where(eq(schema.userSettings.userId, userId))

      await expect(start()).rejects.toMatchObject({ status: 409 })
    })

    it('refuses a user without a settings row', async () => {
      const withoutSettings = await seedUser(testDb.db, null)

      await expect(start(withoutSettings)).rejects.toMatchObject({
        status: 409,
      })
    })

    it('refuses when no model can run memory work', async () => {
      mocks.resolveMemoryModel.mockResolvedValue(null)

      await expect(start()).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('No saved API key'),
      })
      expect(await testDb.db.query.memoryBackfillJobs.findMany()).toEqual([])
    })

    it('resolves the profile model once and stores the job', async () => {
      await chat(10)
      await chat(20)

      const progress = await start()

      expect(mocks.resolveMemoryModel).toHaveBeenCalledTimes(1)
      expect(mocks.resolveMemoryModel).toHaveBeenCalledWith(
        expect.objectContaining({ userId, scope: 'profile' }),
      )
      expect(progress).toMatchObject({
        status: 'running',
        totalChats: 2,
        processedChats: 0,
        createdEntries: 0,
        updatedEntries: 0,
        skippedChats: 0,
        failedChats: 0,
        dropped: {},
        finishedAt: null,
        model: {
          source: 'setting',
          providerId: 'openai',
          gatewayId: null,
          modelId: 'gpt-test',
        },
        estimate: ESTIMATE,
      })
      expect(mocks.getBackfillEstimate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          window: {
            createdBefore: EXTRACTION_NOW,
            cursor: null,
            isContinuation: false,
          },
        }),
      )
    })

    it('counts only eligible chats in the total', async () => {
      const otherUser = await seedUser(testDb.db, { memoryEnabled: true })
      const projectId = await seedProject(testDb.db, userId)

      await chat(10)
      await chat(10, otherUser)
      await chat(10, userId, { projectId })
      await seedChat(testDb.db, userId, { createdAt: minutesBefore(1000) })
      await chat(10, userId, {
        createdAt: new Date(EXTRACTION_NOW.getTime() + 5000),
      })

      expect((await start()).totalChats).toBe(1)
    })

    it('leaves chats excluded from memory out of the total', async () => {
      await chat(10)
      await chat(20, userId, { memoryExcluded: false })
      await chat(30, userId, { memoryExcluded: true })

      expect((await start()).totalChats).toBe(2)
    })

    it('caps the total at the newest backfillMaxChats chats', async () => {
      for (let index = 0; index <= MEMORY_LIMITS.backfillMaxChats; index++) {
        await chat(10 + index)
      }

      expect((await start()).totalChats).toBe(MEMORY_LIMITS.backfillMaxChats)
    })

    it('answers a second start with a 409 while one is running', async () => {
      await chat(10)
      await start()

      await expect(start()).rejects.toMatchObject({
        status: 409,
        message: 'A backfill is already running',
      })
      expect(await testDb.db.query.memoryBackfillJobs.findMany())
        .toHaveLength(1)
    })

    it('lets a different user run their own job', async () => {
      const otherUser = await seedUser(testDb.db, { memoryEnabled: true })

      await chat(10)
      await start()

      expect((await start(otherUser)).status).toBe('completed')
    })

    it('allows a new start after the previous job was cancelled', async () => {
      const { cancelBackfill } = await import('~~/server/utils/memory/backfill')

      await chat(10)
      await start()
      await cancelBackfill({ userId, db: testDb.db })

      expect((await start()).status).toBe('running')
    })

    it('completes immediately when there is nothing to process', async () => {
      const progress = await start()

      expect(progress).toMatchObject({
        status: 'completed',
        totalChats: 0,
      })
      expect(progress.finishedAt).not.toBeNull()
    })

    it('keeps the job when the estimate fails', async () => {
      await chat(10)
      mocks.getBackfillEstimate.mockRejectedValue(new Error(SECRET_TEXT))

      const progress = await start()

      expect(progress.estimate).toBeNull()
      expect(JSON.stringify(logger.set.mock.calls))
        .not.toContain(SECRET_TEXT)
    })

    it('logs counts and ids, never chat text or titles', async () => {
      await chat(10)
      await start()

      const logged = JSON.stringify(logger.set.mock.calls)

      expect(logged).toContain('totalChats')
      expect(logged).not.toContain(SECRET_TITLE)
      expect(logged).not.toContain(SECRET_TEXT)
    })
  })

  describe('advanceBackfill', () => {
    it('processes chats newest first as backfill extractions', async () => {
      const oldest = await chat(300)
      const newest = await chat(10)
      const middle = await chat(100)
      const progress = await start()

      await advance(progress.id, { chatsLimit: 5 })

      expect(processedChatIds()).toEqual([newest.id, middle.id, oldest.id])
      expect(mocks.extractChatMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          chat: { id: newest.id },
          userId,
          trigger: 'backfill',
          ignoreIdle: true,
          selection: expect.objectContaining({
            scope: 'profile',
            source: 'setting',
            providerId: 'openai',
            modelId: 'gpt-test',
            modelName: 'GPT Test',
            instantiate: expect.any(Function),
          }),
        }),
      )
    })

    it('never visits a chat excluded from memory', async () => {
      const included = await chat(10)
      const excluded = await chat(20, userId, { memoryExcluded: true })
      const progress = await start()

      await advance(progress.id, { chatsLimit: 5 })

      expect(processedChatIds()).toEqual([included.id])
      expect(processedChatIds()).not.toContain(excluded.id)
    })

    it('breaks ties on equal activity by newest id first', async () => {
      const first = await chat(50)
      const second = await chat(50)
      const progress = await start()

      await advance(progress.id, { chatsLimit: 5 })

      expect(processedChatIds()).toEqual([second.id, first.id])
    })

    it('advances the cursor across steps and completes at the end',
      async () => {
        const chats = []

        for (const minutes of [10, 20, 30, 40, 50]) {
          chats.push(await chat(minutes))
        }

        const progress = await start()
        const first = await advance(progress.id, { chatsLimit: 2 })

        expect(first.chatsProcessed).toBe(2)
        expect(first.job).toMatchObject({
          status: 'running',
          processedChats: 2,
        })

        const second = await advance(progress.id, { chatsLimit: 2 })

        expect(second.job?.processedChats).toBe(4)
        expect(second.job?.status).toBe('running')

        const third = await advance(progress.id, { chatsLimit: 2 })

        expect(third.job).toMatchObject({
          status: 'completed',
          processedChats: 5,
          totalChats: 5,
        })
        expect(third.job?.finishedAt).not.toBeNull()
        expect(processedChatIds()).toEqual(chats.map(entry => entry.id))
      })

    it('completes without an extra step when the batch is the last',
      async () => {
        await chat(10)
        await chat(20)

        const progress = await start()
        const step = await advance(progress.id, { chatsLimit: 2 })

        expect(step.job?.status).toBe('completed')
      })

    it('does nothing for a finished job', async () => {
      await chat(10)

      const progress = await start()

      await advance(progress.id, { chatsLimit: 5 })
      mocks.extractChatMemory.mockClear()

      const step = await advance(progress.id, { chatsLimit: 5 })

      expect(step.chatsProcessed).toBe(0)
      expect(mocks.extractChatMemory).not.toHaveBeenCalled()
    })

    it('does not visit chats created after the job started', async () => {
      await chat(10)

      const progress = await start()
      const late = await chat(1, userId, {
        createdAt: new Date(EXTRACTION_NOW.getTime() + 60_000),
      })

      await advance(progress.id, { chatsLimit: 5 })

      expect(processedChatIds()).not.toContain(late.id)
    })

    it('adds counters and merges drop reasons across chats',
      async () => {
        await chat(10)
        await chat(20)
        await chat(30)
        await chat(40)
        mocks.extractChatMemory
          .mockResolvedValueOnce(extractionResult({
            applied: { created: 2, updated: 1, deleted: 0 },
            dropped: { ungrounded: 1, duplicate: 2 },
          }))
          .mockResolvedValueOnce(extractionResult({
            status: 'skipped',
            reason: 'too-short',
            applied: { created: 0, updated: 0, deleted: 0 },
            dropped: {},
          }))
          .mockResolvedValueOnce(extractionResult({
            status: 'failed',
            reason: 'no-model',
            applied: { created: 0, updated: 0, deleted: 0 },
          }))
          .mockResolvedValueOnce(extractionResult({
            applied: { created: 1, updated: 2, deleted: 0 },
            dropped: { ungrounded: 4 },
          }))

        const progress = await start()
        const step = await advance(progress.id, { chatsLimit: 4 })

        expect(step.job).toMatchObject({
          processedChats: 4,
          createdEntries: 3,
          updatedEntries: 3,
          skippedChats: 1,
          failedChats: 1,
          dropped: { ungrounded: 5, duplicate: 2 },
        })
      })

    it('counts a chat whose extraction throws as failed and goes on',
      async () => {
        await chat(10)
        await chat(20)
        mocks.extractChatMemory
          .mockRejectedValueOnce(new Error(SECRET_TEXT))
          .mockResolvedValueOnce(extractionResult())

        const progress = await start()
        const step = await advance(progress.id, { chatsLimit: 5 })

        expect(step.job).toMatchObject({
          processedChats: 2,
          failedChats: 1,
          status: 'completed',
        })
        expect(JSON.stringify(logger.set.mock.calls))
          .not.toContain(SECRET_TEXT)
      })

    it('retries a leased chat at the next step, then skips it', async () => {
      const newest = await chat(10)
      const older = await chat(20)

      mocks.extractChatMemory.mockResolvedValue(
        extractionResult({ status: 'leased' }),
      )

      const progress = await start()
      const firstStep = await advance(progress.id)

      expect(firstStep.chatsProcessed).toBe(0)
      expect(firstStep.job).toMatchObject({
        status: 'running',
        processedChats: 0,
      })
      expect((await readJob(progress.id))?.retriedChatId).toBe(newest.id)
      expect(processedChatIds()).toEqual([newest.id])

      const secondStep = await advance(progress.id)

      expect(secondStep.job).toMatchObject({
        processedChats: 1,
        skippedChats: 1,
        status: 'running',
      })

      const thirdStep = await advance(progress.id)

      expect(thirdStep.job).toMatchObject({
        processedChats: 2,
        skippedChats: 2,
        status: 'completed',
      })
      expect(processedChatIds()).toEqual([
        newest.id,
        newest.id,
        older.id,
        older.id,
      ])
    })

    it('processes the chat after a leased retry that succeeds', async () => {
      const newest = await chat(10)

      mocks.extractChatMemory
        .mockResolvedValueOnce(extractionResult({ status: 'leased' }))
        .mockResolvedValueOnce(extractionResult())

      const progress = await start()

      await advance(progress.id)

      const step = await advance(progress.id)

      expect(step.job).toMatchObject({
        processedChats: 1,
        skippedChats: 0,
        createdEntries: 1,
      })
      expect((await readJob(progress.id))?.retriedChatId).toBeNull()
      expect(processedChatIds()).toEqual([newest.id, newest.id])
    })

    it('stops starting chats after the deadline', async () => {
      await chat(10)
      await chat(20)

      const progress = await start()
      const step = await advance(progress.id, { deadlineMs: 0 })

      expect(step.chatsProcessed).toBe(0)
      expect(step.job?.status).toBe('running')
      expect(mocks.extractChatMemory).not.toHaveBeenCalled()
    })

    it('stops between chats when the job is cancelled mid-step', async () => {
      const { cancelBackfill } = await import('~~/server/utils/memory/backfill')

      await chat(10)
      await chat(20)
      await chat(30)
      mocks.extractChatMemory.mockImplementation(async () => {
        await cancelBackfill({ userId, db: testDb.db })

        return extractionResult()
      })

      const progress = await start()
      const step = await advance(progress.id, { chatsLimit: 5 })

      expect(mocks.extractChatMemory).toHaveBeenCalledTimes(1)
      expect(step.job?.status).toBe('cancelled')
      expect(step.job?.processedChats).toBe(0)
    })

    it('cancels the job when the pass reports memory disabled', async () => {
      await chat(10)
      await chat(20)
      mocks.extractChatMemory.mockResolvedValue(
        extractionResult({ status: 'skipped', reason: 'disabled' }),
      )

      const progress = await start()
      const step = await advance(progress.id, { chatsLimit: 5 })

      expect(step.job).toMatchObject({
        status: 'cancelled',
        processedChats: 0,
      })
      expect(mocks.extractChatMemory).toHaveBeenCalledTimes(1)
    })

    it('cancels the job at the step start when a flag was switched off',
      async () => {
        await chat(10)

        const progress = await start()

        await testDb.db.update(schema.userSettings)
          .set({ memoryExtractionEnabled: false })
          .where(eq(schema.userSettings.userId, userId))

        const step = await advance(progress.id)

        expect(step.job?.status).toBe('cancelled')
        expect(mocks.extractChatMemory).not.toHaveBeenCalled()
      })

    it('fails the job when the stored model\'s key is gone', async () => {
      await chat(10)

      const progress = await start()

      await testDb.db.delete(schema.keys)
        .where(eq(schema.keys.userId, userId))

      const step = await advance(progress.id)

      expect(step.job?.status).toBe('failed')
      expect(step.job?.finishedAt).not.toBeNull()
      expect(mocks.extractChatMemory).not.toHaveBeenCalled()
    })

    it('checks the gateway key provider for a gateway model', async () => {
      await chat(10)

      const job = await seedBackfillJob(testDb.db, userId, {
        totalChats: 1,
        modelProviderId: null,
        modelGatewayId: 'vercel',
        modelId: 'vendor/model',
      })

      expect((await advance(job.id)).job?.status).toBe('failed')

      const otherUser = await seedUser(testDb.db, { memoryEnabled: true })

      await seedKey(testDb.db, otherUser, 'vercel-gateway')
      await chat(10, otherUser)

      const gatewayJob = await seedBackfillJob(testDb.db, otherUser, {
        totalChats: 1,
        modelProviderId: null,
        modelGatewayId: 'vercel',
        modelId: 'vendor/model',
      })

      expect((await advance(gatewayJob.id, { owner: otherUser })).job?.status)
        .toBe('completed')
    })

    it('fails a job whose model was never stored', async () => {
      await chat(10)

      const job = await seedBackfillJob(testDb.db, userId, {
        modelId: null,
        modelSource: null,
        modelProviderId: null,
      })

      expect((await advance(job.id)).job?.status).toBe('failed')
    })

    it('aborts a job in which most chats fail', async () => {
      for (const minutes of [10, 20, 30, 40, 50, 60]) {
        await chat(minutes)
      }

      mocks.extractChatMemory.mockResolvedValue(extractionResult({
        status: 'failed',
        reason: 'no-model',
        applied: { created: 0, updated: 0, deleted: 0 },
      }))

      const progress = await start()
      const step = await advance(progress.id, { chatsLimit: 5 })

      expect(step.job).toMatchObject({
        status: 'failed',
        failedChats: 5,
        processedChats: 5,
      })
    })

    it('keeps going when only a minority of chats fail', async () => {
      for (const minutes of [10, 20, 30, 40, 50, 60]) {
        await chat(minutes)
      }

      mocks.extractChatMemory
        .mockResolvedValueOnce(extractionResult({ status: 'failed' }))
        .mockResolvedValue(extractionResult())

      const progress = await start()
      const step = await advance(progress.id, { chatsLimit: 5 })

      expect(step.job?.status).toBe('running')
    })

    it('returns busy and touches nothing while the job lease is held',
      async () => {
        await chat(10)

        const progress = await start()

        await testDb.db.update(schema.memoryBackfillJobs)
          .set({ leaseUntil: new Date(Date.now() + 120_000) })
          .where(eq(schema.memoryBackfillJobs.id, progress.id))

        const step = await advance(progress.id)

        expect(step.isBusy).toBe(true)
        expect(step.chatsProcessed).toBe(0)
        expect(step.job?.status).toBe('running')
        expect(mocks.extractChatMemory).not.toHaveBeenCalled()
      })

    it('claims a job whose previous lease has expired', async () => {
      await chat(10)

      const progress = await start()

      await testDb.db.update(schema.memoryBackfillJobs)
        .set({ leaseUntil: new Date(Date.now() - 120_000) })
        .where(eq(schema.memoryBackfillJobs.id, progress.id))

      const step = await advance(progress.id)

      expect(step.isBusy).toBe(false)
      expect(step.chatsProcessed).toBe(1)
    })

    it('lets only one of two simultaneous claimants step the job',
      async () => {
        await chat(10)
        await chat(20)

        const progress = await start()
        const [first, second] = await Promise.all([
          advance(progress.id),
          advance(progress.id),
        ])

        expect([first.isBusy, second.isBusy].sort()).toEqual([false, true])
        expect(mocks.extractChatMemory).toHaveBeenCalledTimes(2)
        expect((await readJob(progress.id))?.leaseUntil).toBeNull()
      })

    it('claims with a lease that outlasts the step plus the model timeout',
      async () => {
        await chat(10)

        let leaseDuringStep = 0
        const progress = await start()

        mocks.extractChatMemory.mockImplementation(async () => {
          const during = await readJob(progress.id)

          leaseDuringStep = during?.leaseUntil?.getTime() ?? 0

          return extractionResult()
        })

        const startedAt = Date.now()

        await advance(progress.id, { deadlineMs: 60_000 })

        expect(leaseDuringStep).toBeGreaterThan(
          startedAt + (60_000 + 150_000) - 2000,
        )
      })

    it('clears the lease after a step, also when the step throws',
      async () => {
        await chat(10)

        const progress = await start()

        await advance(progress.id)
        expect((await readJob(progress.id))?.leaseUntil).toBeNull()

        const otherUser = await seedUser(testDb.db, { memoryEnabled: true })

        await seedKey(testDb.db, otherUser, 'openai')

        const second = await seedBackfillJob(testDb.db, otherUser)

        testDb.sqlite.exec('drop table messages')

        await expect(advance(second.id, { owner: otherUser }))
          .rejects.toBeDefined()
        expect((await readJob(second.id))?.leaseUntil).toBeNull()
      })

    it('never processes another user\'s job or chats', async () => {
      const otherUser = await seedUser(testDb.db, { memoryEnabled: true })

      await chat(10, otherUser)

      const otherJob = await seedBackfillJob(testDb.db, otherUser, {
        totalChats: 1,
      })
      const step = await advance(otherJob.id, { owner: userId })

      expect(step.job).toBeNull()
      expect(mocks.extractChatMemory).not.toHaveBeenCalled()
      expect((await readJob(otherJob.id))?.processedChats).toBe(0)
    })

    it('logs counts and ids, never chat text or titles', async () => {
      await chat(10)
      mocks.extractChatMemory.mockRejectedValueOnce(new Error(SECRET_TEXT))

      const progress = await start()

      await advance(progress.id)

      const logged = JSON.stringify(logger.set.mock.calls)

      expect(logged).not.toContain(SECRET_TITLE)
      expect(logged).not.toContain(SECRET_TEXT)
    })
  })

  describe('spend, failures and attempts', () => {
    const PRICED_ESTIMATE = {
      ...ESTIMATE,
      costUsd: 0.01,
      pricePerMillion: { input: 1, output: 4 },
    }

    async function jobWithChats(
      count: number,
      values: Partial<typeof schema.memoryBackfillJobs.$inferInsert> = {},
    ) {
      for (let index = 0; index < count; index++) {
        await chat(10 + index * 10)
      }

      return await seedBackfillJob(testDb.db, userId, {
        totalChats: count,
        ...values,
      })
    }

    it('accumulates the actual tokens from each pass', async () => {
      const job = await jobWithChats(2)

      mocks.extractChatMemory
        .mockResolvedValueOnce(extractionResult({
          usage: { inputTokens: 30, outputTokens: 5 },
        }))
        .mockResolvedValueOnce(extractionResult({
          usage: { inputTokens: 20, outputTokens: 7 },
        }))

      const step = await advance(job.id)

      expect(step.job).toMatchObject({ inputTokens: 50, outputTokens: 12 })
    })

    it('fails the job when the actual cost exceeds 1.5x a priced estimate',
      async () => {
        const job = await jobWithChats(3, { estimate: PRICED_ESTIMATE })

        mocks.extractChatMemory.mockResolvedValue(extractionResult({
          usage: { inputTokens: 10_000, outputTokens: 5000 },
        }))

        const step = await advance(job.id, { chatsLimit: 3 })

        expect(step.job).toMatchObject({
          status: 'failed',
          failureReason: 'spend-limit',
          processedChats: 1,
        })
        expect(mocks.extractChatMemory).toHaveBeenCalledTimes(1)
      })

    it('keeps going while the actual cost stays within 1.5x', async () => {
      const job = await jobWithChats(2, { estimate: PRICED_ESTIMATE })

      mocks.extractChatMemory.mockResolvedValue(extractionResult({
        usage: { inputTokens: 1000, outputTokens: 1000 },
      }))

      const step = await advance(job.id)

      expect(step.job).toMatchObject({
        status: 'completed',
        failureReason: null,
      })
    })

    it('compares tokens when the estimate has no price', async () => {
      const job = await jobWithChats(2, { estimate: ESTIMATE })

      mocks.extractChatMemory.mockResolvedValue(extractionResult({
        usage: { inputTokens: 100, outputTokens: 100 },
      }))

      const step = await advance(job.id)

      expect(step.job).toMatchObject({
        status: 'failed',
        failureReason: 'spend-limit',
      })
    })

    it('stops at the hard token ceiling when no estimate was stored',
      async () => {
        const job = await jobWithChats(3, { estimate: null })

        mocks.extractChatMemory.mockResolvedValue(extractionResult({
          usage: {
            inputTokens: MEMORY_LIMITS.backfillMaxTokens,
            outputTokens: 0,
          },
        }))

        const step = await advance(job.id, { chatsLimit: 3 })

        expect(step.job).toMatchObject({
          status: 'failed',
          failureReason: 'spend-limit',
          processedChats: 1,
        })
        expect(mocks.extractChatMemory).toHaveBeenCalledTimes(1)
      })

    it('stops at the hard token ceiling even under a generous estimate',
      async () => {
        const job = await jobWithChats(3, {
          estimate: {
            ...ESTIMATE,
            inputTokens: MEMORY_LIMITS.backfillMaxTokens * 10,
            costUsd: null,
            pricePerMillion: null,
          },
        })

        mocks.extractChatMemory.mockResolvedValue(extractionResult({
          usage: {
            inputTokens: MEMORY_LIMITS.backfillMaxTokens / 2,
            outputTokens: 0,
          },
        }))

        const step = await advance(job.id, { chatsLimit: 3 })

        expect(step.job).toMatchObject({
          status: 'failed',
          failureReason: 'spend-limit',
          processedChats: 2,
        })
      })

    it('keeps going under the ceiling when no estimate was stored',
      async () => {
        const job = await jobWithChats(2, { estimate: null })

        mocks.extractChatMemory.mockResolvedValue(extractionResult({
          usage: { inputTokens: 1_000, outputTokens: 100 },
        }))

        expect((await advance(job.id)).job?.status).toBe('completed')
      })

    it('completes once the chat cap is reached, leaving older chats',
      async () => {
        const job = await jobWithChats(3, {
          processedChats: MEMORY_LIMITS.backfillMaxChats - 1,
        })

        mocks.extractChatMemory.mockResolvedValue(extractionResult())

        const step = await advance(job.id, { chatsLimit: 3 })

        expect(step.job).toMatchObject({
          status: 'completed',
          processedChats: MEMORY_LIMITS.backfillMaxChats,
        })
        expect(mocks.extractChatMemory).toHaveBeenCalledTimes(1)
      })

    it('completes without a model call when the cap was already reached',
      async () => {
        const job = await jobWithChats(2, {
          processedChats: MEMORY_LIMITS.backfillMaxChats,
        })

        const step = await advance(job.id)

        expect(step.job?.status).toBe('completed')
        expect(mocks.extractChatMemory).not.toHaveBeenCalled()
      })

    it('fails after five chats fail in a row', async () => {
      const job = await jobWithChats(8, {
        processedChats: 0,
        consecutiveFailures: 3,
        failedChats: 3,
      })

      mocks.extractChatMemory.mockResolvedValue(
        extractionResult({ status: 'failed' }),
      )

      const step = await advance(job.id, { chatsLimit: 5 })

      expect(step.job).toMatchObject({
        status: 'failed',
        failureReason: 'consecutive-failures',
        failedChats: 5,
      })
      expect(mocks.extractChatMemory).toHaveBeenCalledTimes(2)
    })

    it('resets the consecutive count on a successful chat', async () => {
      const job = await jobWithChats(3, { consecutiveFailures: 4 })

      mocks.extractChatMemory.mockResolvedValue(extractionResult())

      await advance(job.id, { chatsLimit: 1 })

      expect((await readJob(job.id))?.consecutiveFailures).toBe(0)
    })

    it('reports failed, not completed, when the last batch tips the failure rate',
      async () => {
        const job = await jobWithChats(1, {
          totalChats: 6,
          processedChats: 5,
          failedChats: 4,
        })

        mocks.extractChatMemory.mockResolvedValue(
          extractionResult({ status: 'failed' }),
        )

        const step = await advance(job.id)

        expect(step.job).toMatchObject({
          status: 'failed',
          failureReason: 'too-many-failures',
          processedChats: 6,
        })
      })

    it('reports a model-unavailable reason when the key is gone', async () => {
      const job = await jobWithChats(1)

      await testDb.db.delete(schema.keys)
        .where(eq(schema.keys.userId, userId))

      expect((await advance(job.id)).job).toMatchObject({
        status: 'failed',
        failureReason: 'model-unavailable',
      })
    })

    it('stamps the attempt before the model call', async () => {
      const newest = await chat(10)
      const job = await seedBackfillJob(testDb.db, userId, { totalChats: 1 })
      const seenDuringCall: Array<string | null | undefined> = []

      mocks.extractChatMemory.mockImplementation(async () => {
        const during = await readJob(job.id)

        seenDuringCall.push(during?.retriedChatId, String(during?.chatAttempts))

        return extractionResult()
      })

      await advance(job.id)

      expect(seenDuringCall).toEqual([newest.id, '1'])
      expect((await readJob(job.id))?.retriedChatId).toBeNull()
      expect((await readJob(job.id))?.chatAttempts).toBe(0)
    })

    it('retries a chat whose earlier invocation died, as attempt two',
      async () => {
        const newest = await chat(10)
        const job = await seedBackfillJob(testDb.db, userId, {
          totalChats: 1,
          retriedChatId: newest.id,
          chatAttempts: 1,
        })
        const attemptsDuringCall: number[] = []

        mocks.extractChatMemory.mockImplementation(async () => {
          attemptsDuringCall.push(
            (await readJob(job.id))?.chatAttempts ?? -1,
          )

          return extractionResult()
        })

        await advance(job.id)

        expect(attemptsDuringCall).toEqual([2])
      })

    it('skips without a model call a chat attempted twice already',
      async () => {
        const newest = await chat(10)
        const job = await seedBackfillJob(testDb.db, userId, {
          totalChats: 1,
          retriedChatId: newest.id,
          chatAttempts: 2,
        })
        const step = await advance(job.id)

        expect(mocks.extractChatMemory).not.toHaveBeenCalled()
        expect(step.job).toMatchObject({
          status: 'completed',
          processedChats: 1,
          skippedChats: 1,
        })
      })

    it('passes a clamped model timeout on an interactive step', async () => {
      await chat(10)

      const job = await seedBackfillJob(testDb.db, userId, { totalChats: 1 })

      await advance(job.id, { isInteractive: true, deadlineMs: 60_000 })

      const { generationTimeoutMs } = mocks.extractChatMemory.mock
        .calls[0]![0] as { generationTimeoutMs: number }

      expect(generationTimeoutMs).toBeGreaterThanOrEqual(30_000)
      expect(generationTimeoutMs).toBeLessThanOrEqual(60_000)
    })

    it('caps the interactive model timeout at the request limit', async () => {
      await chat(10)

      const job = await seedBackfillJob(testDb.db, userId, { totalChats: 1 })

      await advance(job.id, { isInteractive: true, deadlineMs: 600_000 })

      expect((mocks.extractChatMemory.mock.calls[0]![0] as {
        generationTimeoutMs: number
      }).generationTimeoutMs).toBe(90_000)
    })

    it('starts no interactive chat with under 30 s of budget left',
      async () => {
        await chat(10)

        const job = await seedBackfillJob(testDb.db, userId, { totalChats: 1 })
        const step = await advance(job.id, {
          isInteractive: true,
          deadlineMs: 20_000,
        })

        expect(step.chatsProcessed).toBe(0)
        expect(step.job?.status).toBe('running')
        expect(mocks.extractChatMemory).not.toHaveBeenCalled()
      })

    it('keeps the background timeout on the cron path', async () => {
      await chat(10)

      const job = await seedBackfillJob(testDb.db, userId, { totalChats: 1 })

      await advance(job.id)

      expect(mocks.extractChatMemory.mock.calls[0]![0])
        .not.toHaveProperty('generationTimeoutMs')
    })
  })

  describe('pruning finished jobs on start', () => {
    it('keeps only the five newest finished jobs of the user', async () => {
      const otherUser = await seedUser(testDb.db, { memoryEnabled: true })
      const otherJob = await seedBackfillJob(testDb.db, otherUser, {
        status: 'completed',
        createdAt: minutesBefore(5000),
      })

      for (let index = 0; index < 7; index++) {
        await seedBackfillJob(testDb.db, userId, {
          status: index % 2 ? 'cancelled' : 'completed',
          processedChats: MEMORY_LIMITS.backfillMaxChats,
          createdAt: minutesBefore(1000 - index * 10),
        })
      }

      await chat(10)

      const progress = await start()
      const remaining = await testDb.db.query.memoryBackfillJobs.findMany({
        where: { userId },
      })

      expect(remaining.filter(job => job.status !== 'running')).toHaveLength(5)
      expect(remaining.some(job => job.id === progress.id)).toBe(true)
      expect((await readJob(otherJob.id))?.id).toBe(otherJob.id)
    })

    it('keeps a completed empty job after pruning', async () => {
      for (let index = 0; index < 6; index++) {
        await seedBackfillJob(testDb.db, userId, {
          status: 'completed',
          processedChats: MEMORY_LIMITS.backfillMaxChats,
          createdAt: minutesBefore(1000 - index * 10),
        })
      }

      const progress = await start()

      expect(progress.status).toBe('completed')
      expect(await readJob(progress.id)).toBeDefined()
      expect(await testDb.db.query.memoryBackfillJobs.findMany({
        where: { userId },
      })).toHaveLength(5)
    })

    it('never prunes a running job', async () => {
      await chat(10)
      await start()

      expect(await testDb.db.query.memoryBackfillJobs.findMany({
        where: { userId, status: 'running' },
      })).toHaveLength(1)
    })
  })

  describe('continuing a capped run', () => {
    const OLDER_CHATS = 3

    async function seedHistory(count: number) {
      const ids: string[] = []

      for (let index = 0; index < count; index++) {
        ids.push((await chat(10 + index)).id)
      }

      return ids
    }

    async function runToEnd(jobId: string) {
      return await advance(jobId, {
        chatsLimit: MEMORY_LIMITS.backfillMaxChats + 10,
      })
    }

    beforeEach(() => {
      mocks.getBackfillEstimate.mockResolvedValue(null)
    })

    it('starts the next job after the capped job\'s cursor and never '
      + 'reprocesses its chats', async () => {
      const chatIds = await seedHistory(
        MEMORY_LIMITS.backfillMaxChats + OLDER_CHATS,
      )
      const first = await start()
      const firstStep = await runToEnd(first.id)
      const firstRunChats = processedChatIds()

      expect(firstStep.job).toMatchObject({
        status: 'completed',
        processedChats: MEMORY_LIMITS.backfillMaxChats,
      })
      expect(firstRunChats)
        .toEqual(chatIds.slice(0, MEMORY_LIMITS.backfillMaxChats))

      mocks.extractChatMemory.mockClear()

      const second = await start()
      const secondRow = await readJob(second.id)
      const firstRow = await readJob(first.id)

      expect(second.totalChats).toBe(OLDER_CHATS)
      expect(secondRow?.createdBefore).toEqual(firstRow?.createdBefore)
      expect(secondRow?.cursorChatId).toBe(firstRow?.cursorChatId)

      await runToEnd(second.id)

      expect(processedChatIds())
        .toEqual(chatIds.slice(MEMORY_LIMITS.backfillMaxChats))
      expect(processedChatIds().some((chatId) => {
        return firstRunChats.includes(chatId)
      })).toBe(false)
    })

    it('hands the estimate the same window the job counts', async () => {
      await seedHistory(MEMORY_LIMITS.backfillMaxChats + OLDER_CHATS)

      const first = await start()

      await runToEnd(first.id)

      const second = await start()
      const { window } = mocks.getBackfillEstimate.mock.calls.at(-1)![0] as {
        window: Record<string, unknown>
      }
      const { estimateBackfill } = await vi.importActual<
        typeof import('~~/server/utils/memory/backfill-estimate')
      >('~~/server/utils/memory/backfill-estimate')
      const estimate = await estimateBackfill({
        userId,
        selection: null,
        window: window as never,
        db: testDb.db,
      })

      expect(window).toMatchObject({ isContinuation: true })
      expect(estimate.chats).toBe(second.totalChats)
      expect(estimate.chats).toBe(OLDER_CHATS)
      expect(estimate.continuesPreviousRun).toBe(true)
    })

    it('keeps the first run\'s cutoff, so newer chats stay with the sweep',
      async () => {
        await seedHistory(MEMORY_LIMITS.backfillMaxChats)

        const first = await start()

        await runToEnd(first.id)
        await chat(5, userId, {
          createdAt: new Date(EXTRACTION_NOW.getTime() + 60_000),
        })

        const { startBackfill } = await import(
          '~~/server/utils/memory/backfill'
        )
        const second = await startBackfill({
          userId,
          db: testDb.db,
          logger,
          now: new Date(EXTRACTION_NOW.getTime() + 120_000),
        })

        expect(second.totalChats).toBe(0)
        expect(second.status).toBe('completed')
      })

    it('answers 409 and creates no job once a run read every past chat',
      async () => {
        await seedHistory(OLDER_CHATS)

        const first = await start()

        await runToEnd(first.id)

        await expect(start()).rejects.toMatchObject({
          status: 409,
          message: 'All past chats were already read',
        })
        expect(await testDb.db.query.memoryBackfillJobs.findMany({
          where: { userId },
        })).toHaveLength(1)
      })

    it('resumes a cancelled run after its cursor instead of starting over',
      async () => {
        const chatIds = await seedHistory(5)
        const first = await start()

        await advance(first.id, { chatsLimit: 2 })

        const { cancelBackfill } = await import(
          '~~/server/utils/memory/backfill'
        )

        await cancelBackfill({ userId, db: testDb.db })
        mocks.extractChatMemory.mockClear()

        const second = await start()

        await runToEnd(second.id)

        expect(second.totalChats).toBe(3)
        expect(processedChatIds()).toEqual(chatIds.slice(2))
      })
  })

  describe('getBackfillProgress and cancelBackfill', () => {
    it('returns null when the user never started a backfill', async () => {
      const { getBackfillProgress } = await import(
        '~~/server/utils/memory/backfill'
      )

      expect(await getBackfillProgress({ userId, db: testDb.db }))
        .toBeNull()
    })

    it('prefers the running job and else the latest one', async () => {
      const { getBackfillProgress } = await import(
        '~~/server/utils/memory/backfill'
      )
      const finished = await seedBackfillJob(testDb.db, userId, {
        status: 'completed',
        createdAt: minutesBefore(500),
      })
      const latest = await seedBackfillJob(testDb.db, userId, {
        status: 'cancelled',
        createdAt: minutesBefore(100),
      })

      expect((await getBackfillProgress({ userId, db: testDb.db }))?.id)
        .toBe(latest.id)

      const running = await seedBackfillJob(testDb.db, userId, {
        createdAt: minutesBefore(900),
      })

      expect((await getBackfillProgress({ userId, db: testDb.db }))?.id)
        .toBe(running.id)
      expect(finished.id).not.toBe(latest.id)
    })

    it('cancels a running job, idempotently', async () => {
      const { cancelBackfill } = await import('~~/server/utils/memory/backfill')

      await chat(10)

      const progress = await start()
      const first = await cancelBackfill({ userId, db: testDb.db })
      const second = await cancelBackfill({ userId, db: testDb.db })

      expect(first).toMatchObject({ id: progress.id, status: 'cancelled' })
      expect(first?.finishedAt).not.toBeNull()
      expect(second).toEqual(first)
    })

    it('does not process remaining chats once cancelled', async () => {
      const { cancelBackfill } = await import('~~/server/utils/memory/backfill')

      await chat(10)
      await chat(20)

      const progress = await start()

      await cancelBackfill({ userId, db: testDb.db })

      const step = await advance(progress.id, { chatsLimit: 5 })

      expect(step.chatsProcessed).toBe(0)
      expect(mocks.extractChatMemory).not.toHaveBeenCalled()
    })

    it('answers null when cancelling with nothing started', async () => {
      const { cancelBackfill } = await import('~~/server/utils/memory/backfill')

      expect(await cancelBackfill({ userId, db: testDb.db })).toBeNull()
    })

    it('never shows or cancels another user\'s job', async () => {
      const { cancelBackfill, getBackfillProgress } = await import(
        '~~/server/utils/memory/backfill'
      )
      const otherUser = await seedUser(testDb.db, { memoryEnabled: true })
      const otherJob = await seedBackfillJob(testDb.db, otherUser)

      expect(await getBackfillProgress({ userId, db: testDb.db })).toBeNull()
      expect(await cancelBackfill({ userId, db: testDb.db })).toBeNull()
      expect((await readJob(otherJob.id))?.status).toBe('running')
    })
  })
})
