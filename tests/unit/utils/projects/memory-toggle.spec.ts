import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedEntry,
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

describe('project memory toggle helpers', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, {})
  })

  afterEach(() => {
    testDb.close()
  })

  async function readState(projectId: string) {
    const [project] = await testDb.db
      .select({
        memoryStatus: schema.projects.memoryStatus,
        memoryError: schema.projects.memoryError,
        useAccountMemory: schema.projects.useAccountMemory,
      })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))

    return project!
  }

  it('turns memory off and keeps the entries', async () => {
    const { applyProjectMemoryEnabled } = await import(
      '~~/server/utils/projects/memory-toggle'
    )
    const projectId = await seedProject(testDb.db, userId, {
      memoryStatus: 'ready',
    })

    await seedEntry(testDb.db, userId, { projectId })

    const outcome = await applyProjectMemoryEnabled(
      projectId,
      userId,
      false,
      testDb.db,
    )
    const entries = await testDb.db.select({ id: schema.memoryEntries.id })
      .from(schema.memoryEntries)

    expect(outcome).toBe('disabled')
    expect((await readState(projectId)).memoryStatus).toBe('disabled')
    expect(entries).toHaveLength(1)
  })

  it('restores ready or idle from the entries when turned on', async () => {
    const { applyProjectMemoryEnabled } = await import(
      '~~/server/utils/projects/memory-toggle'
    )
    const withEntries = await seedProject(testDb.db, userId, {
      memoryStatus: 'disabled',
    })
    const withoutEntries = await seedProject(testDb.db, userId, {
      memoryStatus: 'disabled',
    })

    await seedEntry(testDb.db, userId, { projectId: withEntries })

    expect(await applyProjectMemoryEnabled(
      withEntries,
      userId,
      true,
      testDb.db,
    )).toBe('enabled')
    expect(await applyProjectMemoryEnabled(
      withoutEntries,
      userId,
      true,
      testDb.db,
    )).toBe('enabled')
    expect((await readState(withEntries)).memoryStatus).toBe('ready')
    expect((await readState(withoutEntries)).memoryStatus).toBe('idle')
  })

  describe('forward-only re-enable', () => {
    async function readSummaryStamp(chatId: string) {
      const [chat] = await testDb.db
        .select({
          stamp: schema.chats.projectMemorySummaryUpdatedAt,
        })
        .from(schema.chats)
        .where(eq(schema.chats.id, chatId))

      return chat!.stamp
    }

    it('stamps only the project chats when forwardOnly is set', async () => {
      const { applyProjectMemoryEnabled } = await import(
        '~~/server/utils/projects/memory-toggle'
      )
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'disabled',
      })
      const otherProjectId = await seedProject(testDb.db, userId)
      const projectChat = await seedChat(testDb.db, userId, { projectId })
      const otherProjectChat = await seedChat(testDb.db, userId, {
        projectId: otherProjectId,
      })
      const looseChat = await seedChat(testDb.db, userId)
      const before = Date.now() - 1000

      const outcome = await applyProjectMemoryEnabled(
        projectId,
        userId,
        true,
        testDb.db,
        { forwardOnly: true },
      )

      expect(outcome).toBe('enabled')
      expect((await readSummaryStamp(projectChat.id))!.getTime())
        .toBeGreaterThan(before)
      expect(await readSummaryStamp(otherProjectChat.id)).toBeNull()
      expect(await readSummaryStamp(looseChat.id)).toBeNull()
    })

    it('leaves the chats alone without forwardOnly', async () => {
      const { applyProjectMemoryEnabled } = await import(
        '~~/server/utils/projects/memory-toggle'
      )
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'disabled',
      })
      const chat = await seedChat(testDb.db, userId, { projectId })

      await applyProjectMemoryEnabled(projectId, userId, true, testDb.db)

      expect(await readSummaryStamp(chat.id)).toBeNull()
    })

    it('does not stamp when the project was already on', async () => {
      const { applyProjectMemoryEnabled } = await import(
        '~~/server/utils/projects/memory-toggle'
      )
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'ready',
      })
      const chat = await seedChat(testDb.db, userId, { projectId })

      const outcome = await applyProjectMemoryEnabled(
        projectId,
        userId,
        true,
        testDb.db,
        { forwardOnly: true },
      )

      expect(outcome).toBe('unchanged')
      expect(await readSummaryStamp(chat.id)).toBeNull()
    })
  })

  it('leaves a project that is already on unchanged', async () => {
    const { applyProjectMemoryEnabled } = await import(
      '~~/server/utils/projects/memory-toggle'
    )
    const projectId = await seedProject(testDb.db, userId, {
      memoryStatus: 'stale',
    })

    expect(await applyProjectMemoryEnabled(
      projectId,
      userId,
      true,
      testDb.db,
    )).toBe('unchanged')
    expect((await readState(projectId)).memoryStatus).toBe('stale')
  })

  it('reads another user project as not found', async () => {
    const { applyProjectMemoryEnabled, applyProjectUseAccountMemory }
      = await import('~~/server/utils/projects/memory-toggle')
    const otherUserId = await seedUser(testDb.db, {})
    const projectId = await seedProject(testDb.db, otherUserId, {
      memoryStatus: 'ready',
    })

    await expect(applyProjectMemoryEnabled(
      projectId,
      userId,
      false,
      testDb.db,
    )).rejects.toMatchObject({ status: 404 })
    await expect(applyProjectUseAccountMemory(
      projectId,
      userId,
      false,
      testDb.db,
    )).rejects.toMatchObject({ status: 404 })
    expect((await readState(projectId)).memoryStatus).toBe('ready')
    expect((await readState(projectId)).useAccountMemory).toBeNull()
  })

  it('stores the account memory choice explicitly', async () => {
    const { applyProjectUseAccountMemory } = await import(
      '~~/server/utils/projects/memory-toggle'
    )
    const projectId = await seedProject(testDb.db, userId)

    await applyProjectUseAccountMemory(projectId, userId, false, testDb.db)
    expect((await readState(projectId)).useAccountMemory).toBe(false)

    await applyProjectUseAccountMemory(projectId, userId, true, testDb.db)
    expect((await readState(projectId)).useAccountMemory).toBe(true)
  })
})
