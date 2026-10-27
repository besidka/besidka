import { encodePublicId } from '~~/server/utils/custom-db-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryTestDb } from '../../../setup/helpers/memory-db'
import type { MemoryTestDb } from '../../../setup/helpers/memory-db'
import { resolveLegacyProjectMemory } from '../../../../server/utils/projects/legacy-memory'

const BLOB = 'User prefers milestone-based updates.'

describe('resolveLegacyProjectMemory', () => {
  let testDb: MemoryTestDb
  let projectId: string
  const logger = { set: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    testDb = createMemoryTestDb()
    projectId = encodePublicId(1)
    testDb.insertProject({ id: 1, userId: 7, memory: BLOB })
  })

  afterEach(() => {
    testDb.close()
  })

  it('keeps the blob for an unmigrated project without entries', async () => {
    const result = await resolveLegacyProjectMemory(
      { id: projectId, memory: BLOB, memoryMigratedAt: null },
      7,
      testDb.db,
      logger,
    )

    expect(result).toBe(BLOB)
    expect(logger.set).not.toHaveBeenCalled()
  })

  it('drops the blob once the project is migrated', async () => {
    const result = await resolveLegacyProjectMemory(
      { id: projectId, memory: BLOB, memoryMigratedAt: new Date() },
      7,
      testDb.db,
      logger,
    )

    expect(result).toBeNull()
  })

  it('drops the blob when the user owns an entry scoped to the project', async () => {
    testDb.insertEntry({ userId: 7, projectId: 1, slug: 'overview' })
    const result = await resolveLegacyProjectMemory(
      { id: projectId, memory: BLOB, memoryMigratedAt: null },
      7,
      testDb.db,
      logger,
    )

    expect(result).toBeNull()
  })

  it('ignores entries of other users and other projects', async () => {
    testDb.insertEntry({ userId: 8, projectId: 1, slug: 'overview' })
    testDb.insertEntry({ userId: 7, projectId: 2, slug: 'overview' })
    testDb.insertEntry({ userId: 7, slug: 'account-fact' })

    const result = await resolveLegacyProjectMemory(
      { id: projectId, memory: BLOB, memoryMigratedAt: null },
      7,
      testDb.db,
      logger,
    )

    expect(result).toBe(BLOB)
  })

  it('keeps a null blob null', async () => {
    const result = await resolveLegacyProjectMemory(
      { id: projectId, memory: null, memoryMigratedAt: null },
      7,
      testDb.db,
      logger,
    )

    expect(result).toBeNull()
  })

  it('keeps the blob and logs the message when the lookup throws', async () => {
    const failingDb = {
      query: {
        memoryEntries: {
          findFirst: vi.fn(async () => {
            throw new Error('d1 unavailable')
          }),
        },
      },
    }

    const result = await resolveLegacyProjectMemory(
      { id: projectId, memory: BLOB, memoryMigratedAt: null },
      7,
      failingDb as never,
      logger,
    )

    expect(result).toBe(BLOB)
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        projectMemory: { dedupeError: 'd1 unavailable' },
      },
    })
  })
})
