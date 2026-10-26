import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  minutesBefore,
  seedChat,
  seedKey,
  seedMessage,
  seedUser,
  textPart,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { seedBackfillJob } from '../../setup/helpers/memory-backfill-db'

const mocks = vi.hoisted(() => ({
  extractChatMemory: vi.fn(),
  resolveMemoryModel: vi.fn(),
  getBackfillEstimate: vi.fn(),
  invalidateBackfillEstimate: vi.fn(),
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

vi.mock('~~/server/utils/http/apply-response-headers', () => ({
  applyResponseHeaders: vi.fn(),
}))

vi.mock('~~/server/utils/memory/extract', () => ({
  extractChatMemory: mocks.extractChatMemory,
}))

vi.mock('~~/server/utils/memory/backfill-estimate', () => ({
  getBackfillEstimate: mocks.getBackfillEstimate,
  invalidateBackfillEstimate: mocks.invalidateBackfillEstimate,
  lookupBackfillEstimate: async (input: unknown) => {
    try {
      return {
        status: 'ready',
        estimate: await mocks.getBackfillEstimate(input),
      }
    } catch (exception) {
      return { status: 'failed', exception }
    }
  },
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
  chats: 2,
  userChars: 100,
  transcriptChars: 200,
  inputTokens: 1000,
  outputTokens: 600,
  overheadTokensPerChat: 400,
  pricePerMillion: { input: 1, output: 4 },
  costUsd: 0.0034,
  approximate: true,
  model: {
    source: 'setting',
    providerId: 'openai',
    gatewayId: null,
    modelId: 'gpt-test',
    modelName: 'GPT Test',
  },
}

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

type HandlerName
  = 'index.get'
    | 'index.post'
    | 'step.post'
    | 'cancel.post'

async function loadHandler(name: HandlerName) {
  const module = await import(
    `../../../server/api/v1/memory/backfill/${name}`
  )

  return module.default as (event: unknown) => Promise<any>
}

describe('memory backfill API', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let kv: ReturnType<typeof createKvStub>

  beforeEach(async () => {
    vi.resetModules()
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, { memoryEnabled: true })
    await seedKey(testDb.db, userId, 'openai')
    kv = createKvStub()
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

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('assertNotCrossSiteRequest', vi.fn())
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: String(userId) },
    }))
    vi.stubGlobal(
      'readValidatedBody',
      async (event: any, parser: (body: unknown) => unknown) => {
        return parser(event.body)
      },
    )
    vi.stubGlobal('getQuery', (event: { query?: unknown }) => {
      return event.query ?? {}
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    testDb.close()
  })

  async function chat(minutesAgo: number, owner = userId) {
    const created = await seedChat(testDb.db, owner, {
      createdAt: minutesBefore(1000),
      activityAt: minutesBefore(minutesAgo),
      title: SECRET_TITLE,
    })

    await seedMessage(testDb.db, created.id, 'user', [textPart(SECRET_TEXT)],
      minutesBefore(minutesAgo + 1))

    return created
  }

  async function get(query?: Record<string, string>) {
    return await (await loadHandler('index.get'))({ query })
  }

  async function post(body?: unknown) {
    return await (await loadHandler('index.post'))({ body })
  }

  async function step() {
    return await (await loadHandler('step.post'))({})
  }

  async function cancel() {
    return await (await loadHandler('cancel.post'))({})
  }

  describe('authentication and csrf', () => {
    it.each(['index.get', 'index.post', 'step.post', 'cancel.post'] as const)(
      'rejects unauthenticated requests on %s',
      async (name) => {
        vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

        await expect((await loadHandler(name))({}))
          .rejects.toMatchObject({ status: 401 })
      },
    )

    it('asserts a same-site request on every POST route', async () => {
      const assertion = vi.fn()

      vi.stubGlobal('assertNotCrossSiteRequest', assertion)
      await chat(10)
      await post()
      await expect(step()).resolves.toBeDefined()
      await cancel()

      expect(assertion).toHaveBeenCalledTimes(3)
    })

    it('rejects a cross-site POST before doing any work', async () => {
      vi.stubGlobal('assertNotCrossSiteRequest', () => {
        throw Object.assign(new Error('Forbidden'), { status: 403 })
      })

      await expect(post()).rejects.toMatchObject({ status: 403 })
      await expect(step()).rejects.toMatchObject({ status: 403 })
      await expect(cancel()).rejects.toMatchObject({ status: 403 })
      expect(await testDb.db.query.memoryBackfillJobs.findMany()).toEqual([])
    })
  })

  describe('GET /memory/backfill', () => {
    it('answers an estimate and no job before the first run', async () => {
      expect(await get()).toEqual({
        job: null,
        estimate: ESTIMATE,
        reason: null,
      })
      expect(mocks.resolveMemoryModel).toHaveBeenCalledWith(
        expect.objectContaining({ userId, scope: 'profile' }),
      )
      expect(mocks.getBackfillEstimate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          selection: expect.objectContaining({ modelId: 'gpt-test' }),
        }),
      )
    })

    it('answers no estimate and a reason when no model resolves',
      async () => {
        mocks.resolveMemoryModel.mockResolvedValue(null)

        expect(await get()).toEqual({
          job: null,
          estimate: null,
          reason: 'no-model',
        })
        expect(mocks.getBackfillEstimate).not.toHaveBeenCalled()
      })

    it('answers estimate-failed instead of an error when the estimate throws',
      async () => {
        mocks.getBackfillEstimate.mockRejectedValue(new Error(SECRET_TEXT))

        expect(await get()).toEqual({
          job: null,
          estimate: null,
          reason: 'estimate-failed',
        })
        expect(JSON.stringify(mocks.loggerSet.mock.calls))
          .not.toContain(SECRET_TEXT)
      })

    it('answers the gate reason when memory or updates are off',
      async () => {
        await testDb.db.update(schema.userSettings)
          .set({ memoryExtractionEnabled: false })
          .where(eq(schema.userSettings.userId, userId))

        expect(await get()).toMatchObject({
          estimate: null,
          reason: 'extraction-disabled',
        })

        await testDb.db.update(schema.userSettings)
          .set({ memoryEnabled: false })
          .where(eq(schema.userSettings.userId, userId))

        expect(await get()).toMatchObject({ reason: 'memory-disabled' })
        expect(mocks.resolveMemoryModel).not.toHaveBeenCalled()
      })

    it('answers only the running job without computing an estimate',
      async () => {
        const job = await seedBackfillJob(testDb.db, userId, {
          totalChats: 4,
          processedChats: 1,
        })
        const response = await get()

        expect(response.job).toMatchObject({
          id: job.id,
          status: 'running',
          totalChats: 4,
          processedChats: 1,
        })
        expect(response.estimate).toBeNull()
        expect(mocks.getBackfillEstimate).not.toHaveBeenCalled()
      })

    it('answers the last finished job together with a fresh estimate',
      async () => {
        await seedBackfillJob(testDb.db, userId, {
          status: 'completed',
          processedChats: MEMORY_LIMITS.backfillMaxChats,
        })

        const response = await get()

        expect(response.job.status).toBe('completed')
        expect(response.estimate).toEqual(ESTIMATE)
      })

    it('answers all-chats-read without an estimate once the last run read '
      + 'every past chat', async () => {
      await seedBackfillJob(testDb.db, userId, {
        status: 'completed',
        processedChats: 3,
      })

      const response = await get()

      expect(response).toMatchObject({
        estimate: null,
        reason: 'all-chats-read',
      })
      expect(mocks.getBackfillEstimate).not.toHaveBeenCalled()
    })

    it.each([
      ['a run that read every past chat', 'completed', 3],
      ['a run that stopped at its cap', 'completed', 200],
      ['a cancelled run', 'cancelled', 5],
    ] as const)('estimates a fresh window for ?restart=true after %s',
      async (_label, status, processedChats) => {
        const cursorChat = await chat(10)

        await seedBackfillJob(testDb.db, userId, {
          status,
          processedChats,
          createdBefore: new Date('2026-10-20T10:00:00.000Z'),
          cursorActivityAt: new Date('2026-10-19T10:00:00.000Z'),
          cursorChatId: cursorChat.id,
        })

        const response = await get({ restart: 'true' })
        const [call] = mocks.getBackfillEstimate.mock.calls.at(-1)!

        expect(response).toMatchObject({ estimate: ESTIMATE, reason: null })
        expect(call.window).toMatchObject({
          cursor: null,
          isContinuation: false,
        })
        expect(call.window.createdBefore.getTime())
          .toBeGreaterThan(new Date('2026-10-20T10:00:00.000Z').getTime())
      })

    it('estimates the continuation window after a capped run', async () => {
      const createdBefore = new Date('2026-10-20T10:00:00.000Z')
      const cursorActivityAt = new Date('2026-10-19T10:00:00.000Z')
      const cursorChat = await chat(10)

      await seedBackfillJob(testDb.db, userId, {
        status: 'completed',
        processedChats: MEMORY_LIMITS.backfillMaxChats,
        createdBefore,
        cursorActivityAt,
        cursorChatId: cursorChat.id,
      })

      await get()

      const [call] = mocks.getBackfillEstimate.mock.calls.at(-1)!

      expect(call.window).toEqual({
        createdBefore,
        cursor: { activityAt: cursorActivityAt, chatId: cursorChat.id },
        isContinuation: true,
      })
    })

    it('never shows another user\'s job', async () => {
      const otherUser = await seedUser(testDb.db, { memoryEnabled: true })

      await seedBackfillJob(testDb.db, otherUser)

      expect((await get()).job).toBeNull()
    })
  })

  describe('POST /memory/backfill', () => {
    it('answers 409 and starts nothing once the last run read every past '
      + 'chat', async () => {
      await chat(10)
      await seedBackfillJob(testDb.db, userId, {
        status: 'completed',
        processedChats: 1,
      })

      await expect(post()).rejects.toMatchObject({
        status: 409,
        message: 'All past chats were already read',
      })
      expect(await testDb.db.query.memoryBackfillJobs.findMany({
        where: { userId },
      })).toHaveLength(1)
    })

    it('starts a fresh job from the newest chat on an explicit restart',
      async () => {
        await chat(10)

        const older = await chat(20)

        await seedBackfillJob(testDb.db, userId, {
          status: 'completed',
          processedChats: 2,
          cursorActivityAt: minutesBefore(20),
          cursorChatId: older.id,
        })

        const response = await post({ restart: true })
        const started = await testDb.db.query.memoryBackfillJobs.findFirst({
          where: { userId, status: 'running' },
        })

        expect(response.job).toMatchObject({
          status: 'running',
          totalChats: 2,
          processedChats: 0,
        })
        expect(started?.cursorChatId ?? null).toBeNull()
        expect(started?.cursorActivityAt ?? null).toBeNull()
      })

    it.each([
      ['a non-boolean restart', { restart: 'yes' }],
      ['an unknown field', { restart: true, cursor: 'x' }],
    ])('answers 400 for %s', async (_label, body) => {
      await chat(10)

      await expect(post(body)).rejects.toMatchObject({ status: 400 })
      expect(await testDb.db.query.memoryBackfillJobs.findMany({
        where: { userId },
      })).toHaveLength(0)
    })

    it('starts a job and answers its progress and estimate', async () => {
      await chat(10)
      await chat(20)

      const response = await post()

      expect(response.job).toMatchObject({
        status: 'running',
        totalChats: 2,
        processedChats: 0,
        inputTokens: 0,
        outputTokens: 0,
        failureReason: null,
        estimate: ESTIMATE,
      })
      expect(mocks.extractChatMemory).not.toHaveBeenCalled()
    })

    it('answers 409 and drives nothing while a job is running', async () => {
      await chat(10)
      await post()
      kv.store.clear()

      await expect(post()).rejects.toMatchObject({
        status: 409,
        message: 'A backfill is already running',
        fix: expect.any(String),
      })
      expect(mocks.extractChatMemory).not.toHaveBeenCalled()
      expect(await testDb.db.query.memoryBackfillJobs.findMany())
        .toHaveLength(1)
    })

    it('answers 409 when the user cannot run a backfill', async () => {
      await testDb.db.update(schema.userSettings)
        .set({ memoryExtractionEnabled: false })
        .where(eq(schema.userSettings.userId, userId))

      await expect(post()).rejects.toMatchObject({
        status: 409,
        fix: expect.any(String),
      })
    })

    it('answers 409 without a usable key', async () => {
      mocks.resolveMemoryModel.mockResolvedValue(null)

      await expect(post()).rejects.toMatchObject({ status: 409 })
    })

    it('answers 429 inside the start cooldown and stores a timestamp',
      async () => {
        await chat(10)
        await post()

        const [key, value, options] = kv.put.mock.calls[0]!

        expect(key).toBe(`memory-backfill-start:${userId}`)
        expect(Number(value)).toBeGreaterThan(0)
        expect(options).toEqual({ expirationTtl: 60 })

        await testDb.db.update(schema.memoryBackfillJobs)
          .set({ status: 'cancelled' })
          .where(eq(schema.memoryBackfillJobs.userId, userId))

        await expect(post()).rejects.toMatchObject({
          status: 429,
          fix: expect.any(String),
        })
      })

    it('starts again once the start cooldown has elapsed', async () => {
      await chat(10)
      await post()
      await cancel()
      kv.store.set(
        `memory-backfill-start:${userId}`,
        String(Date.now() - 11_000),
      )

      expect((await post()).job.status).toBe('running')
    })

    it('never starts a job for, or sees, another user\'s running job',
      async () => {
        const otherUser = await seedUser(testDb.db, { memoryEnabled: true })
        const otherJob = await seedBackfillJob(testDb.db, otherUser, {
          totalChats: 1,
        })

        await chat(10, otherUser)

        const response = await post()

        expect(response.job.id).not.toBe(otherJob.id)
        expect(mocks.extractChatMemory).not.toHaveBeenCalled()
      })
  })

  describe('POST /memory/backfill/step', () => {
    it('answers 409 with a fix and never starts a job when none runs',
      async () => {
        await chat(10)

        await expect(step()).rejects.toMatchObject({
          status: 409,
          message: 'No running backfill',
          fix: expect.any(String),
        })
        expect(await testDb.db.query.memoryBackfillJobs.findMany())
          .toEqual([])
        expect(mocks.extractChatMemory).not.toHaveBeenCalled()
      })

    it('does not drive another user\'s running job', async () => {
      const otherUser = await seedUser(testDb.db, { memoryEnabled: true })

      await seedBackfillJob(testDb.db, otherUser)
      await chat(10, otherUser)

      await expect(step()).rejects.toMatchObject({ status: 409 })
      expect(mocks.extractChatMemory).not.toHaveBeenCalled()
    })

    it('drives one bounded interactive batch of the running job',
      async () => {
        const newest = await chat(10)

        await chat(20)
        await chat(30)

        const started = await post()
        const driven = await step()

        expect(driven.job).toMatchObject({
          id: started.job.id,
          processedChats: 2,
          createdEntries: 2,
          status: 'running',
        })
        expect(mocks.extractChatMemory).toHaveBeenCalledTimes(2)
        expect(mocks.extractChatMemory).toHaveBeenCalledWith(
          expect.objectContaining({
            chat: { id: newest.id },
            trigger: 'backfill',
            generationTimeoutMs: expect.any(Number),
          }),
        )
      })

    it('answers 429 inside the drive cooldown and stores a timestamp',
      async () => {
        await chat(10)
        await chat(20)
        await chat(30)
        await post()
        await step()

        const [key, value, options] = kv.put.mock.calls[1]!

        expect(key).toBe(`memory-backfill-drive:${userId}`)
        expect(Number(value)).toBeGreaterThan(0)
        expect(options).toEqual({ expirationTtl: 60 })
        mocks.extractChatMemory.mockClear()

        await expect(step()).rejects.toMatchObject({
          status: 429,
          fix: expect.any(String),
        })
        expect(mocks.extractChatMemory).not.toHaveBeenCalled()
      })

    it('steps again once the cooldown has elapsed', async () => {
      await chat(10)
      await chat(20)
      await chat(30)
      await post()
      await step()
      kv.store.set(
        `memory-backfill-drive:${userId}`,
        String(Date.now() - 11_000),
      )

      const driven = await step()

      expect(driven.job.processedChats).toBe(3)
      expect(driven.job.status).toBe('completed')
    })

    it('returns the progress as is while another driver holds the job',
      async () => {
        await chat(10)

        const started = await post()

        await testDb.db.update(schema.memoryBackfillJobs)
          .set({ leaseUntil: new Date(Date.now() + 120_000) })
          .where(eq(schema.memoryBackfillJobs.id, started.job.id))

        const driven = await step()

        expect(driven.job).toMatchObject({
          status: 'running',
          processedChats: 0,
        })
        expect(mocks.extractChatMemory).not.toHaveBeenCalled()
      })

    it('logs counts and ids, never chat text or titles', async () => {
      await chat(10)
      await chat(20)
      await chat(30)
      await post()
      await step()

      const logged = JSON.stringify(mocks.loggerSet.mock.calls)

      expect(logged).toContain('chatsProcessed')
      expect(logged).not.toContain(SECRET_TITLE)
      expect(logged).not.toContain(SECRET_TEXT)
    })
  })

  describe('POST /memory/backfill/cancel', () => {
    it('cancels the running job and processes nothing afterwards',
      async () => {
        await chat(10)
        await chat(20)

        const started = await post()
        const response = await cancel()

        expect(response.job).toMatchObject({
          id: started.job.id,
          status: 'cancelled',
        })
        expect(response.job.finishedAt).not.toBeNull()

        kv.store.clear()

        await expect(post()).resolves.toMatchObject({
          job: { status: 'running' },
        })
        expect(mocks.extractChatMemory).not.toHaveBeenCalled()
      })

    it('is idempotent and answers null when nothing was ever started',
      async () => {
        expect(await cancel()).toEqual({ job: null })

        await seedBackfillJob(testDb.db, userId)

        const first = await cancel()
        const second = await cancel()

        expect(first.job.status).toBe('cancelled')
        expect(second).toEqual(first)
      })

    it('never cancels another user\'s job', async () => {
      const otherUser = await seedUser(testDb.db, { memoryEnabled: true })
      const otherJob = await seedBackfillJob(testDb.db, otherUser)

      expect(await cancel()).toEqual({ job: null })
      expect((await testDb.db.query.memoryBackfillJobs.findFirst({
        where: { id: otherJob.id },
      }))?.status).toBe('running')
    })
  })
})
