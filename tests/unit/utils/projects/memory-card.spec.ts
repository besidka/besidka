import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  minutesBefore,
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

describe('buildProjectMemoryCard', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let leaseValue: string | null

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, {})
    leaseValue = null
    vi.stubGlobal('useKV', () => ({
      get: vi.fn(async () => leaseValue),
    }))
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  async function buildCard(projectId: string, forUserId = userId) {
    const { buildProjectMemoryCard } = await import(
      '~~/server/utils/projects/memory-card'
    )

    return await buildProjectMemoryCard(
      projectId,
      forUserId,
      testDb.db,
      { set: vi.fn() },
    )
  }

  it('groups the project entries and reports the limits', async () => {
    const projectId = await seedProject(testDb.db, userId, {
      memoryStatus: 'ready',
      memoryUpdatedAt: minutesBefore(5),
      memoryProvider: 'openai',
      memoryModel: 'gpt-test',
    })

    await seedEntry(testDb.db, userId, {
      projectId,
      category: 'topics',
      slug: 'rust',
      title: 'Rust',
    })
    await seedEntry(testDb.db, userId, {
      projectId,
      category: 'preferences',
      slug: 'concise',
      title: 'Concise',
    })

    const card = await buildCard(projectId)
    const topics = card.groups.find(group => group.category === 'topics')
    const preferences = card.groups.find((group) => {
      return group.category === 'preferences'
    })

    expect(card).toMatchObject({
      projectId,
      memoryStatus: 'ready',
      memoryProvider: 'openai',
      memoryModel: 'gpt-test',
      usesEntries: true,
      legacyMemory: null,
      total: 2,
    })
    expect(card.memoryUpdatedAt).toBe(minutesBefore(5).toISOString())
    expect(card.limits.maxProjectEntries).toBe(15)
    expect(topics?.entries.map(entry => entry.slug)).toEqual(['rust'])
    expect(preferences?.entries.map(entry => entry.slug)).toEqual(['concise'])
  })

  it('leaves account entries and other projects out', async () => {
    const projectId = await seedProject(testDb.db, userId)
    const otherProjectId = await seedProject(testDb.db, userId)

    await seedEntry(testDb.db, userId, { slug: 'account-entry' })
    await seedEntry(testDb.db, userId, {
      projectId: otherProjectId,
      slug: 'other-project-entry',
    })

    const card = await buildCard(projectId)

    expect(card.total).toBe(0)
    expect(card.usesEntries).toBe(false)
  })

  it('exposes an unconverted blob even when the project has entries', async () => {
    const projectId = await seedProject(testDb.db, userId, {
      memory: 'Legacy blob text.',
    })

    expect(await buildCard(projectId)).toMatchObject({
      usesEntries: false,
      legacyMemory: 'Legacy blob text.',
    })

    await seedEntry(testDb.db, userId, { projectId })

    expect(await buildCard(projectId)).toMatchObject({
      usesEntries: true,
      legacyMemory: 'Legacy blob text.',
    })
  })

  it('hides the blob once the project is marked migrated', async () => {
    const projectId = await seedProject(testDb.db, userId, {
      memory: 'Redacted blob.',
      memoryMigratedAt: minutesBefore(10),
    })

    expect(await buildCard(projectId)).toMatchObject({
      usesEntries: true,
      legacyMemory: null,
      total: 0,
    })
  })

  it('does not expose a blank blob', async () => {
    const projectId = await seedProject(testDb.db, userId, { memory: '   ' })

    expect((await buildCard(projectId)).legacyMemory).toBeNull()
  })

  it('reports a refreshing project without a live lease as stale', async () => {
    const projectId = await seedProject(testDb.db, userId, {
      memoryStatus: 'refreshing',
    })

    expect((await buildCard(projectId)).memoryStatus).toBe('stale')

    leaseValue = '1'

    expect((await buildCard(projectId)).memoryStatus).toBe('refreshing')
  })

  it('keeps the entries visible for a disabled project', async () => {
    const projectId = await seedProject(testDb.db, userId, {
      memoryStatus: 'disabled',
    })

    await seedEntry(testDb.db, userId, { projectId })

    expect(await buildCard(projectId)).toMatchObject({
      memoryStatus: 'disabled',
      total: 1,
    })
  })

  it('reads another user project as not found', async () => {
    const otherUserId = await seedUser(testDb.db, {})
    const projectId = await seedProject(testDb.db, otherUserId)

    await seedEntry(testDb.db, otherUserId, { projectId })

    await expect(buildCard(projectId)).rejects.toMatchObject({ status: 404 })
  })

  it('reads an unknown project as not found', async () => {
    await expect(buildCard('pub-99999')).rejects.toMatchObject({ status: 404 })
  })
})
