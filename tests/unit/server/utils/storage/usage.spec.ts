import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedProject,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import { seedSkill } from '../../../../setup/helpers/skills-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'

const { getUserStorageUsageBytes } = await import(
  '~~/server/utils/files/file-governance'
)
const { getUserStorageBreakdown, userStorageUsedBytesSql } = await import(
  '~~/server/utils/storage/usage'
)

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

describe('storage usage', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let otherUserId: number
  let fileSequence: number

  function insertFile(
    owner: number,
    size: number,
    source: 'upload' | 'assistant',
    type: string,
  ): void {
    fileSequence += 1
    testDb.sqlite.prepare(`
      insert into files (user_id, storage_key, name, size, type, source,
        created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, 1, 1)
    `).run(owner, `key-${fileSequence}`, `file-${fileSequence}`, size, type, source)
  }

  function insertArtifact(
    owner: number,
    totalBytes: number,
    currentVersion = 1,
  ): void {
    testDb.sqlite.prepare(`
      insert into artifacts (user_id, kind, title, current_version,
        total_bytes, created_via, created_at, updated_at)
      values (?, 'html', 'Artifact', ?, ?, 'chat', 1, 1)
    `).run(owner, currentVersion, totalBytes)
  }

  async function seedProjectId(owner: number): Promise<number> {
    await seedProject(testDb.db, owner)

    const row = testDb.sqlite
      .prepare('select id from projects where user_id = ?')
      .get(owner) as { id: number }

    return row.id
  }

  function insertKnowledge(
    owner: number,
    projectId: number,
    textBytes: number,
  ): void {
    fileSequence += 1
    testDb.sqlite.prepare(`
      insert into project_knowledge_items (user_id, project_id, kind, title,
        content_hash, text_bytes, latin_chars, cyrillic_chars, other_chars,
        extract_status, extractor, created_at, updated_at)
      values (?, ?, 'note', 'Note', ?, ?, 0, 0, 0, 'ready', 'text', 1, 1)
    `).run(owner, projectId, `hash-${fileSequence}`, textBytes)
  }

  async function insertSkill(owner: number, name: string): Promise<string> {
    return await seedSkill(testDb.db, owner, { name })
  }

  async function insertSkillBlob(
    owner: number,
    skillId: string,
    version: number,
    path: string,
    blobSha256: string,
    bytes: number,
  ): Promise<void> {
    await testDb.db.insert(schema.skillFiles).values({
      skillId,
      userId: owner,
      version,
      path,
      blobSha256,
      bytes,
      kind: 'other',
    })
  }

  function categoryOf(
    breakdown: Awaited<ReturnType<typeof getUserStorageBreakdown>>,
    id: string,
  ) {
    return breakdown.categories.find(category => category.id === id)
  }

  beforeEach(async () => {
    fileSequence = 0
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
    vi.stubGlobal('useDb', () => testDb.db)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  it('reports every category with zero bytes for an empty account', async () => {
    const breakdown = await getUserStorageBreakdown(userId)

    expect(breakdown.totalBytes).toBe(0)
    expect(breakdown.categories).toEqual([
      { id: 'aiImages', bytes: 0, count: 0 },
      { id: 'uploads', bytes: 0, count: 0 },
      { id: 'generatedFiles', bytes: 0, count: 0 },
      { id: 'artifacts', bytes: 0, count: 0 },
      { id: 'knowledge', bytes: 0, count: 0 },
      { id: 'skills', bytes: 0, count: 0 },
    ])
  })

  it('splits files by source and media type', async () => {
    insertFile(userId, 100, 'assistant', 'image/webp')
    insertFile(userId, 200, 'assistant', 'image/png')
    insertFile(userId, 300, 'upload', 'image/png')
    insertFile(userId, 400, 'upload', 'application/pdf')
    insertFile(userId, 500, 'assistant', 'application/pdf')
    insertFile(userId, 600, 'assistant', 'text/csv')

    const breakdown = await getUserStorageBreakdown(userId)

    expect(categoryOf(breakdown, 'aiImages')).toMatchObject({
      bytes: 300,
      count: 2,
    })
    expect(categoryOf(breakdown, 'uploads')).toMatchObject({
      bytes: 700,
      count: 2,
    })
    expect(categoryOf(breakdown, 'generatedFiles')).toMatchObject({
      bytes: 1_100,
      count: 2,
    })
  })

  it('counts artifact bytes and skips pending artifact headers', async () => {
    insertArtifact(userId, 4_000)
    insertArtifact(userId, 1_000)
    insertArtifact(userId, 0, 0)

    expect(categoryOf(await getUserStorageBreakdown(userId), 'artifacts'))
      .toMatchObject({ bytes: 5_000, count: 2 })
  })

  it('counts knowledge text bytes', async () => {
    const projectId = await seedProjectId(userId)

    insertKnowledge(userId, projectId, 700)
    insertKnowledge(userId, projectId, 300)

    expect(categoryOf(await getUserStorageBreakdown(userId), 'knowledge'))
      .toMatchObject({ bytes: 1_000, count: 2 })
  })

  it('counts each unique blob of a skill once, however many versions hold it', async () => {
    const skillId = await insertSkill(userId, 'review-pr')

    await insertSkillBlob(userId, skillId, 1, 'SKILL.md', 'a'.repeat(64), 400)
    await insertSkillBlob(userId, skillId, 2, 'SKILL.md', 'a'.repeat(64), 400)
    await insertSkillBlob(userId, skillId, 2, 'notes.md', 'b'.repeat(64), 100)
    await insertSkillBlob(userId, skillId, 3, 'SKILL.md', 'c'.repeat(64), 450)
    await insertSkillBlob(userId, skillId, 3, 'notes.md', 'b'.repeat(64), 100)

    expect(categoryOf(await getUserStorageBreakdown(userId), 'skills'))
      .toMatchObject({ bytes: 950, count: 1 })
  })

  it('counts the same blob once per skill', async () => {
    const first = await insertSkill(userId, 'first-skill')
    const second = await insertSkill(userId, 'second-skill')

    await insertSkillBlob(userId, first, 1, 'SKILL.md', 'a'.repeat(64), 300)
    await insertSkillBlob(userId, second, 1, 'SKILL.md', 'a'.repeat(64), 300)

    expect(categoryOf(await getUserStorageBreakdown(userId), 'skills'))
      .toMatchObject({ bytes: 600, count: 2 })
  })

  it('counts a skill that has no files yet', async () => {
    await insertSkill(userId, 'empty-skill')

    expect(categoryOf(await getUserStorageBreakdown(userId), 'skills'))
      .toMatchObject({ bytes: 0, count: 1 })
  })

  it('never counts rows of other users', async () => {
    const otherProjectId = await seedProjectId(otherUserId)
    const otherSkillId = await insertSkill(otherUserId, 'other-skill')

    await insertSkillBlob(
      otherUserId,
      otherSkillId,
      1,
      'SKILL.md',
      'd'.repeat(64),
      9_000,
    )

    insertFile(otherUserId, 9_000, 'upload', 'text/plain')
    insertArtifact(otherUserId, 9_000)
    insertKnowledge(otherUserId, otherProjectId, 9_000)
    insertFile(userId, 10, 'upload', 'text/plain')

    expect((await getUserStorageBreakdown(userId)).totalBytes).toBe(10)
    expect(await getUserStorageUsageBytes(userId)).toBe(10)
  })

  it('makes the one usage number equal the sum of the categories', async () => {
    const projectId = await seedProjectId(userId)

    insertFile(userId, 111, 'assistant', 'image/webp')
    insertFile(userId, 222, 'upload', 'application/pdf')
    insertFile(userId, 333, 'assistant', 'application/pdf')
    insertArtifact(userId, 444)
    insertKnowledge(userId, projectId, 555)
    await insertSkillBlob(
      userId,
      await insertSkill(userId, 'summed-skill'),
      1,
      'SKILL.md',
      'e'.repeat(64),
      666,
    )

    const breakdown = await getUserStorageBreakdown(userId)
    const categorySum = breakdown.categories.reduce((total, category) => {
      return total + category.bytes
    }, 0)

    expect(breakdown.totalBytes).toBe(2_331)
    expect(categorySum).toBe(2_331)
    expect(await getUserStorageUsageBytes(userId)).toBe(2_331)
  })

  it('evaluates the usage expression inside a larger statement', async () => {
    insertFile(userId, 70, 'upload', 'text/plain')
    insertArtifact(userId, 30)

    const [row] = testDb.db.all<{ fits: number }>(
      sql`select (${userStorageUsedBytesSql(userId)} + 1 <= 101) as fits`,
    ) as unknown as Array<{ fits: number }>

    expect(row?.fits).toBe(1)
  })

  describe('registering a category', () => {
    afterEach(() => {
      vi.doUnmock('~~/server/utils/storage/categories')
      vi.resetModules()
    })

    it('adds one entry to the total and the breakdown', async () => {
      vi.resetModules()
      vi.doMock('~~/server/utils/storage/categories', async (importOriginal) => {
        const original = await importOriginal<
          typeof import('~~/server/utils/storage/categories')
        >()

        return {
          ...original,
          STORAGE_CATEGORIES: [
            ...original.STORAGE_CATEGORIES,
            {
              id: 'future',
              bytesSql: () => sql<number>`(select 7)`,
              countSql: () => sql<number>`(select 1)`,
            },
          ],
        }
      })

      insertFile(userId, 100, 'upload', 'text/plain')

      const governance = await import('~~/server/utils/files/file-governance')
      const usage = await import('~~/server/utils/storage/usage')
      const breakdown = await usage.getUserStorageBreakdown(userId)

      expect(breakdown.categories.at(-1)).toEqual({
        id: 'future',
        bytes: 7,
        count: 1,
      })
      expect(breakdown.totalBytes).toBe(107)
      expect(await governance.getUserStorageUsageBytes(userId)).toBe(107)
    })
  })
})
