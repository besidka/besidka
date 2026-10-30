import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectMemoryStatus } from '#shared/types/projects.d'
import * as schema from '~~/server/db/schema'
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
  generateText: vi.fn(),
  prefilter: vi.fn(),
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

vi.mock('~~/server/utils/memory/extract-prefilter', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/memory/extract-prefilter')
  >()

  return { ...original, memoryExtractionPrefilter: mocks.prefilter }
})

vi.mock('~~/server/utils/projects/memory-lease', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/projects/memory-lease')
  >()

  return { ...original, acquireMemoryLease: mocks.acquireMemoryLease }
})

const LONG_USER_TEXT = `I write Rust on weekends. ${'I prefer concise answers. '.repeat(14)}`
const SHORT_USER_TEXT = 'Just a quick question.'

describe('settleProjectMemoryAfterSweepPass', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let projectId: string

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, {
      memoryEnabled: true,
      memoryExtractionEnabledAt: minutesBefore(1000),
    })
    projectId = await seedProject(testDb.db, userId, {
      memoryStatus: 'stale',
      memoryDirtyAt: minutesBefore(65),
    })
    mocks.release.mockResolvedValue(undefined)
    mocks.acquireMemoryLease.mockResolvedValue({ release: mocks.release })
    mocks.prefilter.mockResolvedValue({ action: 'extract', maxScore: null })
    mocks.resolveMemoryModel.mockImplementation(async () => {
      return {
        scope: 'project',
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

  async function projectChat(
    values: Partial<typeof schema.chats.$inferInsert> = {},
    text = LONG_USER_TEXT,
  ) {
    const activityAt = values.activityAt ?? minutesBefore(60)
    const chat = await seedChat(testDb.db, userId, {
      projectId,
      ...values,
      activityAt,
    })

    await seedMessage(testDb.db, chat.id, 'user', [textPart(text)], activityAt)

    return chat
  }

  async function sweep() {
    const { sweepMemoryExtraction } = await import(
      '~~/server/utils/memory/extract-sweep'
    )

    return await sweepMemoryExtraction({
      batchSize: 20,
      maxRuntimeMs: 60_000,
      logger: { set: vi.fn() },
      db: testDb.db,
      now: EXTRACTION_NOW,
      isBackfillEnabled: false,
    })
  }

  async function readProject() {
    return await testDb.db.query.projects.findFirst({
      where: { id: projectId },
    })
  }

  async function settle(chatId: string, passStartedAt = EXTRACTION_NOW) {
    const { settleProjectMemoryAfterSweepPass } = await import(
      '~~/server/utils/projects/memory-sweep-settle'
    )

    await settleProjectMemoryAfterSweepPass({
      chatId,
      userId,
      passStartedAt,
      db: testDb.db,
    })
  }

  it('clears stale when a pass applied ops and nothing else is dirty',
    async () => {
      await projectChat()
      mocks.generateText.mockResolvedValue({
        output: {
          ops: [
            {
              op: 'create',
              category: 'topics',
              slug: null,
              title: 'Writes Rust',
              description: 'Writes Rust on weekends',
              body: 'Writes Rust on weekends.',
              neverStore: null,
              evidence: 'I write Rust on weekends',
            },
          ],
        },
        usage: { inputTokens: 10, outputTokens: 5 },
      })

      const result = await sweep()
      const project = await readProject()

      expect(result.opsApplied.created).toBe(1)
      expect(project?.memoryStatus).toBe('ready')
      expect(project?.memoryDirtyAt).toBeNull()
    })

  it('clears stale to idle when the pass found nothing and there are no entries',
    async () => {
      await projectChat()

      const result = await sweep()
      const project = await readProject()

      expect(result.extractedCount).toBe(1)
      expect(project?.memoryStatus).toBe('idle')
      expect(project?.memoryDirtyAt).toBeNull()
    })

  it('clears stale to ready when the pass found nothing but entries exist',
    async () => {
      await projectChat()
      await seedEntry(testDb.db, userId, { projectId })

      await sweep()

      const project = await readProject()

      expect(project?.memoryStatus).toBe('ready')
      expect(project?.memoryDirtyAt).toBeNull()
    })

  it('clears stale after a nothing-durable skip', async () => {
    await projectChat()
    mocks.prefilter.mockResolvedValue({ action: 'skip', maxScore: 0.01 })

    const result = await sweep()
    const project = await readProject()

    expect(result.skippedCount).toBe(1)
    expect(mocks.generateText).not.toHaveBeenCalled()
    expect(project?.memoryStatus).toBe('idle')
    expect(project?.memoryDirtyAt).toBeNull()
  })

  it('clears stale after a too-short skip, the chat waits for more text',
    async () => {
      await projectChat({}, SHORT_USER_TEXT)

      const result = await sweep()
      const project = await readProject()

      expect(result.skippedCount).toBe(1)
      expect(project?.memoryStatus).toBe('idle')
      expect(project?.memoryDirtyAt).toBeNull()
    })

  it('stays stale while another chat of the project is still dirty',
    async () => {
      await projectChat({ activityAt: minutesBefore(100) })
      const recent = await projectChat({ activityAt: minutesBefore(2) })

      await sweep()

      const project = await readProject()

      expect(project?.memoryStatus).toBe('stale')
      expect(project?.memoryDirtyAt).toEqual(minutesBefore(65))
      expect((await testDb.db.query.chats.findFirst({
        where: { id: recent.id },
      }))?.projectMemorySummaryUpdatedAt).toBeNull()
    })

  it('stays stale when a dirty mark newer than the pass start raced in',
    async () => {
      await projectChat()

      const racedAt = new Date(EXTRACTION_NOW.getTime() + 60_000)

      await testDb.db.update(schema.projects)
        .set({ memoryDirtyAt: racedAt })

      await sweep()

      const project = await readProject()

      expect(project?.memoryStatus).toBe('stale')
      expect(project?.memoryDirtyAt).toEqual(racedAt)
    })

  it('never touches a disabled project', async () => {
    const chat = await projectChat()

    await testDb.db.update(schema.projects)
      .set({ memoryStatus: 'disabled', memoryDirtyAt: null })

    await settle(chat.id)

    expect((await readProject())?.memoryStatus).toBe('disabled')
  })

  it('never touches a refreshing project', async () => {
    const chat = await projectChat()

    await testDb.db.update(schema.projects)
      .set({ memoryStatus: 'refreshing' })

    await settle(chat.id)

    const project = await readProject()

    expect(project?.memoryStatus).toBe('refreshing')
    expect(project?.memoryDirtyAt).toEqual(minutesBefore(65))
  })

  it.each<ProjectMemoryStatus>(['failed', 'unavailable', 'ready'])(
    'leaves a %s project as it is',
    async (memoryStatus) => {
      const chat = await projectChat()

      await testDb.db.update(schema.projects).set({ memoryStatus })
      await settle(chat.id)

      expect((await readProject())?.memoryStatus).toBe(memoryStatus)
    },
  )

  it('settles when only chats from before the extraction cut-over are dirty',
    async () => {
      await projectChat()
      await projectChat({ activityAt: minutesBefore(2000) })

      await sweep()

      const project = await readProject()

      expect(project?.memoryStatus).toBe('idle')
      expect(project?.memoryDirtyAt).toBeNull()
    })

  it('does not let a memory-excluded dirty chat keep the project stale',
    async () => {
      const chat = await projectChat({
        projectMemorySummaryUpdatedAt: minutesBefore(30),
      })

      await seedChat(testDb.db, userId, {
        projectId,
        activityAt: minutesBefore(2),
        memoryExcluded: true,
      })
      await settle(chat.id)

      expect((await readProject())?.memoryStatus).toBe('idle')
    })

  it('ignores a chat parked on failures or on waiting for text', async () => {
    const chat = await projectChat({
      projectMemorySummaryUpdatedAt: minutesBefore(30),
    })

    await projectChat({
      activityAt: minutesBefore(50),
      memoryExtractionAttemptedAt: minutesBefore(40),
      memoryExtractionFailures: 3,
    })
    await projectChat({
      activityAt: minutesBefore(50),
      memoryExtractionAttemptedAt: minutesBefore(40),
      memoryExtractionFailures: 0,
    })
    await settle(chat.id)

    const project = await readProject()

    expect(project?.memoryStatus).toBe('idle')
    expect(project?.memoryDirtyAt).toBeNull()
  })

  it('keeps the project stale for a failing chat that will be retried',
    async () => {
      const chat = await projectChat({
        projectMemorySummaryUpdatedAt: minutesBefore(30),
      })

      await projectChat({
        activityAt: minutesBefore(50),
        memoryExtractionAttemptedAt: minutesBefore(40),
        memoryExtractionFailures: 1,
      })
      await settle(chat.id)

      expect((await readProject())?.memoryStatus).toBe('stale')
    })

  it('does nothing for an account chat', async () => {
    const chat = await seedChat(testDb.db, userId, {
      activityAt: minutesBefore(60),
    })

    await settle(chat.id)

    const project = await readProject()

    expect(project?.memoryStatus).toBe('stale')
    expect(project?.memoryDirtyAt).toEqual(minutesBefore(65))
  })
})
