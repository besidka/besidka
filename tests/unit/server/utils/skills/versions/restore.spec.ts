import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, asc, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  seedSkillWithFiles,
} from '../../../../../setup/helpers/skills-db'
import type { FakeSkillBucket } from '../../../../../setup/helpers/skills-db'
import { skillMarkdown } from '../../../../../setup/helpers/skill-archives'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const { saveSkillChanges } = await import(
  '~~/server/utils/skills/versions/save'
)
const { restoreSkillVersion } = await import(
  '~~/server/utils/skills/versions/restore'
)

const logger = { set: vi.fn() }

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string }
  }

  throw new Error('Expected a rejection')
}

describe('restoreSkillVersion', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number
  let skillId: string

  function restore(
    version: number,
    overrides: { baseVersion?: number, note?: string | null } = {},
  ) {
    return restoreSkillVersion({
      db: testDb.db,
      bucket,
      userId,
      skillId,
      version,
      baseVersion: overrides.baseVersion,
      note: overrides.note ?? null,
      logger,
    })
  }

  function save(
    baseVersion: number,
    changes: Parameters<typeof saveSkillChanges>[0]['changes'],
  ) {
    return saveSkillChanges({
      db: testDb.db,
      bucket,
      userId,
      skillId,
      baseVersion,
      changes,
      note: null,
      logger,
    })
  }

  async function skillRow() {
    const [row] = await testDb.db.select()
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId))

    return row!
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db)
    skillId = (await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: {
        'SKILL.md': skillMarkdown({ description: 'Version one' }),
        'references/notes.md': 'Original\n',
      },
      skill: { name: 'review-pr', enabled: true },
    })).skillId

    await save(1, [
      { op: 'put', path: 'references/notes.md', content: 'Edited\n' },
      { op: 'put', path: 'references/added.md', content: 'Added\n' },
    ])
  })

  afterEach(() => {
    testDb.close()
  })

  it('writes the old files as a new version over the same blobs', async () => {
    const putsBefore = bucket.putCalls.length
    const result = await restore(1)

    expect(result).toMatchObject({
      unchanged: false,
      version: 3,
      restoredFrom: 1,
    })
    expect(bucket.putCalls).toHaveLength(putsBefore)

    const files = await testDb.db.select()
      .from(schema.skillFiles)
      .where(and(
        eq(schema.skillFiles.skillId, skillId),
        eq(schema.skillFiles.version, 3),
      ))
      .orderBy(asc(schema.skillFiles.path))
    const original = await testDb.db.select()
      .from(schema.skillFiles)
      .where(and(
        eq(schema.skillFiles.skillId, skillId),
        eq(schema.skillFiles.version, 1),
      ))
      .orderBy(asc(schema.skillFiles.path))

    expect(files.map((file) => {
      return [file.path, file.blobSha256]
    })).toEqual(original.map((file) => {
      return [file.path, file.blobSha256]
    }))

    const [version] = await testDb.db.select()
      .from(schema.skillVersions)
      .where(and(
        eq(schema.skillVersions.skillId, skillId),
        eq(schema.skillVersions.version, 3),
      ))
    const row = await skillRow()

    expect(version).toMatchObject({
      origin: 'restore',
      note: 'Restored version 1',
    })
    expect(row).toMatchObject({
      currentVersion: 3,
      description: 'Version one',
      enabled: true,
    })
  })

  it('refuses the pending version', async () => {
    await testDb.db.insert(schema.skillVersions).values({
      skillId,
      userId,
      version: 3,
      origin: 'update',
      sha256: 'e'.repeat(64),
      filesCount: 1,
      bytes: 1,
      licenseClass: 'open',
    })
    await testDb.db.update(schema.skills)
      .set({ pendingVersion: 3 })
      .where(eq(schema.skills.id, skillId))

    expect(await failureOf(restore(3))).toMatchObject({
      status: 409,
      code: 'pending-version',
    })
    expect((await skillRow()).currentVersion).toBe(2)
  })

  it('refuses the current version, an unknown version and a stale base', async () => {
    expect(await failureOf(restore(2))).toMatchObject({
      status: 409,
      code: 'version-is-current',
    })
    expect(await failureOf(restore(9))).toMatchObject({
      status: 404,
      code: 'version-not-found',
    })
    expect(await failureOf(restore(1, { baseVersion: 1 }))).toMatchObject({
      status: 409,
      code: 'stale-base',
    })
  })

  it('brings an old name back through the rename rules', async () => {
    await save(2, [{
      op: 'put',
      path: 'SKILL.md',
      content: skillMarkdown({ name: 'renamed-skill' }),
    }])

    const result = await restore(1)

    expect(result).toMatchObject({ version: 4, renamed: true })
    expect((await skillRow()).name).toBe('review-pr')
  })

  it('refuses to bring back a name another skill took', async () => {
    await save(2, [{
      op: 'put',
      path: 'SKILL.md',
      content: skillMarkdown({ name: 'renamed-skill' }),
    }])
    await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: { 'SKILL.md': skillMarkdown() },
      skill: { name: 'review-pr' },
    })

    expect(await failureOf(restore(1))).toMatchObject({
      status: 409,
      code: 'name-taken',
    })
  })

  it('refuses to bring back a reserved name while used as a command', async () => {
    const reserved = await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: { 'SKILL.md': skillMarkdown({ name: 'memory' }) },
      skill: { name: 'memory' },
    })

    await saveSkillChanges({
      db: testDb.db,
      bucket,
      userId,
      skillId: reserved.skillId,
      baseVersion: 1,
      changes: [{
        op: 'put',
        path: 'SKILL.md',
        content: skillMarkdown({ name: 'my-memory' }),
      }],
      note: null,
      logger,
    })
    await testDb.db.update(schema.skills)
      .set({ slashCommand: true })
      .where(eq(schema.skills.id, reserved.skillId))

    expect(await failureOf(restoreSkillVersion({
      db: testDb.db,
      bucket,
      userId,
      skillId: reserved.skillId,
      version: 1,
      note: null,
      logger,
    }))).toMatchObject({ status: 400, code: 'reserved-name' })
  })

  it('writes nothing when the restored files equal the current ones', async () => {
    await restore(1)

    expect(await restore(1)).toEqual({
      unchanged: true,
      id: skillId,
      version: 3,
      restoredFrom: 1,
    })
  })
})
