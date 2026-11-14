import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'

const { assertStorageAvailable } = await import(
  '~~/server/utils/storage/guard'
)

const QUOTA_BYTES = 20 * 1024 * 1024

describe('assertStorageAvailable', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  function insertArtifact(totalBytes: number): void {
    testDb.sqlite.prepare(`
      insert into artifacts (user_id, kind, title, current_version,
        total_bytes, created_via, created_at, updated_at)
      values (?, 'html', 'Artifact', 1, ?, 'chat', 1, 1)
    `).run(userId, totalBytes)
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  it('lets a write that fits the allowance through', async () => {
    insertArtifact(QUOTA_BYTES - 10)

    await expect(assertStorageAvailable({
      userId,
      additionalBytes: 10,
      db: testDb.db,
    })).resolves.toBeUndefined()
  })

  it('refuses a write that would pass the allowance', async () => {
    insertArtifact(QUOTA_BYTES - 10)

    await expect(assertStorageAvailable({
      userId,
      additionalBytes: 11,
      db: testDb.db,
    })).rejects.toMatchObject({
      status: 413,
      message: 'Storage is full',
      why: '20.0 MB of 20.0 MB used',
    })
  })

  it('refuses every write once the account is over the allowance', async () => {
    insertArtifact(QUOTA_BYTES + 5_000)

    await expect(assertStorageAvailable({
      userId,
      additionalBytes: 1,
      db: testDb.db,
    })).rejects.toMatchObject({ status: 413 })
  })

  it('keeps existing rows when it refuses', async () => {
    insertArtifact(QUOTA_BYTES)

    await assertStorageAvailable({
      userId,
      additionalBytes: 1,
      db: testDb.db,
    }).catch(() => undefined)

    const row = testDb.sqlite
      .prepare('select count(*) as total from artifacts')
      .get() as { total: number }

    expect(row.total).toBe(1)
  })

  it('reads the global database when none is passed', async () => {
    vi.stubGlobal('useDb', () => testDb.db)
    insertArtifact(QUOTA_BYTES)

    await expect(assertStorageAvailable({ userId, additionalBytes: 1 }))
      .rejects.toMatchObject({ code: 'storage_full' })
  })
})
