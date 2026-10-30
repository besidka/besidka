import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDueChatsQuery } from '~~/server/utils/memory/extract-sweep'
import { MEMORY_EXTRACTION_LIMITS } from '~~/server/utils/memory/extract-limits'
import { resolveProjectAutoUpdate } from '#shared/utils/project-memory-auto-update'
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

interface Scenario {
  name: string
  memoryEnabled?: boolean
  accountExtraction: boolean
  accountStampMinutes: number | null
  memoryAutoUpdate: 'on' | 'off' | null
  projectStampMinutes: number | null
  chatActivityMinutes: number
  isSelected: boolean
  isSettled: boolean
}

const scenarios: Scenario[] = [
  {
    name: 'account on, project inherits',
    accountExtraction: true,
    accountStampMinutes: 1000,
    memoryAutoUpdate: null,
    projectStampMinutes: null,
    chatActivityMinutes: 60,
    isSelected: true,
    isSettled: false,
  },
  {
    name: 'account on, project on',
    accountExtraction: true,
    accountStampMinutes: 1000,
    memoryAutoUpdate: 'on',
    projectStampMinutes: 500,
    chatActivityMinutes: 60,
    isSelected: true,
    isSettled: false,
  },
  {
    name: 'account on, project off',
    accountExtraction: true,
    accountStampMinutes: 1000,
    memoryAutoUpdate: 'off',
    projectStampMinutes: null,
    chatActivityMinutes: 60,
    isSelected: false,
    isSettled: false,
  },
  {
    name: 'account off, project inherits',
    accountExtraction: false,
    accountStampMinutes: 1000,
    memoryAutoUpdate: null,
    projectStampMinutes: null,
    chatActivityMinutes: 60,
    isSelected: false,
    isSettled: false,
  },
  {
    name: 'account off, project on',
    accountExtraction: false,
    accountStampMinutes: 1000,
    memoryAutoUpdate: 'on',
    projectStampMinutes: 500,
    chatActivityMinutes: 60,
    isSelected: true,
    isSettled: false,
  },
  {
    name: 'account off with no stamp ever, project on',
    accountExtraction: false,
    accountStampMinutes: null,
    memoryAutoUpdate: 'on',
    projectStampMinutes: 500,
    chatActivityMinutes: 60,
    isSelected: true,
    isSettled: false,
  },
  {
    name: 'account off, project off',
    accountExtraction: false,
    accountStampMinutes: 1000,
    memoryAutoUpdate: 'off',
    projectStampMinutes: null,
    chatActivityMinutes: 60,
    isSelected: false,
    isSettled: false,
  },
  {
    name: 'memory off blocks account on, project on',
    memoryEnabled: false,
    accountExtraction: true,
    accountStampMinutes: 1000,
    memoryAutoUpdate: 'on',
    projectStampMinutes: 500,
    chatActivityMinutes: 60,
    isSelected: false,
    isSettled: false,
  },
  {
    name: 'memory off blocks account off, project on',
    memoryEnabled: false,
    accountExtraction: false,
    accountStampMinutes: 1000,
    memoryAutoUpdate: 'on',
    projectStampMinutes: 500,
    chatActivityMinutes: 60,
    isSelected: false,
    isSettled: false,
  },
  {
    name: 'memory off blocks account on, project inherits',
    memoryEnabled: false,
    accountExtraction: true,
    accountStampMinutes: 1000,
    memoryAutoUpdate: null,
    projectStampMinutes: null,
    chatActivityMinutes: 60,
    isSelected: false,
    isSettled: false,
  },
  {
    name: 'account off, project on, chat from before the project cut-over',
    accountExtraction: false,
    accountStampMinutes: 1000,
    memoryAutoUpdate: 'on',
    projectStampMinutes: 30,
    chatActivityMinutes: 60,
    isSelected: false,
    isSettled: true,
  },
  {
    name: 'account on, project on, the account cut-over is the later one',
    accountExtraction: true,
    accountStampMinutes: 100,
    memoryAutoUpdate: 'on',
    projectStampMinutes: 500,
    chatActivityMinutes: 300,
    isSelected: false,
    isSettled: true,
  },
  {
    name: 'account on, project on, the project cut-over is the later one',
    accountExtraction: true,
    accountStampMinutes: 1000,
    memoryAutoUpdate: 'on',
    projectStampMinutes: 200,
    chatActivityMinutes: 300,
    isSelected: false,
    isSettled: true,
  },
  {
    name: 'account on, project on, chat after both cut-overs',
    accountExtraction: true,
    accountStampMinutes: 1000,
    memoryAutoUpdate: 'on',
    projectStampMinutes: 500,
    chatActivityMinutes: 300,
    isSelected: true,
    isSettled: false,
  },
  {
    name: 'account on, inherit, project returned from off, older chat',
    accountExtraction: true,
    accountStampMinutes: 1000,
    memoryAutoUpdate: null,
    projectStampMinutes: 200,
    chatActivityMinutes: 300,
    isSelected: false,
    isSettled: true,
  },
  {
    name: 'account on, inherit, project returned from off, newer chat',
    accountExtraction: true,
    accountStampMinutes: 1000,
    memoryAutoUpdate: null,
    projectStampMinutes: 200,
    chatActivityMinutes: 60,
    isSelected: true,
    isSettled: false,
  },
  {
    name: 'project on without a recorded cut-over',
    accountExtraction: false,
    accountStampMinutes: 1000,
    memoryAutoUpdate: 'on',
    projectStampMinutes: null,
    chatActivityMinutes: 60,
    isSelected: false,
    isSettled: true,
  },
  {
    name: 'account on without a recorded cut-over, project inherits',
    accountExtraction: true,
    accountStampMinutes: null,
    memoryAutoUpdate: null,
    projectStampMinutes: null,
    chatActivityMinutes: 60,
    isSelected: false,
    isSettled: true,
  },
]

