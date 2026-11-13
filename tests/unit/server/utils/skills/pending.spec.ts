import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { analyseSkillFiles } from '#shared/utils/skills/analyse'
import type { SkillArchiveFile } from '#shared/utils/skills/archive'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  createFakeSkillKv,
  seedSkill,
  seedSkillVersion,
  shaOf,
} from '../../../../setup/helpers/skills-db'
import type {
  FakeSkillBucket,
  FakeSkillKv,
} from '../../../../setup/helpers/skills-db'
import { skillMarkdown } from '../../../../setup/helpers/skill-archives'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const { commitSkillImport } = await import(
  '~~/server/utils/skills/import/commit'
)
const { stageSkillImport } = await import(
  '~~/server/utils/skills/import/stage'
)
const { acceptPendingSkillVersion, rejectPendingSkillVersion } = await import(
  '~~/server/utils/skills/pending'
)

const encoder = new TextEncoder()
const logger = { set: vi.fn() }

function archiveFile(path: string, text: string): SkillArchiveFile {
  return { path, bytes: encoder.encode(text), text }
}

describe('pending skill versions', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let kv: FakeSkillKv
  let userId: number
  let otherUserId: number
  let skillId: string
  let pendingSha256: string

  async function seedSkillWithPending() {
    skillId = await seedSkill(testDb.db, userId, {
      name: 'review-pr',
      description: 'Old description',
      enabled: true,
      sourceKind: 'github',
      sourceUrl: 'https://github.com/o/r',
      sourceRef: 'main',
      sourcePath: 'skills/review-pr',
      sourceVersion: 'a'.repeat(40),
      currentVersion: 1,
      filesCount: 1,
      bytes: 1,
    })
    await seedSkillVersion(testDb.db, {
      skillId,
      userId,
      version: 1,
      files: [{ path: 'SKILL.md', sha256: shaOf('old') }],
    })

    const files = [
      archiveFile('SKILL.md', skillMarkdown({
        description: 'New description from the update',
      })),
      archiveFile('references/checklist.md', '- Check tests\n'),
    ]
    const analysis = await analyseSkillFiles({ files, folderName: null })

    if (!analysis.ok) {
      throw new Error('Invalid sample')
    }

    const manifest = await stageSkillImport({
      kv,
      bucket,
      userId,
      source: 'zip',
      sourceVersion: 'sha256-cccccccccccccccc',
      fileName: 'update.zip',
      analysis,
      files,
    })

    await commitSkillImport({
      db: testDb.db,
      bucket,
      kv,
      userId,
      stageId: manifest.stageId,
      licenceAcknowledged: true,
      asUpdateOf: skillId,
      logger,
    })
    pendingSha256 = manifest.contentSha256
  }

  async function skillRow() {
    const [row] = await testDb.db.select().from(schema.skills)
      .where(eq(schema.skills.id, skillId))

    return row!
  }

  async function versionNumbers() {
    const rows = await testDb.db.select({
      version: schema.skillVersions.version,
    }).from(schema.skillVersions).orderBy(schema.skillVersions.version)

    return rows.map((row) => {
      return row.version
    })
  }

  async function rejection(promise: Promise<unknown>) {
    try {
      await promise
    } catch (exception) {
      return exception as { status: number, code?: string, fix?: string }
    }

    throw new Error('Expected a rejection')
  }

  const baseInput = () => ({
    db: testDb.db,
    bucket,
    userId,
    skillId,
    version: 2,
    sha256: pendingSha256,
    licenceAcknowledged: true,
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    kv = createFakeSkillKv()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
    await seedSkillWithPending()
  })

  afterEach(() => {
    testDb.close()
  })

  describe('acceptPendingSkillVersion', () => {
    it('creates version max+1 over the same blobs and makes it current', async () => {
      const putsBefore = bucket.put.mock.calls.length
      const result = await acceptPendingSkillVersion(baseInput())

      expect(result).toEqual({ id: skillId, version: 3, enabled: false })
      expect(bucket.put.mock.calls.length).toBe(putsBefore)
      expect(await versionNumbers()).toEqual([1, 3])

      const accepted = await testDb.db.select()
        .from(schema.skillVersions)
        .where(eq(schema.skillVersions.version, 3))

      expect(accepted[0]).toMatchObject({
        origin: 'import',
        sourceKind: 'zip',
        sourceUrl: null,
        sourceRef: null,
        sourcePath: null,
        sourceVersion: 'sha256-cccccccccccccccc',
        sha256: pendingSha256,
        filesCount: 2,
      })

      const files = await testDb.db.select()
        .from(schema.skillFiles)
        .where(and(
          eq(schema.skillFiles.skillId, skillId),
          eq(schema.skillFiles.version, 3),
        ))
      const pendingFiles = await testDb.db.select()
        .from(schema.skillFiles)
        .where(and(
          eq(schema.skillFiles.skillId, skillId),
          eq(schema.skillFiles.version, 2),
        ))

      expect(files).toHaveLength(2)
      expect(pendingFiles).toHaveLength(0)
    })

    it('updates the skill, copies the provenance, disables it and clears the pointer', async () => {
      await acceptPendingSkillVersion(baseInput())

      expect(await skillRow()).toMatchObject({
        currentVersion: 3,
        pendingVersion: null,
        enabled: false,
        status: 'ready',
        sourceKind: 'zip',
        sourceUrl: null,
        sourceRef: null,
        sourcePath: null,
        sourceVersion: 'sha256-cccccccccccccccc',
        filesCount: 2,
        description: 'New description from the update',
        licenseClass: 'none',
      })
    })

    it('numbers past a version saved in the app while the update was pending', async () => {
      await seedSkillVersion(testDb.db, {
        skillId,
        userId,
        version: 3,
        files: [{ path: 'SKILL.md', sha256: shaOf('edited') }],
      })
      await testDb.db.update(schema.skills)
        .set({ currentVersion: 3 })
        .where(eq(schema.skills.id, skillId))

      const result = await acceptPendingSkillVersion(baseInput())

      expect(result.version).toBe(4)
      expect((await skillRow()).currentVersion).toBe(4)
      expect(await versionNumbers()).toEqual([1, 3, 4])
    })

    it('prunes versions beyond the 20 kept', async () => {
      for (let version = 3; version <= 24; version += 1) {
        await seedSkillVersion(testDb.db, {
          skillId,
          userId,
          version,
          files: [{ path: 'SKILL.md', sha256: shaOf(`v${version}`) }],
        })
      }

      await acceptPendingSkillVersion(baseInput())

      const versions = await versionNumbers()

      expect(versions).toHaveLength(20)
      expect(versions.at(-1)).toBe(25)
      expect(versions).not.toContain(1)
    })

    it('answers 409 and changes nothing when the sha256 differs', async () => {
      const failure = await rejection(acceptPendingSkillVersion({
        ...baseInput(),
        sha256: 'f'.repeat(64),
      }))

      expect(failure).toMatchObject({ status: 409, code: 'pending-changed' })
      expect(await versionNumbers()).toEqual([1, 2])
      expect((await skillRow()).pendingVersion).toBe(2)
    })

    it('asks for the licence tick when the update moves to none or custom', async () => {
      const failure = await rejection(acceptPendingSkillVersion({
        ...baseInput(),
        licenceAcknowledged: undefined,
      }))

      expect(failure).toMatchObject({
        status: 400,
        code: 'licence-acknowledgement-required',
      })
      expect(failure.fix).toContain('licence box')
      expect(await versionNumbers()).toEqual([1, 2])
      expect((await skillRow()).pendingVersion).toBe(2)
      expect(await rejection(acceptPendingSkillVersion({
        ...baseInput(),
        licenceAcknowledged: false,
      }))).toMatchObject({ status: 400 })
    })

    it('does not ask when the licence class is unchanged or the update is open', async () => {
      await testDb.db.update(schema.skills)
        .set({ licenseClass: 'none' })
        .where(eq(schema.skills.id, skillId))

      await acceptPendingSkillVersion({
        ...baseInput(),
        licenceAcknowledged: undefined,
      })

      expect((await skillRow()).currentVersion).toBe(3)
    })

    it('does not ask when the pending version is open', async () => {
      await testDb.db.update(schema.skillVersions)
        .set({ licenseClass: 'open' })
        .where(eq(schema.skillVersions.version, 2))

      await acceptPendingSkillVersion({
        ...baseInput(),
        licenceAcknowledged: undefined,
      })

      expect((await skillRow()).currentVersion).toBe(3)
    })

    it('answers 409 when the version differs or nothing is pending', async () => {
      expect(await rejection(acceptPendingSkillVersion({
        ...baseInput(),
        version: 5,
      }))).toMatchObject({ status: 409 })

      await acceptPendingSkillVersion(baseInput())

      expect(await rejection(acceptPendingSkillVersion(baseInput())))
        .toMatchObject({ status: 409, code: 'pending-changed' })
    })

    it('answers 404 for another user, and for a garbage id', async () => {
      expect(await rejection(acceptPendingSkillVersion({
        ...baseInput(),
        userId: otherUserId,
      }))).toMatchObject({ status: 404 })
      expect(await rejection(acceptPendingSkillVersion({
        ...baseInput(),
        skillId: 'not-an-id!',
      }))).toMatchObject({ status: 404 })
    })

    it('answers 409 and applies nothing when a pending file is missing', async () => {
      for (const key of [...bucket.objects.keys()]) {
        if (key.startsWith('user-skills/')) {
          bucket.objects.delete(key)
        }
      }

      expect(await rejection(acceptPendingSkillVersion(baseInput())))
        .toMatchObject({ status: 409, code: 'files-missing' })
      expect(await versionNumbers()).toEqual([1, 2])
      expect((await skillRow()).currentVersion).toBe(1)
    })
  })

  describe('claiming the pending version', () => {
    it('lets only one of two simultaneous accepts win', async () => {
      const outcomes = await Promise.allSettled([
        acceptPendingSkillVersion(baseInput()),
        acceptPendingSkillVersion(baseInput()),
      ])
      const winners = outcomes.filter((outcome) => {
        return outcome.status === 'fulfilled'
      })
      const losers = outcomes.filter((outcome) => {
        return outcome.status === 'rejected'
      })

      expect(winners).toHaveLength(1)
      expect((losers[0] as PromiseRejectedResult).reason).toMatchObject({
        status: 409,
        code: 'pending-changed',
      })
      expect(await versionNumbers()).toEqual([1, 3])
    })

    it('lets only one of an accept and a reject win', async () => {
      const outcomes = await Promise.allSettled([
        acceptPendingSkillVersion(baseInput()),
        rejectPendingSkillVersion({
          db: testDb.db,
          userId,
          skillId,
          version: 2,
          sha256: pendingSha256,
        }),
      ])

      expect(outcomes.filter((outcome) => {
        return outcome.status === 'fulfilled'
      })).toHaveLength(1)

      const [skill] = await testDb.db.select().from(schema.skills)

      expect(skill!.pendingVersion).toBeNull()
    })

    it('answers 409 to a second reject', async () => {
      const input = {
        db: testDb.db,
        userId,
        skillId,
        version: 2,
        sha256: pendingSha256,
      }

      await rejectPendingSkillVersion(input)

      expect(await rejection(rejectPendingSkillVersion(input))).toMatchObject({
        status: 409,
        code: 'pending-changed',
      })
    })

    it('puts the pointer back when the accept batch fails', async () => {
      const batch = vi.spyOn(testDb.db, 'batch').mockRejectedValueOnce(
        new Error('D1 unavailable'),
      )

      await expect(acceptPendingSkillVersion(baseInput()))
        .rejects.toThrow('D1 unavailable')
      batch.mockRestore()

      expect((await skillRow()).pendingVersion).toBe(2)
      await expect(acceptPendingSkillVersion(baseInput()))
        .resolves.toMatchObject({ version: 3 })
    })
  })

  describe('rejectPendingSkillVersion', () => {
    it('deletes the pending rows and clears the pointer', async () => {
      const result = await rejectPendingSkillVersion({
        db: testDb.db,
        userId,
        skillId,
        version: 2,
        sha256: pendingSha256,
      })

      expect(result).toEqual({ id: skillId, rejected: true })
      expect(await versionNumbers()).toEqual([1])
      expect(await skillRow()).toMatchObject({
        currentVersion: 1,
        pendingVersion: null,
        enabled: true,
        description: 'Old description',
      })

      const pendingFiles = await testDb.db.select()
        .from(schema.skillFiles)
        .where(and(
          eq(schema.skillFiles.skillId, skillId),
          eq(schema.skillFiles.version, 2),
        ))

      expect(pendingFiles).toHaveLength(0)
    })

    it('leaves the blobs for the prune and the sweep', async () => {
      const objectsBefore = bucket.objects.size

      bucket.deleteCalls.length = 0

      await rejectPendingSkillVersion({
        db: testDb.db,
        userId,
        skillId,
        version: 2,
        sha256: pendingSha256,
      })

      expect(bucket.deleteCalls).toHaveLength(0)
      expect(bucket.objects.size).toBe(objectsBefore)
    })

    it('answers 409 when the pending row changed', async () => {
      expect(await rejection(rejectPendingSkillVersion({
        db: testDb.db,
        userId,
        skillId,
        version: 2,
        sha256: 'e'.repeat(64),
      }))).toMatchObject({ status: 409, code: 'pending-changed' })
      expect(await versionNumbers()).toEqual([1, 2])
    })

    it('answers 404 for another user', async () => {
      expect(await rejection(rejectPendingSkillVersion({
        db: testDb.db,
        userId: otherUserId,
        skillId,
        version: 2,
        sha256: pendingSha256,
      }))).toMatchObject({ status: 404 })
    })
  })
})
