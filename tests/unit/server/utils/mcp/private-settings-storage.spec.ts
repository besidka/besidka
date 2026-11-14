import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'

const { getMcpStorage } = await import(
  '~~/server/utils/mcp/private/settings'
)

describe('get_settings storage block', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
  })

  it('reports the allowance and an empty breakdown for a new account', async () => {
    expect(await getMcpStorage(testDb.db, userId)).toEqual({
      usedBytes: 0,
      totalBytes: 20 * 1024 * 1024,
      categories: [
        { id: 'aiImages', bytes: 0, count: 0 },
        { id: 'uploads', bytes: 0, count: 0 },
        { id: 'generatedFiles', bytes: 0, count: 0 },
        { id: 'artifacts', bytes: 0, count: 0 },
        { id: 'knowledge', bytes: 0, count: 0 },
      ],
    })
  })

  it('counts files and artifacts in one used number', async () => {
    testDb.sqlite.prepare(`
      insert into files (user_id, storage_key, name, size, type, source,
        created_at, updated_at)
      values (?, 'key-1', 'cat.png', 300, 'image/png', 'assistant', 1, 1)
    `).run(userId)
    testDb.sqlite.prepare(`
      insert into artifacts (user_id, kind, title, current_version,
        total_bytes, created_via, created_at, updated_at)
      values (?, 'html', 'Quiz', 1, 700, 'chat', 1, 1)
    `).run(userId)

    const storage = await getMcpStorage(testDb.db, userId)

    expect(storage.usedBytes).toBe(1_000)
    expect(storage.categories.find(entry => entry.id === 'aiImages'))
      .toEqual({ id: 'aiImages', bytes: 300, count: 1 })
    expect(storage.categories.find(entry => entry.id === 'artifacts'))
      .toEqual({ id: 'artifacts', bytes: 700, count: 1 })
  })
})
