import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
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
import { seedBackfillJob } from '../../../setup/helpers/memory-backfill-db'

const mocks = vi.hoisted(() => ({
  extractChatMemory: vi.fn(),
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

const SECRET_TITLE = 'Secret chat title'

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

describe('sweepMemoryExtraction backfill servicing', () => {
  let testDb: MemoryExtractionTestDb
  let logger: { set: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    testDb = createMemoryExtractionTestDb()
    logger = { set: vi.fn() }
    mocks.extractChatMemory.mockResolvedValue(extractionResult())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    testDb.close()
  })

  async function userWithJob(
    options: {
      chats?: number
      updatedMinutesAgo?: number
      settings?: Partial<typeof schema.userSettings.$inferInsert>
    } = {},
  ) {
    const userId = await seedUser(testDb.db, {
      memoryEnabled: true,
      ...options.settings,
    })

    await seedKey(testDb.db, userId, 'openai')

    const chatIds: string[] = []

    for (let index = 0; index < (options.chats ?? 4); index++) {
      const chat = await seedChat(testDb.db, userId, {
        createdAt: minutesBefore(1000),
        activityAt: minutesBefore(10 + index),
        title: SECRET_TITLE,
      })

      await seedMessage(testDb.db, chat.id, 'user', [textPart('text')],
        minutesBefore(20 + index))
      chatIds.push(chat.id)
    }

    const job = await seedBackfillJob(testDb.db, userId, {
      totalChats: chatIds.length,
      updatedAt: minutesBefore(options.updatedMinutesAgo ?? 0),
    })

    return { userId, jobId: job.id, chatIds }
  }

  async function sweep(maxRuntimeMs = 60_000) {
    const { sweepMemoryExtraction } = await import(
      '~~/server/utils/memory/extract-sweep'
    )

    return await sweepMemoryExtraction({
      batchSize: 20,
      maxRuntimeMs,
      logger,
      db: testDb.db,
      now: EXTRACTION_NOW,
    })
  }

  async function sweepJobs(maxRuntimeMs = 45_000) {
    const { sweepBackfillJobs } = await import(
      '~~/server/utils/memory/backfill'
    )

    return await sweepBackfillJobs({ maxRuntimeMs, logger, db: testDb.db })
  }

  function advanceClockPerChat(chatMs: number) {
    let now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)

    mocks.extractChatMemory.mockImplementation(async () => {
      now += chatMs

      return extractionResult()
    })

    return clock
  }

  function backfillCallCount(): number {
    return mocks.extractChatMemory.mock.calls.filter((call) => {
      return (call[0] as { trigger?: string }).trigger === 'backfill'
    }).length
  }

  async function readJob(jobId: string) {
    return await testDb.db.query.memoryBackfillJobs.findFirst({
      where: { id: jobId },
    })
  }

  it('services a running job after the normal batch', async () => {
    const { jobId } = await userWithJob({ chats: 5 })
    const result = await sweep()

    expect(result.backfill).toEqual({
      jobs: 1,
      chats: 5,
      completed: 1,
      failed: 0,
    })
    expect(backfillCallCount()).toBe(5)
    expect(mocks.extractChatMemory).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'backfill', ignoreIdle: true }),
    )
    expect((await readJob(jobId))?.processedChats).toBe(5)
  })

  it('processes many more than three chats of one job in a tick',
    async () => {
      const { jobId } = await userWithJob({ chats: 23 })
      const result = await sweepJobs()

      expect(result).toEqual({ jobs: 1, chats: 23, completed: 1, failed: 0 })
      expect(backfillCallCount()).toBe(23)
      expect((await readJob(jobId))?.status).toBe('completed')
      expect((await readJob(jobId))?.leaseUntil).toBeNull()
    })

  it('stops starting chats once the tick budget is spent', async () => {
    const { jobId } = await userWithJob({ chats: 20 })
    const clock = advanceClockPerChat(10_000)

    try {
      const result = await sweepJobs(25_000)

      expect(result.chats).toBe(3)
      expect(backfillCallCount()).toBe(3)
      expect((await readJob(jobId))).toMatchObject({
        status: 'running',
        processedChats: 3,
        leaseUntil: null,
      })
    } finally {
      clock.mockRestore()
    }
  })

  it('stops at the per-tick chat cap and shares it between jobs',
    async () => {
      const first = await userWithJob({ chats: 40, updatedMinutesAgo: 30 })
      const second = await userWithJob({ chats: 40, updatedMinutesAgo: 20 })
      const result = await sweepJobs()

      expect(result.chats).toBe(60)
      expect((await readJob(first.jobId))?.processedChats).toBe(30)
      expect((await readJob(second.jobId))?.processedChats).toBe(30)
    })

  it('serves two jobs round-robin in slices of five chats', async () => {
    const first = await userWithJob({ chats: 12, updatedMinutesAgo: 30 })
    const second = await userWithJob({ chats: 12, updatedMinutesAgo: 20 })
    const result = await sweepJobs()
    const owners = mocks.extractChatMemory.mock.calls.map((call) => {
      return (call[0] as { userId: number }).userId
    })
    const firstBlock = Array<number>(5).fill(first.userId)
    const secondBlock = Array<number>(5).fill(second.userId)

    expect(result).toEqual({ jobs: 2, chats: 24, completed: 2, failed: 0 })
    expect(owners).toEqual([
      ...firstBlock,
      ...secondBlock,
      ...firstBlock,
      ...secondBlock,
      first.userId,
      first.userId,
      second.userId,
      second.userId,
    ])
  })

  it('gives each job a fair share when the budget runs out', async () => {
    const first = await userWithJob({ chats: 20, updatedMinutesAgo: 30 })
    const second = await userWithJob({ chats: 20, updatedMinutesAgo: 20 })
    const clock = advanceClockPerChat(10_000)

    try {
      await sweepJobs(95_000)

      const firstDone = (await readJob(first.jobId))?.processedChats ?? 0
      const secondDone = (await readJob(second.jobId))?.processedChats ?? 0

      expect(firstDone).toBe(5)
      expect(secondDone).toBe(5)
    } finally {
      clock.mockRestore()
    }
  })

  it('skips a job whose lease another tick holds and serves the rest',
    async () => {
      const busy = await userWithJob({ chats: 3, updatedMinutesAgo: 30 })
      const free = await userWithJob({ chats: 3, updatedMinutesAgo: 20 })

      await testDb.db.update(schema.memoryBackfillJobs)
        .set({ leaseUntil: new Date(Date.now() + 120_000) })
        .where(eq(schema.memoryBackfillJobs.id, busy.jobId))

      const result = await sweepJobs()

      expect(result).toMatchObject({ jobs: 1, chats: 3, completed: 1 })
      expect((await readJob(busy.jobId))?.processedChats).toBe(0)
      expect((await readJob(free.jobId))?.status).toBe('completed')
    })

  it('leaves a running job alone when its user withdrew consent', async () => {
    const { jobId } = await userWithJob({
      chats: 3,
      settings: { sensitiveContentConsentWithdrawnAt: minutesBefore(5) },
    })
    const result = await sweep()

    expect(result.backfill).toMatchObject({ jobs: 0, chats: 0 })
    expect(backfillCallCount()).toBe(0)
    expect((await readJob(jobId))?.processedChats).toBe(0)
  })

  it('completes a job whose cursor runs out within the tick', async () => {
    const { jobId } = await userWithJob({ chats: 2 })
    const result = await sweep()

    expect(result.backfill).toMatchObject({ jobs: 1, chats: 2, completed: 1 })
    expect((await readJob(jobId))?.status).toBe('completed')
  })

  it('services at most twenty jobs per tick, least recently progressed '
    + 'first', async () => {
    const jobs = []

    for (let index = 0; index < 22; index++) {
      jobs.push(await userWithJob({
        chats: 1,
        updatedMinutesAgo: 300 - index * 10,
      }))
    }

    const result = await sweep()

    expect(result.backfill.jobs).toBe(20)
    expect(backfillCallCount()).toBe(20)

    const completed = []

    for (const job of jobs) {
      completed.push((await readJob(job.jobId))?.status === 'completed')
    }

    expect(completed).toEqual([
      ...Array<boolean>(20).fill(true),
      false,
      false,
    ])
  })

  it('ignores finished and cancelled jobs', async () => {
    const { userId } = await userWithJob({ chats: 1 })

    await testDb.db.update(schema.memoryBackfillJobs)
      .set({ status: 'cancelled' })
      .where(eq(schema.memoryBackfillJobs.userId, userId))

    const result = await sweep()

    expect(result.backfill.jobs).toBe(0)
    expect(backfillCallCount()).toBe(0)
  })

  it('services nothing when the runtime budget is already spent', async () => {
    await userWithJob({ chats: 3 })

    const result = await sweep(0)

    expect(result.backfill.jobs).toBe(0)
    expect(backfillCallCount()).toBe(0)
  })

  it('stops servicing jobs once the remaining budget runs out', async () => {
    await userWithJob({ chats: 2, updatedMinutesAgo: 30 })
    await userWithJob({ chats: 2, updatedMinutesAgo: 20 })
    mocks.extractChatMemory.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 40)
      })

      return extractionResult()
    })

    const result = await sweep(60)

    expect(result.backfill.jobs).toBeLessThanOrEqual(1)
  })

  it('does not stop on a job that throws', async () => {
    const first = await userWithJob({ chats: 1, updatedMinutesAgo: 30 })
    const second = await userWithJob({ chats: 1, updatedMinutesAgo: 20 })

    vi.spyOn(testDb.db, 'update').mockImplementationOnce(() => {
      throw new Error('d1 down')
    })

    const result = await sweep()

    expect(result.backfill).toMatchObject({ jobs: 1, failed: 1 })
    expect((await readJob(first.jobId))?.processedChats).toBe(0)
    expect((await readJob(second.jobId))?.status).toBe('completed')
  })

  it('cancels the job of a user who switched automatic updates off',
    async () => {
      const { jobId } = await userWithJob({
        chats: 3,
        settings: { memoryExtractionEnabled: false },
      })

      await sweep()

      expect((await readJob(jobId))?.status).toBe('cancelled')
      expect(backfillCallCount()).toBe(0)
    })

  it('records counts only in the sweep log', async () => {
    await userWithJob({ chats: 2 })
    await sweep()

    const logged = JSON.stringify(logger.set.mock.calls)

    expect(logged).toContain('memoryBackfillSweep')
    expect(logged).not.toContain(SECRET_TITLE)
  })
})