describe('project automatic updates', () => {
  let testDb: MemoryExtractionTestDb

  beforeEach(() => {
    testDb = createMemoryExtractionTestDb()
    mocks.release.mockResolvedValue(undefined)
    mocks.acquireMemoryLease.mockResolvedValue({ release: mocks.release })
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
    vi.clearAllMocks()
  })

  function minutesOrNull(minutes: number | null) {
    return minutes === null ? null : minutesBefore(minutes)
  }

  async function seedScenario(scenario: Scenario) {
    const userId = await seedUser(testDb.db, {
      memoryEnabled: scenario.memoryEnabled ?? true,
      memoryExtractionEnabled: scenario.accountExtraction,
      memoryExtractionEnabledAt: minutesOrNull(scenario.accountStampMinutes),
    })
    const projectId = await seedProject(testDb.db, userId, {
      memoryStatus: 'stale',
      memoryDirtyAt: minutesBefore(65),
      memoryAutoUpdate: scenario.memoryAutoUpdate,
      memoryAutoUpdateEnabledAt: minutesOrNull(scenario.projectStampMinutes),
    })
    const chat = await seedChat(testDb.db, userId, {
      projectId,
      activityAt: minutesBefore(scenario.chatActivityMinutes),
    })

    await seedMessage(
      testDb.db,
      chat.id,
      'user',
      [textPart(LONG_USER_TEXT)],
      minutesBefore(scenario.chatActivityMinutes),
    )

    return { userId, projectId, chatId: chat.id }
  }

  async function selectedChatIds(batchSize = 20) {
    const rows = await buildDueChatsQuery(
      testDb.db,
      batchSize,
      EXTRACTION_NOW,
    )

    return rows.map(row => row.id)
  }

  async function settle(userId: number, chatId: string) {
    const { settleProjectMemoryAfterSweepPass } = await import(
      '~~/server/utils/projects/memory-sweep-settle'
    )

    await settleProjectMemoryAfterSweepPass({
      chatId,
      userId,
      passStartedAt: EXTRACTION_NOW,
      db: testDb.db,
    })
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

  describe('sweep, settle and the shared rule agree', () => {
    for (const scenario of scenarios) {
      it(scenario.name, async () => {
        const { userId, projectId, chatId } = await seedScenario(scenario)
        const settings = await testDb.db.query.userSettings.findFirst({
          where: { userId },
        })
        const project = await testDb.db.query.projects.findFirst({
          where: { id: projectId },
        })
        const resolved = resolveProjectAutoUpdate(project!, settings)
        const activityAt = minutesBefore(scenario.chatActivityMinutes)

        expect(await selectedChatIds()).toEqual(
          scenario.isSelected ? [chatId] : [],
        )
        expect(
          resolved.isEffective
          && !!resolved.cutOver
          && activityAt > resolved.cutOver,
        ).toBe(scenario.isSelected)

        await settle(userId, chatId)

        const settled = await testDb.db.query.projects.findFirst({
          where: { id: projectId },
        })

        expect(settled?.memoryStatus !== 'stale').toBe(scenario.isSettled)
      })
    }
  })

  describe('sweep selection', () => {
    it('never selects a chat of a disabled project, whatever its setting',
      async () => {
        for (const memoryAutoUpdate of ['on', null] as const) {
          const userId = await seedUser(testDb.db, {
            memoryExtractionEnabled: memoryAutoUpdate === null,
            memoryExtractionEnabledAt: minutesBefore(1000),
          })
          const projectId = await seedProject(testDb.db, userId, {
            memoryStatus: 'disabled',
            memoryAutoUpdate,
            memoryAutoUpdateEnabledAt: minutesBefore(500),
          })

          await seedChat(testDb.db, userId, {
            projectId,
            activityAt: minutesBefore(60),
          })
        }

        expect(await selectedChatIds()).toEqual([])
      })

    it('needs the current legal consent for a project that is on',
      async () => {
        const userId = await seedUser(testDb.db, {
          memoryExtractionEnabled: false,
          sensitiveContentConsentAt: null,
          sensitiveContentConsentVersion: null,
        })
        const projectId = await seedProject(testDb.db, userId, {
          memoryAutoUpdate: 'on',
          memoryAutoUpdateEnabledAt: minutesBefore(500),
        })

        await seedChat(testDb.db, userId, {
          projectId,
          activityAt: minutesBefore(60),
        })

        expect(await selectedChatIds()).toEqual([])
      })

    it('leaves the account chats of a user with the switch off alone',
      async () => {
        const userId = await seedUser(testDb.db, {
          memoryExtractionEnabled: false,
          memoryExtractionEnabledAt: minutesBefore(1000),
        })
        const projectId = await seedProject(testDb.db, userId, {
          memoryAutoUpdate: 'on',
          memoryAutoUpdateEnabledAt: minutesBefore(500),
        })
        const projectChat = await seedChat(testDb.db, userId, {
          projectId,
          activityAt: minutesBefore(60),
        })

        await seedChat(testDb.db, userId, { activityAt: minutesBefore(60) })

        expect(await selectedChatIds()).toEqual([projectChat.id])
      })

    it('keeps sweeping the account chats of a user whose project is off',
      async () => {
        const userId = await seedUser(testDb.db, {
          memoryExtractionEnabled: true,
          memoryExtractionEnabledAt: minutesBefore(1000),
        })
        const projectId = await seedProject(testDb.db, userId, {
          memoryAutoUpdate: 'off',
        })
        const accountChat = await seedChat(testDb.db, userId, {
          activityAt: minutesBefore(60),
        })

        await seedChat(testDb.db, userId, {
          projectId,
          activityAt: minutesBefore(60),
        })

        expect(await selectedChatIds()).toEqual([accountChat.id])
      })

    it('selects only the project that is on among several', async () => {
      const userId = await seedUser(testDb.db, {
        memoryExtractionEnabled: false,
        memoryExtractionEnabledAt: minutesBefore(1000),
      })
      const onId = await seedProject(testDb.db, userId, {
        memoryAutoUpdate: 'on',
        memoryAutoUpdateEnabledAt: minutesBefore(500),
      })
      const inheritId = await seedProject(testDb.db, userId)
      const offId = await seedProject(testDb.db, userId, {
        memoryAutoUpdate: 'off',
      })
      const onChat = await seedChat(testDb.db, userId, {
        projectId: onId,
        activityAt: minutesBefore(60),
      })

      await seedChat(testDb.db, userId, {
        projectId: inheritId,
        activityAt: minutesBefore(60),
      })
      await seedChat(testDb.db, userId, {
        projectId: offId,
        activityAt: minutesBefore(60),
      })

      expect(await selectedChatIds()).toEqual([onChat.id])
    })

    it('does not select a chat that points at a project of another user',
      async () => {
        const owner = await seedUser(testDb.db, {
          memoryExtractionEnabled: false,
        })
        const stranger = await seedUser(testDb.db, {
          memoryExtractionEnabled: false,
        })
        const projectId = await seedProject(testDb.db, owner, {
          memoryAutoUpdate: 'on',
          memoryAutoUpdateEnabledAt: minutesBefore(500),
        })

        await seedChat(testDb.db, stranger, {
          projectId,
          activityAt: minutesBefore(60),
        })

        expect(await selectedChatIds()).toEqual([])
      })

    it('keeps the per-user cap for a user with the switch off', async () => {
      const userId = await seedUser(testDb.db, {
        memoryExtractionEnabled: false,
      })
      const projectId = await seedProject(testDb.db, userId, {
        memoryAutoUpdate: 'on',
        memoryAutoUpdateEnabledAt: minutesBefore(500),
      })
      const cap = MEMORY_EXTRACTION_LIMITS.perUserCapPerTick

      for (let index = 0; index < cap + 3; index += 1) {
        await seedChat(testDb.db, userId, {
          projectId,
          activityAt: minutesBefore(60 + index),
        })
      }

      expect(await selectedChatIds()).toHaveLength(cap)
    })

    it('keeps the idle window for a project that is on', async () => {
      const userId = await seedUser(testDb.db, {
        memoryExtractionEnabled: false,
      })
      const projectId = await seedProject(testDb.db, userId, {
        memoryAutoUpdate: 'on',
        memoryAutoUpdateEnabledAt: minutesBefore(500),
      })

      await seedChat(testDb.db, userId, {
        projectId,
        activityAt: minutesBefore(2),
      })

      expect(await selectedChatIds()).toEqual([])
    })
  })

  describe('extraction pass', () => {
    function projectChatProcessed(chatId: string) {
      return testDb.db.query.chats.findFirst({ where: { id: chatId } })
        .then(chat => chat?.projectMemorySummaryUpdatedAt !== null)
    }

    it('extracts a project that is on although the account switch is off',
      async () => {
        const { chatId } = await seedScenario({
          name: 'end to end',
          accountExtraction: false,
          accountStampMinutes: 1000,
          memoryAutoUpdate: 'on',
          projectStampMinutes: 500,
          chatActivityMinutes: 60,
          isSelected: true,
          isSettled: true,
        })
        const result = await sweep()

        expect(result).toMatchObject({ selectedCount: 1, extractedCount: 1 })
        expect(mocks.generateText).toHaveBeenCalledTimes(1)
        expect(await projectChatProcessed(chatId)).toBe(true)
      })

    it('never reads messages from before the project cut-over', async () => {
      const { chatId } = await seedScenario({
        name: 'end to end',
        accountExtraction: false,
        accountStampMinutes: 1000,
        memoryAutoUpdate: 'on',
        projectStampMinutes: 500,
        chatActivityMinutes: 60,
        isSelected: true,
        isSettled: true,
      })

      await seedMessage(
        testDb.db,
        chatId,
        'user',
        [textPart(`Old message about Go. ${'I like Go. '.repeat(40)}`)],
        minutesBefore(700),
      )

      await sweep()

      const prompt = JSON.stringify(mocks.generateText.mock.calls[0]?.[0])

      expect(prompt).toContain('Rust')
      expect(prompt).not.toContain('Old message about Go')
    })

    it('runs nothing for a project that is off under an account that is on',
      async () => {
        const { chatId } = await seedScenario({
          name: 'end to end',
          accountExtraction: true,
          accountStampMinutes: 1000,
          memoryAutoUpdate: 'off',
          projectStampMinutes: null,
          chatActivityMinutes: 60,
          isSelected: false,
          isSettled: false,
        })
        const result = await sweep()

        expect(result.selectedCount).toBe(0)
        expect(mocks.generateText).not.toHaveBeenCalled()
        expect(await projectChatProcessed(chatId)).toBe(false)
      })

    it('settles the project card after the pass of a project that is on',
      async () => {
        const { projectId } = await seedScenario({
          name: 'end to end',
          accountExtraction: false,
          accountStampMinutes: 1000,
          memoryAutoUpdate: 'on',
          projectStampMinutes: 500,
          chatActivityMinutes: 60,
          isSelected: true,
          isSettled: true,
        })

        await sweep()

        const project = await testDb.db.query.projects.findFirst({
          where: { id: projectId },
        })

        expect(project?.memoryStatus).toBe('idle')
        expect(project?.memoryDirtyAt).toBeNull()
      })

    it('keeps the stale mark while a newer chat of the project is waiting',
      async () => {
        const { userId, projectId, chatId } = await seedScenario({
          name: 'end to end',
          accountExtraction: false,
          accountStampMinutes: 1000,
          memoryAutoUpdate: 'on',
          projectStampMinutes: 500,
          chatActivityMinutes: 60,
          isSelected: true,
          isSettled: true,
        })

        await seedChat(testDb.db, userId, {
          projectId,
          activityAt: minutesBefore(5),
        })
        await sweep()
        await settle(userId, chatId)

        const project = await testDb.db.query.projects.findFirst({
          where: { id: projectId },
        })

        expect(project?.memoryStatus).toBe('stale')
      })
  })
})
