import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedProject,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => ({
  logger: { set: vi.fn() },
  sessionUserId: 0,
  kvGet: vi.fn(),
  kvPut: vi.fn(),
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

async function importHandler() {
  const module = await import('../../../server/api/v1/storage/index.get')

  return module.default as (event: unknown) => Promise<any>
}

describe('storage API', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  function seedData(projectId: number) {
    testDb.sqlite.prepare(`
      insert into files (user_id, storage_key, name, size, type, source,
        created_at, updated_at)
      values (?, 'a', 'a.png', 1000, 'image/png', 'assistant', 1, 1),
        (?, 'b', 'b.pdf', 2000, 'application/pdf', 'upload', 1, 1),
        (?, 'c', 'c.pdf', 3000, 'application/pdf', 'assistant', 1, 1)
    `).run(userId, userId, userId)
    testDb.sqlite.prepare(`
      insert into artifacts (user_id, kind, title, current_version,
        total_bytes, created_via, created_at, updated_at)
      values (?, 'html', 'Quiz', 1, 4000, 'chat', 1, 1)
    `).run(userId)
    testDb.sqlite.prepare(`
      insert into project_knowledge_items (user_id, project_id, kind, title,
        content_hash, text_bytes, latin_chars, cyrillic_chars, other_chars,
        extract_status, extractor, created_at, updated_at)
      values (?, ?, 'note', 'Note', 'hash', 500, 0, 0, 0, 'ready', 'text', 1, 1)
    `).run(userId, projectId)
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    mocks.sessionUserId = userId
    mocks.kvGet.mockReset()
    mocks.kvPut.mockReset()
    mocks.kvGet.mockResolvedValue(null)

    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => ({
      get: mocks.kvGet,
      put: mocks.kvPut,
      delete: vi.fn(),
    }))
    vi.stubGlobal('useUserSession', async () => {
      return mocks.sessionUserId
        ? { user: { id: String(mocks.sessionUserId) } }
        : null
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      return Object.assign(new Error('Unauthorized'), { status: 401 })
    })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('answers 401 without a session', async () => {
    mocks.sessionUserId = 0

    const handler = await importHandler()

    await expect(handler({})).rejects.toMatchObject({ status: 401 })
  })

  it('returns the breakdown next to the existing fields', async () => {
    await seedProject(testDb.db, userId)

    const project = testDb.sqlite
      .prepare('select id from projects where user_id = ?')
      .get(userId) as { id: number }

    seedData(project.id)

    const handler = await importHandler()
    const stats = await handler({})

    expect(stats).toMatchObject({
      used: 10_500,
      total: 20 * 1024 * 1024,
      percentage: 0,
      tier: 'free',
      maxStorageBytes: 20 * 1024 * 1024,
      breakdown: {
        totalBytes: 10_500,
        categories: [
          { id: 'aiImages', bytes: 1_000, count: 1 },
          { id: 'uploads', bytes: 2_000, count: 1 },
          { id: 'generatedFiles', bytes: 3_000, count: 1 },
          { id: 'artifacts', bytes: 4_000, count: 1 },
          { id: 'knowledge', bytes: 500, count: 1 },
        ],
      },
    })
    expect(stats.used).toBe(stats.breakdown.totalBytes)
    expect(mocks.kvPut).toHaveBeenCalledWith(
      `storage-stats:${userId}`,
      expect.stringContaining('"breakdown"'),
      { expirationTtl: 60 },
    )
  })

  it('serves a cached entry that has a breakdown', async () => {
    const cached = { used: 1, breakdown: { categories: [], totalBytes: 1 } }

    mocks.kvGet.mockResolvedValue(cached)

    const handler = await importHandler()

    expect(await handler({})).toBe(cached)
    expect(mocks.kvPut).not.toHaveBeenCalled()
  })

  it('treats a cached entry from before the breakdown as a miss', async () => {
    mocks.kvGet.mockResolvedValue({ used: 1, total: 2 })

    const handler = await importHandler()
    const stats = await handler({})

    expect(stats.breakdown.categories).toHaveLength(5)
    expect(mocks.kvPut).toHaveBeenCalledTimes(1)
  })

  it('reports a full percentage for an account over the allowance', async () => {
    testDb.sqlite.prepare(`
      insert into artifacts (user_id, kind, title, current_version,
        total_bytes, created_via, created_at, updated_at)
      values (?, 'html', 'Big', 1, ?, 'chat', 1, 1)
    `).run(userId, 30 * 1024 * 1024)

    const handler = await importHandler()
    const stats = await handler({})

    expect(stats.used).toBeGreaterThan(stats.total)
    expect(stats.percentage).toBe(150)
  })
})
