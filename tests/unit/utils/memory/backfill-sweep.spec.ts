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
      chats: 3,
      completed: 0,
      failed: 0,
    })
    expect(backfillCallCount()).toBe(3)
    expect(mocks.extractChatMemory).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'backfill', ignoreIdle: true }),
    )
    expect((await readJob(jobId))?.processedChats).toBe(3)
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

  it('services at most five jobs per tick, least recently progressed first',
    async () => {
      const jobs = []

      for (let index = 0; index < 7; index++) {
        jobs.push(await userWithJob({
          chats: 1,
          updatedMinutesAgo: 100 - index * 10,
        }))
      }

      const result = await sweep()

      expect(result.backfill.jobs).toBe(5)
      expect(backfillCallCount()).toBe(5)

      const completed = []

      for (const job of jobs) {
        completed.push((await readJob(job.jobId))?.status === 'completed')
      }

      expect(completed).toEqual([
        true, true, true, true, true, false, false,
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
