import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedProject,
  seedUser,
} from '../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => {
  return {
    invalidateStorageCache: vi.fn(),
    purgeProjectKnowledgeForProject: vi.fn(),
    unlinkKnowledgeProjectFiles: vi.fn(),
    getEffectiveRetentionDays: vi.fn(),
    logger: { set: vi.fn() },
  }
})

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/api/v1/storage/index.get', () => {
  return { invalidateStorageCache: mocks.invalidateStorageCache }
})

vi.mock('~~/server/utils/knowledge/purge', () => {
  return {
    purgeProjectKnowledgeForProject: mocks.purgeProjectKnowledgeForProject,
  }
})

vi.mock('~~/server/utils/knowledge/linked-files', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/knowledge/linked-files')
  >()

  return {
    ...original,
    unlinkKnowledgeProjectFiles: mocks.unlinkKnowledgeProjectFiles,
  }
})

vi.mock('~~/server/utils/files/file-governance', () => {
  return { getEffectiveRetentionDays: mocks.getEffectiveRetentionDays }
})

describe('project lifecycle helpers', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    mocks.invalidateStorageCache.mockReset()
    mocks.purgeProjectKnowledgeForProject.mockReset()
    mocks.unlinkKnowledgeProjectFiles.mockReset()
    mocks.getEffectiveRetentionDays.mockReset()
    mocks.logger.set.mockReset()
    mocks.purgeProjectKnowledgeForProject.mockResolvedValue({
      objectsDeleted: 2,
      batches: 1,
    })
    mocks.getEffectiveRetentionDays.mockResolvedValue(30)
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, {})
  })

  afterEach(() => {
    testDb.close()
  })

  async function readProject(projectId: string) {
    const [project] = await testDb.db.select({
      name: schema.projects.name,
      pinnedAt: schema.projects.pinnedAt,
      archivedAt: schema.projects.archivedAt,
    })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))

    return project
  }

  it('renames an owned project and not a foreign one', async () => {
    const { renameProject } = await import(
      '~~/server/utils/projects/lifecycle'
    )
    const ownProject = await seedProject(testDb.db, userId)
    const otherUserId = await seedUser(testDb.db, {})
    const foreignProject = await seedProject(testDb.db, otherUserId)

    expect(await renameProject(testDb.db, userId, ownProject, 'New'))
      .toEqual({ name: 'New' })
    expect((await readProject(ownProject))!.name).toBe('New')

    await expect(renameProject(testDb.db, userId, foreignProject, 'New'))
      .rejects.toMatchObject({ status: 404 })
    expect((await readProject(foreignProject))!.name).toBe('Project')
  })

  it.each([
    ['setProjectPinned', 'pinnedAt'],
    ['setProjectArchived', 'archivedAt'],
  ] as const)('%s toggles without a value and sets with one', async (
    functionName,
    column,
  ) => {
    const lifecycle = await import('~~/server/utils/projects/lifecycle')
    const apply = lifecycle[functionName]
    const projectId = await seedProject(testDb.db, userId)

    await apply(testDb.db, userId, projectId)
    expect((await readProject(projectId))![column]).toBeInstanceOf(Date)

    await apply(testDb.db, userId, projectId)
    expect((await readProject(projectId))![column]).toBeNull()

    await apply(testDb.db, userId, projectId, false)
    expect((await readProject(projectId))![column]).toBeNull()

    await apply(testDb.db, userId, projectId, true)

    const firstValue = (await readProject(projectId))![column]

    expect(firstValue).toBeInstanceOf(Date)

    await apply(testDb.db, userId, projectId, true)
    expect((await readProject(projectId))![column]).toEqual(firstValue)

    await apply(testDb.db, userId, projectId, false)
    expect((await readProject(projectId))![column]).toBeNull()
  })

  it('reads another user project as not found when pinning or archiving',
    async () => {
      const { setProjectPinned, setProjectArchived } = await import(
        '~~/server/utils/projects/lifecycle'
      )
      const otherUserId = await seedUser(testDb.db, {})
      const foreignProject = await seedProject(testDb.db, otherUserId)

      await expect(setProjectPinned(testDb.db, userId, foreignProject, true))
        .rejects.toMatchObject({ status: 404 })
      await expect(
        setProjectArchived(testDb.db, userId, foreignProject, true),
      ).rejects.toMatchObject({ status: 404 })
      expect((await readProject(foreignProject))!.pinnedAt).toBeNull()
    })

  it('deletes the project, keeps and detaches its chats, and purges',
    async () => {
      const { deleteProject } = await import(
        '~~/server/utils/projects/lifecycle'
      )
      const projectId = await seedProject(testDb.db, userId)
      const otherProjectId = await seedProject(testDb.db, userId)
      const firstChat = await seedChat(testDb.db, userId, { projectId })
      const secondChat = await seedChat(testDb.db, userId, { projectId })
      const untouchedChat = await seedChat(testDb.db, userId, {
        projectId: otherProjectId,
      })

      const result = await deleteProject(
        testDb.db,
        userId,
        projectId,
        mocks.logger,
      )
      const chats = await testDb.db.select({
        id: schema.chats.id,
        projectId: schema.chats.projectId,
      }).from(schema.chats)

      expect(result).toEqual({ chatsDetached: 2 })
      expect(await readProject(projectId)).toBeUndefined()
      expect(chats).toHaveLength(3)
      expect(chats.find(chat => chat.id === firstChat.id)!.projectId)
        .toBeNull()
      expect(chats.find(chat => chat.id === secondChat.id)!.projectId)
        .toBeNull()
      expect(chats.find(chat => chat.id === untouchedChat.id)!.projectId)
        .toBe(otherProjectId)
      expect(mocks.unlinkKnowledgeProjectFiles).toHaveBeenCalledWith({
        userId,
        projectId: Number(projectId.slice(4)),
        retentionDays: 30,
      })
      expect(mocks.purgeProjectKnowledgeForProject)
        .toHaveBeenCalledWith(userId, Number(projectId.slice(4)))
      expect(mocks.invalidateStorageCache)
        .toHaveBeenCalledWith(userId, mocks.logger)
    })

  it('still deletes when the R2 purge fails', async () => {
    const { deleteProject } = await import(
      '~~/server/utils/projects/lifecycle'
    )
    const projectId = await seedProject(testDb.db, userId)

    mocks.purgeProjectKnowledgeForProject
      .mockRejectedValue(new Error('r2 down'))

    await expect(
      deleteProject(testDb.db, userId, projectId, mocks.logger),
    ).resolves.toEqual({ chatsDetached: 0 })
    expect(await readProject(projectId)).toBeUndefined()
    expect(mocks.logger.set).toHaveBeenCalledWith({
      attributes: {
        knowledgePurge: { failed: true, error: expect.any(String) },
      },
    })
    expect(mocks.invalidateStorageCache).toHaveBeenCalled()
  })

  it('deletes nothing for another user project', async () => {
    const { deleteProject } = await import(
      '~~/server/utils/projects/lifecycle'
    )
    const otherUserId = await seedUser(testDb.db, {})
    const foreignProject = await seedProject(testDb.db, otherUserId)

    await expect(
      deleteProject(testDb.db, userId, foreignProject, mocks.logger),
    ).rejects.toMatchObject({ status: 404 })
    expect(await readProject(foreignProject)).toBeDefined()
    expect(mocks.purgeProjectKnowledgeForProject).not.toHaveBeenCalled()
  })
})
