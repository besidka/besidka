import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveProjectAutoUpdate } from '#shared/utils/project-memory-auto-update'
import { buildDueChatsQuery } from '~~/server/utils/memory/extract-sweep'
import { applyUserSettingsUpdate } from '~~/server/utils/settings/apply-user-settings'
import { applyProjectMemoryEnabled } from '~~/server/utils/projects/memory-toggle'
import {
  EXTRACTION_NOW,
  createMemoryExtractionTestDb,
  minutesBefore,
  seedChat,
  seedProject,
  seedUser,
} from '../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock(
  '~~/server/utils/memory/extraction-enable-cooldown',
  () => ({ claimExtractionEnableCooldown: vi.fn() }),
)

describe('automatic memory updates stay forward-only across off and on', () => {
  let testDb: MemoryExtractionTestDb

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    testDb = createMemoryExtractionTestDb()
  })

  afterEach(() => {
    vi.useRealTimers()
    testDb.close()
  })

  async function selectedChatIds() {
    const rows = await buildDueChatsQuery(testDb.db, 20, EXTRACTION_NOW)

    return rows.map(row => row.id)
  }

  async function sharedRuleAllows(
    userId: number,
    projectId: string,
    activityAt: Date,
  ) {
    const settings = await testDb.db.query.userSettings.findFirst({
      where: { userId },
    })
    const project = await testDb.db.query.projects.findFirst({
      where: { id: projectId },
    })
    const resolved = resolveProjectAutoUpdate(project!, settings)

    return resolved.isEffective
      && !!resolved.cutOver
      && activityAt > resolved.cutOver
  }

  async function setMemoryEnabled(
    userId: number,
    memoryEnabled: boolean,
    at: Date,
  ) {
    vi.setSystemTime(at)

    await applyUserSettingsUpdate({
      db: testDb.db,
      userId,
      fieldUpdates: { memoryEnabled },
    })
  }

  describe('account memory turned off and on', () => {
    it('never reads project chats written while memory was off for a '
      + 'project that is on with the account switch off', async () => {
      const userId = await seedUser(testDb.db, {
        memoryEnabled: true,
        memoryExtractionEnabled: false,
      })
      const projectId = await seedProject(testDb.db, userId, {
        memoryAutoUpdate: 'on',
        memoryAutoUpdateEnabledAt: minutesBefore(500),
      })
      const duringOff = minutesBefore(300)
      const afterOn = minutesBefore(100)

      await setMemoryEnabled(userId, false, minutesBefore(400))

      const chatWhileOff = await seedChat(testDb.db, userId, {
        projectId,
        activityAt: duringOff,
      })

      expect(await selectedChatIds()).toEqual([])

      await setMemoryEnabled(userId, true, minutesBefore(200))

      expect(await selectedChatIds()).not.toContain(chatWhileOff.id)
      expect(await sharedRuleAllows(userId, projectId, duringOff))
        .toBe(false)

      const chatAfterOn = await seedChat(testDb.db, userId, {
        projectId,
        activityAt: afterOn,
      })

      expect(await selectedChatIds()).toEqual([chatAfterOn.id])
      expect(await sharedRuleAllows(userId, projectId, afterOn)).toBe(true)
    })

    it('moves only the cut-over of projects that are on', async () => {
      const userId = await seedUser(testDb.db, {
        memoryEnabled: false,
        memoryExtractionEnabled: false,
      })
      const originalCutOver = minutesBefore(500)
      const onId = await seedProject(testDb.db, userId, {
        memoryAutoUpdate: 'on',
        memoryAutoUpdateEnabledAt: originalCutOver,
      })
      const offId = await seedProject(testDb.db, userId, {
        memoryAutoUpdate: 'off',
      })
      const inheritId = await seedProject(testDb.db, userId, {
        memoryAutoUpdateEnabledAt: originalCutOver,
      })
      const strangerId = await seedUser(testDb.db, {
        memoryEnabled: false,
        memoryExtractionEnabled: false,
      })
      const strangerProjectId = await seedProject(testDb.db, strangerId, {
        memoryAutoUpdate: 'on',
        memoryAutoUpdateEnabledAt: originalCutOver,
      })
      const turnedOnAt = minutesBefore(200)

      await setMemoryEnabled(userId, true, turnedOnAt)

      const read = async (id: string) => {
        const project = await testDb.db.query.projects.findFirst({
          where: { id },
        })

        return project!.memoryAutoUpdateEnabledAt
      }

      expect(await read(onId)).toEqual(turnedOnAt)
      expect(await read(offId)).toBeNull()
      expect(await read(inheritId)).toEqual(originalCutOver)
      expect(await read(strangerProjectId)).toEqual(originalCutOver)
    })

    it('does not move the cut-over when memory stays on or goes off',
      async () => {
        const userId = await seedUser(testDb.db, {
          memoryEnabled: true,
          memoryExtractionEnabled: false,
        })
        const originalCutOver = minutesBefore(500)
        const projectId = await seedProject(testDb.db, userId, {
          memoryAutoUpdate: 'on',
          memoryAutoUpdateEnabledAt: originalCutOver,
        })

        await setMemoryEnabled(userId, true, minutesBefore(300))
        await setMemoryEnabled(userId, false, minutesBefore(250))

        const project = await testDb.db.query.projects.findFirst({
          where: { id: projectId },
        })

        expect(project!.memoryAutoUpdateEnabledAt).toEqual(originalCutOver)
      })

    it('never reads account chats written while memory was off when the '
      + 'account switch is on', async () => {
      const userId = await seedUser(testDb.db, {
        memoryEnabled: true,
        memoryExtractionEnabled: true,
        memoryExtractionEnabledAt: minutesBefore(500),
      })
      const projectId = await seedProject(testDb.db, userId, {
        memoryAutoUpdateEnabledAt: null,
      })

      await setMemoryEnabled(userId, false, minutesBefore(400))

      const accountChatWhileOff = await seedChat(testDb.db, userId, {
        activityAt: minutesBefore(300),
      })
      const projectChatWhileOff = await seedChat(testDb.db, userId, {
        projectId,
        activityAt: minutesBefore(300),
      })

      await setMemoryEnabled(userId, true, minutesBefore(200))

      expect(await selectedChatIds()).toEqual([])
      expect(await sharedRuleAllows(
        userId,
        projectId,
        minutesBefore(300),
      )).toBe(false)

      const accountChatAfterOn = await seedChat(testDb.db, userId, {
        activityAt: minutesBefore(100),
      })
      const projectChatAfterOn = await seedChat(testDb.db, userId, {
        projectId,
        activityAt: minutesBefore(100),
      })

      expect((await selectedChatIds()).sort()).toEqual(
        [accountChatAfterOn.id, projectChatAfterOn.id].sort(),
      )
      expect(await sharedRuleAllows(
        userId,
        projectId,
        minutesBefore(100),
      )).toBe(true)
      expect([accountChatWhileOff.id, projectChatWhileOff.id])
        .not.toContain(accountChatAfterOn.id)
    })
  })

  describe('project memory turned off and on', () => {
    async function seedDisabledProject(
      memoryAutoUpdate: 'on' | 'off' | null,
    ) {
      const userId = await seedUser(testDb.db, {
        memoryEnabled: true,
        memoryExtractionEnabled: false,
      })
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'disabled',
        memoryAutoUpdate,
        memoryAutoUpdateEnabledAt: memoryAutoUpdate === 'on'
          ? minutesBefore(500)
          : null,
      })

      return { userId, projectId }
    }

    it('never reads chats written while the project memory was off',
      async () => {
        const { userId, projectId } = await seedDisabledProject('on')
        const chatWhileDisabled = await seedChat(testDb.db, userId, {
          projectId,
          activityAt: minutesBefore(300),
        })

        vi.setSystemTime(minutesBefore(200))
        await applyProjectMemoryEnabled(projectId, userId, true, testDb.db)

        expect(await selectedChatIds()).not.toContain(chatWhileDisabled.id)
        expect(await sharedRuleAllows(
          userId,
          projectId,
          minutesBefore(300),
        )).toBe(false)

        const chatAfterOn = await seedChat(testDb.db, userId, {
          projectId,
          activityAt: minutesBefore(100),
        })

        expect(await selectedChatIds()).toEqual([chatAfterOn.id])
        expect(await sharedRuleAllows(
          userId,
          projectId,
          minutesBefore(100),
        )).toBe(true)
      })

    it('stamps a project that follows the account but keeps off cleared',
      async () => {
        const inherit = await seedDisabledProject(null)
        const off = await seedDisabledProject('off')

        vi.setSystemTime(minutesBefore(200))
        await applyProjectMemoryEnabled(
          inherit.projectId,
          inherit.userId,
          true,
          testDb.db,
        )
        await applyProjectMemoryEnabled(
          off.projectId,
          off.userId,
          true,
          testDb.db,
        )

        const inheritProject = await testDb.db.query.projects.findFirst({
          where: { id: inherit.projectId },
        })
        const offProject = await testDb.db.query.projects.findFirst({
          where: { id: off.projectId },
        })

        expect(inheritProject!.memoryAutoUpdateEnabledAt)
          .toEqual(minutesBefore(200))
        expect(offProject!.memoryAutoUpdateEnabledAt).toBeNull()
      })

    it('leaves the cut-over alone when memory was already on', async () => {
      const userId = await seedUser(testDb.db, {
        memoryEnabled: true,
        memoryExtractionEnabled: false,
      })
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'idle',
        memoryAutoUpdate: 'on',
        memoryAutoUpdateEnabledAt: minutesBefore(500),
      })

      vi.setSystemTime(minutesBefore(200))

      expect(await applyProjectMemoryEnabled(
        projectId,
        userId,
        true,
        testDb.db,
      )).toBe('unchanged')

      const project = await testDb.db.query.projects.findFirst({
        where: { id: projectId },
      })

      expect(project!.memoryAutoUpdateEnabledAt)
        .toEqual(minutesBefore(500))
    })
  })
})
