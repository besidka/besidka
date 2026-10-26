import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
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

describe('setProjectUseAccountMemory', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, {})
    vi.stubGlobal('useKV', () => ({
      get: vi.fn(async () => null),
    }))
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  async function setValue(
    projectId: string,
    value: boolean,
    forUserId = userId,
  ) {
    const { setProjectUseAccountMemory } = await import(
      '~~/server/utils/projects/memory-account'
    )

    return await setProjectUseAccountMemory(
      projectId,
      forUserId,
      value,
      testDb.db,
      { set: vi.fn() },
    )
  }

  async function readStoredValue(projectId: string) {
    const [project] = await testDb.db
      .select({ useAccountMemory: schema.projects.useAccountMemory })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))

    return project!.useAccountMemory
  }

  it('stores false and true explicitly and returns the card', async () => {
    const projectId = await seedProject(testDb.db, userId)

    expect(await readStoredValue(projectId)).toBeNull()

    const isolated = await setValue(projectId, false)

    expect(isolated).toMatchObject({ projectId, useAccountMemory: false })
    expect(await readStoredValue(projectId)).toBe(false)

    const shared = await setValue(projectId, true)

    expect(shared).toMatchObject({ projectId, useAccountMemory: true })
    expect(await readStoredValue(projectId)).toBe(true)
  })

  it('leaves the memory lifecycle fields untouched', async () => {
    const projectId = await seedProject(testDb.db, userId, {
      memoryStatus: 'disabled',
    })

    const card = await setValue(projectId, false)

    expect(card.memoryStatus).toBe('disabled')
  })

  it('reads another user project as not found and changes nothing',
    async () => {
      const otherUserId = await seedUser(testDb.db, {})
      const projectId = await seedProject(testDb.db, otherUserId)

      await expect(setValue(projectId, false)).rejects.toMatchObject({
        status: 404,
      })
      expect(await readStoredValue(projectId)).toBeNull()
    })

  it('reads an unknown project as not found', async () => {
    await expect(setValue('pub-99999', false)).rejects.toMatchObject({
      status: 404,
    })
  })
})
