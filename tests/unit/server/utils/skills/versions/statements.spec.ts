import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
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
import { skillMarkdown } from '../../../../../setup/helpers/skill-archives'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const { asBatch, buildGuardedVersionStatements } = await import(
  '~~/server/utils/skills/versions/statements'
)

describe('buildGuardedVersionStatements', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let skillId: string

  function statements(overrides: {
    baseVersion?: number
    maxUserBytes?: number
    incomingBytes?: number
  } = {}) {
    return buildGuardedVersionStatements({
      db: testDb.db,
      userId,
      skillId,
      baseVersion: overrides.baseVersion ?? 1,
      maxUserBytes: overrides.maxUserBytes ?? 1_000_000,
      incomingBytes: overrides.incomingBytes ?? 10,
      record: {
        skillId,
        userId,
        version: 2,
        origin: 'editor',
        sha256: 'b'.repeat(64),
        filesCount: 1,
        bytes: 10,
        licenseClass: 'authored',
        licenseFileSha256: null,
        findings: { url: 2 },
        note: null,
      },
      files: [{
        path: 'SKILL.md',
        blobSha256: 'c'.repeat(64),
        bytes: 10,
        kind: 'skill-md',
      }],
      skillSet: { currentVersion: 2 },
    })
  }

  async function counts() {
    const versions = await testDb.db.select()
      .from(schema.skillVersions)
      .where(and(
        eq(schema.skillVersions.skillId, skillId),
        eq(schema.skillVersions.version, 2),
      ))
    const files = await testDb.db.select()
      .from(schema.skillFiles)
      .where(and(
        eq(schema.skillFiles.skillId, skillId),
        eq(schema.skillFiles.version, 2),
      ))
    const [skill] = await testDb.db.select()
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId))

    return {
      versions: versions.length,
      files: files.length,
      currentVersion: skill!.currentVersion,
    }
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db)
    skillId = (await seedSkillWithFiles(testDb.db, createFakeSkillBucket(), {
      userId,
      files: { 'SKILL.md': skillMarkdown() },
    })).skillId
  })

  afterEach(() => {
    testDb.close()
  })

  it('writes the version, its files and the skill row together', async () => {
    const results = await testDb.db.batch(asBatch(statements())) as unknown[]

    expect(results.at(-1)).toHaveLength(1)
    expect(await counts()).toEqual({ versions: 1, files: 1, currentVersion: 2 })
  })

  it('writes nothing when the skill is no longer at the base version', async () => {
    const results = await testDb.db.batch(
      asBatch(statements({ baseVersion: 7 })),
    ) as unknown[]

    expect(results.at(-1)).toEqual([])
    expect(await counts()).toEqual({ versions: 0, files: 0, currentVersion: 1 })
  })

  it('writes nothing when the new blobs would pass the user cap', async () => {
    const results = await testDb.db.batch(asBatch(statements({
      maxUserBytes: 100,
      incomingBytes: 1_000,
    }))) as unknown[]

    expect(results.at(-1)).toEqual([])
    expect(await counts()).toEqual({ versions: 0, files: 0, currentVersion: 1 })
  })

  it('skips the cap for a write that adds no blob bytes', async () => {
    const results = await testDb.db.batch(asBatch(statements({
      maxUserBytes: 1,
      incomingBytes: 0,
    }))) as unknown[]

    expect(results.at(-1)).toHaveLength(1)
    expect(await counts()).toEqual({ versions: 1, files: 1, currentVersion: 2 })
  })

  it('counts a blob once per skill however many versions hold it', async () => {
    const [existing] = await testDb.db.select()
      .from(schema.skillFiles)
      .where(eq(schema.skillFiles.skillId, skillId))

    await testDb.db.update(schema.skillFiles)
      .set({ bytes: 70 })
      .where(eq(schema.skillFiles.id, existing!.id))
    await testDb.db.insert(schema.skillFiles).values({
      skillId,
      userId,
      version: 5,
      path: 'SKILL.md',
      blobSha256: existing!.blobSha256,
      bytes: 70,
      kind: 'skill-md',
    })

    const results = await testDb.db.batch(asBatch(statements({
      maxUserBytes: 80,
      incomingBytes: 10,
    }))) as unknown[]

    expect(results.at(-1)).toHaveLength(1)
  })
})
