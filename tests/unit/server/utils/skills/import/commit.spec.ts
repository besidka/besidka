import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { analyseSkillFiles } from '#shared/utils/skills/analyse'
import type { SkillArchiveFile } from '#shared/utils/skills/archive'
import { SKILLS_MAX_USER_BYTES } from '#shared/utils/skills-policy'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  createFakeSkillKv,
  seedSkill,
  seedSkillVersion,
  shaOf,
} from '../../../../../setup/helpers/skills-db'
import type {
  FakeSkillBucket,
  FakeSkillKv,
} from '../../../../../setup/helpers/skills-db'
import { skillMarkdown } from '../../../../../setup/helpers/skill-archives'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const { commitSkillImport, discardUnfinishedSkill } = await import(
  '~~/server/utils/skills/import/commit'
)
const { stageSkillImport, skillStageKey } = await import(
  '~~/server/utils/skills/import/stage'
)

const encoder = new TextEncoder()
const logger = { set: vi.fn() }

function archiveFile(path: string, text: string): SkillArchiveFile {
  return { path, bytes: encoder.encode(text), text }
}

function licenceFixture(name: string): string {
  return readFileSync(
    join(process.cwd(), 'tests/fixtures/skills/licences', name),
    'utf8',
  )
}

describe('commitSkillImport', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let kv: FakeSkillKv
  let userId: number
  let otherUserId: number

  async function stage(
    files: SkillArchiveFile[],
    options: {
      owner?: number
      source?: 'zip' | 'text'
      sourceVersion?: string
    } = {},
  ) {
    const analysis = await analyseSkillFiles({ files, folderName: null })

    if (!analysis.ok) {
      throw new Error(`Sample is invalid: ${analysis.code}`)
    }

    return await stageSkillImport({
      kv,
      bucket,
      userId: options.owner ?? userId,
      source: options.source ?? 'zip',
      sourceVersion: options.sourceVersion ?? 'sha256-aaaaaaaaaaaaaaaa',
      fileName: 'review.zip',
      analysis,
      files,
    })
  }

  function commit(
    stageId: string,
    extra: Partial<Parameters<typeof commitSkillImport>[0]> = {},
  ) {
    return commitSkillImport({
      db: testDb.db,
      bucket,
      kv,
      userId,
      stageId,
      licenceAcknowledged: true,
      logger,
      ...extra,
    })
  }

  const openSkillFiles = () => [
    archiveFile('SKILL.md', skillMarkdown()),
    archiveFile('references/checklist.md', '- Check tests\n'),
    archiveFile('LICENSE', licenceFixture('mit.txt')),
  ]

  async function allSkills() {
    return await testDb.db.select().from(schema.skills)
  }

  async function rejection(promise: Promise<unknown>) {
    try {
      await promise
    } catch (exception) {
      return exception as {
        status: number
        code?: string
        data?: Record<string, unknown>
      }
    }

    throw new Error('Expected a rejection')
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    kv = createFakeSkillKv()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
  })

  describe('a new skill', () => {
    it('creates a disabled, ready skill with version 1 and origin import', async () => {
      const manifest = await stage(openSkillFiles())
      const result = await commit(manifest.stageId)

      expect(result).toMatchObject({
        kind: 'created',
        name: 'review-pr',
        version: 1,
        enabled: false,
        status: 'ready',
        licenceClass: 'open',
        filesCount: 3,
      })

      const [skill] = await allSkills()

      expect(skill).toMatchObject({
        userId,
        name: 'review-pr',
        enabled: false,
        status: 'ready',
        currentVersion: 1,
        pendingVersion: null,
        sourceKind: 'zip',
        sourceVersion: 'sha256-aaaaaaaaaaaaaaaa',
        licenseClass: 'open',
        createdVia: 'app',
        allowScripts: false,
        modelInvocable: true,
        slashCommand: false,
      })

      const [version] = await testDb.db.select().from(schema.skillVersions)

      expect(version).toMatchObject({
        skillId: skill!.id,
        version: 1,
        origin: 'import',
        sourceKind: 'zip',
        sourceVersion: 'sha256-aaaaaaaaaaaaaaaa',
        sha256: manifest.contentSha256,
        filesCount: 3,
        licenseClass: 'open',
      })

      const files = await testDb.db.select().from(schema.skillFiles)

      expect(files.map((file) => {
        return file.path
      }).sort()).toEqual(['LICENSE', 'SKILL.md', 'references/checklist.md'])
    })

    it('writes blobs under the skill prefix, one sequential put each, and drops the stage', async () => {
      const manifest = await stage(openSkillFiles())

      bucket.putCalls.length = 0
      await commit(manifest.stageId)

      const [skill] = await allSkills()

      expect(bucket.putCalls).toHaveLength(3)
      expect(bucket.putCalls.every((key) => {
        return key.startsWith(`user-skills/u${userId}/${skill!.id}/blobs/`)
      })).toBe(true)
      expect(kv.values.has(skillStageKey(manifest.stageId))).toBe(false)
      expect([...bucket.objects.keys()].some((key) => {
        return key.startsWith('skills-staging/')
      })).toBe(false)
    })

    it('uses the Claude Code frontmatter keys as defaults for the columns', async () => {
      const manifest = await stage([
        archiveFile('SKILL.md', skillMarkdown({
          extra: 'disable-model-invocation: true\nargument-hint: "[issue]"',
        })),
      ])

      await commit(manifest.stageId)

      const [skill] = await allSkills()

      expect(skill).toMatchObject({
        modelInvocable: false,
        slashCommand: true,
        argumentHint: '[issue]',
        enabled: false,
      })
    })

    it('records the source of a pasted skill', async () => {
      const manifest = await stage(
        [archiveFile('SKILL.md', skillMarkdown())],
        { source: 'text', sourceVersion: 'sha256-bbbbbbbbbbbbbbbb' },
      )

      await commit(manifest.stageId)

      const [skill] = await allSkills()

      expect(skill).toMatchObject({
        sourceKind: 'text',
        sourceVersion: 'sha256-bbbbbbbbbbbbbbbb',
        licenseClass: 'none',
      })
    })
  })

  describe('licence tick and stage checks', () => {
    it.each(['none', 'custom'] as const)(
      'requires licenceAcknowledged for class %s',
      async (licenceClass) => {
        const files = licenceClass === 'none'
          ? [archiveFile('SKILL.md', skillMarkdown())]
          : [
            archiveFile('SKILL.md', skillMarkdown()),
            archiveFile('LICENSE', 'Use it for good.'),
          ]
        const manifest = await stage(files)
        const failure = await rejection(commit(manifest.stageId, {
          licenceAcknowledged: undefined,
        }))

        expect(failure).toMatchObject({
          status: 400,
          code: 'licence-acknowledgement-required',
        })
        expect(await allSkills()).toHaveLength(0)

        await expect(commit(manifest.stageId)).resolves.toMatchObject({
          kind: 'created',
          licenceClass,
        })
      },
    )

    it('needs no licence tick for an open licence', async () => {
      const manifest = await stage(openSkillFiles())

      await expect(commit(manifest.stageId, {
        licenceAcknowledged: undefined,
      })).resolves.toMatchObject({ kind: 'created' })
    })

    it('answers 404 for a missing, foreign or expired stage', async () => {
      const manifest = await stage(openSkillFiles())

      expect(await rejection(commit('f'.repeat(32)))).toMatchObject({
        status: 404,
        code: 'stage-not-found',
      })
      expect(await rejection(commit(manifest.stageId, {
        userId: otherUserId,
      }))).toMatchObject({ status: 404 })
      expect(await rejection(commit(manifest.stageId, {
        now: manifest.expiresAt + 1,
      }))).toMatchObject({ status: 404 })
      expect(await allSkills()).toHaveLength(0)
    })

    it('re-checks a restricted class at commit', async () => {
      const manifest = await stage(openSkillFiles())
      const key = skillStageKey(manifest.stageId)
      const tampered = JSON.parse(kv.values.get(key)!)

      tampered.licence.class = 'restricted'
      kv.values.set(key, JSON.stringify(tampered))

      expect(await rejection(commit(manifest.stageId))).toMatchObject({
        status: 422,
        code: 'licence-restricted',
      })
    })

    it('rejects an invalid rename', async () => {
      const manifest = await stage(openSkillFiles())

      expect(await rejection(commit(manifest.stageId, {
        name: 'Bad_Name',
      }))).toMatchObject({ status: 400, code: 'name-invalid' })
    })
  })

  describe('name collision', () => {
    async function seedExisting() {
      const skillId = await seedSkill(testDb.db, userId, {
        name: 'review-pr',
        sourceKind: 'github',
        sourceUrl: 'https://github.com/o/r',
        sourceVersion: 'a'.repeat(40),
        currentVersion: 1,
      })

      await seedSkillVersion(testDb.db, {
        skillId,
        userId,
        version: 1,
        files: [{ path: 'SKILL.md', sha256: shaOf('existing') }],
      })

      return skillId
    }

    it('answers 409 with stageId and asUpdateOf and keeps the stage', async () => {
      const existingId = await seedExisting()
      const manifest = await stage(openSkillFiles())

      bucket.putCalls.length = 0

      const failure = await rejection(commit(manifest.stageId))

      expect(failure).toMatchObject({
        status: 409,
        code: 'name-taken',
        data: {
          stageId: manifest.stageId,
          asUpdateOf: existingId,
          name: 'review-pr',
        },
      })
      expect(bucket.putCalls).toHaveLength(0)
      expect(kv.values.has(skillStageKey(manifest.stageId))).toBe(true)
      expect(await allSkills()).toHaveLength(1)
    })

    it('resolves by renaming the incoming skill', async () => {
      await seedExisting()

      const manifest = await stage(openSkillFiles())

      await rejection(commit(manifest.stageId))

      const result = await commit(manifest.stageId, { name: 'review-pr-2' })

      expect(result).toMatchObject({ kind: 'created', name: 'review-pr-2' })
      expect((await allSkills()).map((skill) => {
        return skill.name
      }).sort()).toEqual(['review-pr', 'review-pr-2'])
    })

    it('does not collide with the same name of another user', async () => {
      await seedSkill(testDb.db, otherUserId, { name: 'review-pr' })

      const manifest = await stage(openSkillFiles())

      await expect(commit(manifest.stageId)).resolves.toMatchObject({
        kind: 'created',
      })
    })

    it('resolves as an update: a persisted pending version, nothing else changes', async () => {
      const existingId = await seedExisting()
      const manifest = await stage(openSkillFiles())
      const before = (await allSkills())[0]!

      bucket.putCalls.length = 0

      const result = await commit(manifest.stageId, { asUpdateOf: existingId })

      expect(result).toMatchObject({
        kind: 'pending',
        id: existingId,
        version: 2,
        pendingVersion: 2,
        sha256: manifest.contentSha256,
      })

      const [skill] = await allSkills()

      expect(skill).toMatchObject({
        currentVersion: 1,
        pendingVersion: 2,
        enabled: before.enabled,
        status: before.status,
        sourceKind: 'github',
        sourceUrl: 'https://github.com/o/r',
        sourceVersion: 'a'.repeat(40),
      })

      const [, pending] = await testDb.db.select()
        .from(schema.skillVersions)
        .orderBy(schema.skillVersions.version)

      expect(pending).toMatchObject({
        skillId: existingId,
        version: 2,
        origin: 'import',
        sourceKind: 'zip',
        sourceUrl: null,
        sourceRef: null,
        sourcePath: null,
        sourceVersion: 'sha256-aaaaaaaaaaaaaaaa',
        sha256: manifest.contentSha256,
      })

      const pendingFiles = await testDb.db.select()
        .from(schema.skillFiles)
        .where(and(
          eq(schema.skillFiles.skillId, existingId),
          eq(schema.skillFiles.version, 2),
        ))

      expect(pendingFiles).toHaveLength(3)
      expect(bucket.putCalls.every((key) => {
        return key.startsWith(`user-skills/u${userId}/${existingId}/blobs/`)
      })).toBe(true)
      expect(kv.values.has(skillStageKey(manifest.stageId))).toBe(false)
    })

    it('replaces an older pending version', async () => {
      const existingId = await seedExisting()
      const first = await stage(openSkillFiles())
      const second = await stage([
        archiveFile('SKILL.md', skillMarkdown({ body: 'Different body\n' })),
      ])

      await commit(first.stageId, { asUpdateOf: existingId })

      const result = await commit(second.stageId, { asUpdateOf: existingId })

      expect(result).toMatchObject({ kind: 'pending', version: 3 })

      const versions = await testDb.db.select({
        version: schema.skillVersions.version,
      }).from(schema.skillVersions).orderBy(schema.skillVersions.version)
      const [skill] = await allSkills()

      expect(versions.map((row) => {
        return row.version
      })).toEqual([1, 3])
      expect(skill!.pendingVersion).toBe(3)

      const oldPendingFiles = await testDb.db.select()
        .from(schema.skillFiles)
        .where(and(
          eq(schema.skillFiles.skillId, existingId),
          eq(schema.skillFiles.version, 2),
        ))

      expect(oldPendingFiles).toHaveLength(0)
    })

    it('refuses to replace a skill with a different name', async () => {
      const otherNameId = await seedSkill(testDb.db, userId, {
        name: 'another-skill',
      })
      const manifest = await stage(openSkillFiles())

      expect(await rejection(commit(manifest.stageId, {
        asUpdateOf: otherNameId,
      }))).toMatchObject({ status: 400, code: 'invalid-request' })
    })

    it('refuses asUpdateOf together with a new name', async () => {
      const existingId = await seedExisting()
      const manifest = await stage(openSkillFiles())

      expect(await rejection(commit(manifest.stageId, {
        asUpdateOf: existingId,
        name: 'review-pr-2',
      }))).toMatchObject({ status: 400, code: 'invalid-request' })
    })

    it('answers 404 for a skill of another user and for a garbage id', async () => {
      const foreignId = await seedSkill(testDb.db, otherUserId, {
        name: 'review-pr',
      })
      const manifest = await stage(openSkillFiles())

      expect(await rejection(commit(manifest.stageId, {
        asUpdateOf: foreignId,
      }))).toMatchObject({ status: 404, code: 'skill-not-found' })
      expect(await rejection(commit(manifest.stageId, {
        asUpdateOf: 'zzzz',
      }))).toMatchObject({ status: 404 })
    })
  })

  describe('rename at commit', () => {
    async function storedSkillMd(skillId: string, version: number) {
      const [row] = await testDb.db.select()
        .from(schema.skillFiles)
        .where(and(
          eq(schema.skillFiles.skillId, skillId),
          eq(schema.skillFiles.version, version),
          eq(schema.skillFiles.path, 'SKILL.md'),
        ))
      const object = bucket.objects.get(
        `user-skills/u${userId}/${skillId}/blobs/${row!.blobSha256}`,
      )

      return {
        row: row!,
        text: new TextDecoder().decode(object!.bytes),
      }
    }

    it('rewrites only the name line of the stored SKILL.md', async () => {
      const manifest = await stage(openSkillFiles())
      const result = await commit(manifest.stageId, { name: 'review-pr-2' })

      if (result.kind !== 'created') {
        throw new Error('Expected a created skill')
      }

      const { row, text } = await storedSkillMd(result.id, 1)

      expect(text).toBe(skillMarkdown().replace(
        'name: review-pr',
        'name: review-pr-2',
      ))
      expect(row.bytes).toBe(new TextEncoder().encode(text).byteLength)

      const [version] = await testDb.db.select().from(schema.skillVersions)
      const [skill] = await allSkills()

      expect(version!.sha256).not.toBe(manifest.contentSha256)
      expect(skill!.name).toBe('review-pr-2')
      expect(skill!.bytes).toBe(version!.bytes)
    })

    it('leaves the staged original untouched for another retry', async () => {
      const manifest = await stage(openSkillFiles())

      await commit(manifest.stageId, { name: 'review-pr-2' })

      expect(kv.values.has(skillStageKey(manifest.stageId))).toBe(false)
    })

    it('stores SKILL.md unchanged when the name is not renamed', async () => {
      const manifest = await stage(openSkillFiles())
      const result = await commit(manifest.stageId)

      if (result.kind !== 'created') {
        throw new Error('Expected a created skill')
      }

      const { row, text } = await storedSkillMd(result.id, 1)

      expect(text).toBe(skillMarkdown())
      expect(row.blobSha256).toBe(manifest.files.find((file) => {
        return file.path === 'SKILL.md'
      })!.sha256)
    })
  })

  describe('an abandoned placeholder', () => {
    async function seedPlaceholder() {
      return await seedSkill(testDb.db, userId, {
        name: 'review-pr',
        status: 'broken',
      })
    }

    it('is taken over after the grace period', async () => {
      await seedPlaceholder()

      const manifest = await stage(openSkillFiles())
      const result = await commit(manifest.stageId, {
        now: Date.now() + 30 * 60 * 1000,
      })
      const skills = await allSkills()

      expect(result).toMatchObject({ kind: 'created', name: 'review-pr' })
      expect(skills).toHaveLength(1)
      expect(skills[0]).toMatchObject({ status: 'ready', enabled: false })
    })

    it('still blocks the name inside the grace period', async () => {
      await seedPlaceholder()

      const manifest = await stage(openSkillFiles())

      expect(await rejection(commit(manifest.stageId)))
        .toMatchObject({ status: 409, code: 'name-taken' })
    })

    it('never takes over a broken skill that has versions', async () => {
      const brokenId = await seedSkill(testDb.db, userId, {
        name: 'review-pr',
        status: 'broken',
      })

      await seedSkillVersion(testDb.db, {
        skillId: brokenId,
        userId,
        version: 1,
        files: [{ path: 'SKILL.md', sha256: shaOf('real') }],
      })

      const manifest = await stage(openSkillFiles())

      expect(await rejection(commit(manifest.stageId, {
        now: Date.now() + 30 * 60 * 1000,
      }))).toMatchObject({ status: 409 })
    })
  })

  describe('atomic limits', () => {
    it('lets only one of two racing commits take the last skill slot', async () => {
      for (let index = 0; index < 49; index += 1) {
        await seedSkill(testDb.db, userId, { name: `skill-${index}` })
      }

      const first = await stage(openSkillFiles())
      const second = await stage([
        archiveFile('SKILL.md', skillMarkdown({ name: 'second-skill' })),
      ])
      const outcomes = await Promise.allSettled([
        commit(first.stageId),
        commit(second.stageId),
      ])
      const created = outcomes.filter((outcome) => {
        return outcome.status === 'fulfilled'
      })
      const refused = outcomes.filter((outcome) => {
        return outcome.status === 'rejected'
      })

      expect(created).toHaveLength(1)
      expect(refused).toHaveLength(1)
      expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({
        status: 403,
        code: 'skills-limit',
      })
      expect(await allSkills()).toHaveLength(50)
    })

    it('refuses the insert itself when the skills table would pass 50 MiB', async () => {
      await seedSkill(testDb.db, userId, {
        name: 'heavy',
        bytes: SKILLS_MAX_USER_BYTES - 10,
      })

      const manifest = await stage(openSkillFiles())

      expect(await rejection(commit(manifest.stageId))).toMatchObject({
        status: 413,
        code: 'skills-storage-limit',
      })
      expect(await allSkills()).toHaveLength(1)
      expect(kv.values.has(skillStageKey(manifest.stageId))).toBe(true)
    })

    it('inserts the full row, including the columns Drizzle would default', async () => {
      const manifest = await stage(openSkillFiles())

      await commit(manifest.stageId)

      const [skill] = await allSkills()

      expect(skill).toMatchObject({
        createdByClientId: null,
        providerSkillId: null,
        allowScripts: false,
        pendingVersion: null,
        licenseClassifierVersion: 1,
      })
      expect(skill!.createdAt).toBeInstanceOf(Date)
      expect(skill!.updatedAt).toBeInstanceOf(Date)
      expect(skill!.metadata).toBeNull()
    })

    it('stores json columns and booleans through the same encoding', async () => {
      const manifest = await stage([
        archiveFile('SKILL.md', skillMarkdown({
          extra: 'metadata:\n  owner: me\nallowed-tools: Read Write',
        })),
      ])

      await commit(manifest.stageId)

      const [skill] = await allSkills()

      expect(skill).toMatchObject({
        metadata: { owner: 'me' },
        allowedTools: ['Read', 'Write'],
        modelInvocable: true,
        enabled: false,
      })
    })
  })

  describe('claiming the stage', () => {
    it('deletes the manifest before any blob is written', async () => {
      const manifest = await stage(openSkillFiles())

      bucket.put.mockClear()
      kv.delete.mockClear()
      await commit(manifest.stageId)

      expect(kv.delete.mock.invocationCallOrder[0]).toBeLessThan(
        bucket.put.mock.invocationCallOrder[0]!,
      )
    })

    it('puts the manifest back with its remaining lifetime when the commit fails', async () => {
      const manifest = await stage(openSkillFiles())

      bucket.put.mockImplementationOnce(async () => {
        throw new Error('R2 unavailable')
      })
      kv.put.mockClear()

      await expect(commit(manifest.stageId)).rejects.toThrow('R2 unavailable')

      expect(kv.put).toHaveBeenCalledWith(
        skillStageKey(manifest.stageId),
        expect.any(String),
        { expirationTtl: expect.any(Number) },
      )

      const ttl = kv.put.mock.calls[0]![2].expirationTtl

      expect(ttl).toBeGreaterThanOrEqual(60)
      expect(ttl).toBeLessThanOrEqual(3600)
      await expect(commit(manifest.stageId)).resolves.toMatchObject({
        kind: 'created',
      })
    })

    it('answers 404 to a commit that finds the manifest already claimed', async () => {
      const manifest = await stage(openSkillFiles())

      await commit(manifest.stageId)

      expect(await rejection(commit(manifest.stageId, { name: 'again' })))
        .toMatchObject({ status: 404, code: 'stage-not-found' })
      expect(await allSkills()).toHaveLength(1)
    })
  })

  describe('a reserved slash name', () => {
    it('forces slashCommand off when the skill is renamed to a reserved name', async () => {
      const manifest = await stage([
        archiveFile('SKILL.md', skillMarkdown({
          extra: 'user-invocable: true',
        })),
      ])

      expect(manifest.skill.slashCommand).toBe(true)

      await commit(manifest.stageId, { name: 'search' })

      const [skill] = await allSkills()

      expect(skill).toMatchObject({ name: 'search', slashCommand: false })
    })

    it('keeps slashCommand for an ordinary name', async () => {
      const manifest = await stage([
        archiveFile('SKILL.md', skillMarkdown({
          extra: 'user-invocable: true',
        })),
      ])

      await commit(manifest.stageId, { name: 'summarise' })

      expect((await allSkills())[0]).toMatchObject({ slashCommand: true })
    })
  })

  describe('re-asserting blobs after the pending rows exist', () => {
    it('writes every blob of a replace-as-update twice', async () => {
      const existingId = await seedSkill(testDb.db, userId, {
        name: 'review-pr',
        currentVersion: 1,
      })

      await seedSkillVersion(testDb.db, {
        skillId: existingId,
        userId,
        version: 1,
        files: [{ path: 'SKILL.md', sha256: shaOf('existing') }],
      })

      const manifest = await stage(openSkillFiles())

      bucket.putCalls.length = 0
      await commit(manifest.stageId, { asUpdateOf: existingId })

      const keys = bucket.putCalls.filter((key) => {
        return key.startsWith(`user-skills/u${userId}/${existingId}/`)
      })

      expect(keys).toHaveLength(6)
      expect(new Set(keys).size).toBe(3)
    })
  })

  describe('discardUnfinishedSkill', () => {
    async function seedBroken(status: 'broken' | 'ready' = 'broken') {
      const skillId = await seedSkill(testDb.db, userId, {
        name: 'half-done',
        status,
      })
      const [row] = await testDb.db.select().from(schema.skills)
        .where(eq(schema.skills.id, skillId))

      return { skillId, updatedAt: row!.updatedAt }
    }

    it('deletes a broken row, its rows and its blob prefix', async () => {
      const { skillId, updatedAt } = await seedBroken()

      await seedSkillVersion(testDb.db, {
        skillId,
        userId,
        version: 1,
        files: [{ path: 'SKILL.md', sha256: shaOf('half') }],
      })
      bucket.objects.set(
        `user-skills/u${userId}/${skillId}/blobs/${shaOf('half')}`,
        { bytes: new Uint8Array([1]), uploaded: new Date() },
      )

      await expect(discardUnfinishedSkill({
        db: testDb.db,
        bucket,
        userId,
        skillId,
        notUpdatedAfter: updatedAt,
      })).resolves.toBe(true)

      expect(await allSkills()).toHaveLength(0)
      expect(await testDb.db.select().from(schema.skillVersions))
        .toHaveLength(0)
      expect(bucket.objects.size).toBe(0)
    })

    it('leaves a row that became ready', async () => {
      const { skillId } = await seedBroken('ready')

      await expect(discardUnfinishedSkill({
        db: testDb.db,
        bucket,
        userId,
        skillId,
      })).resolves.toBe(false)
      expect(await allSkills()).toHaveLength(1)
    })

    it('leaves a row that was updated after it was observed', async () => {
      const { skillId, updatedAt } = await seedBroken()

      await expect(discardUnfinishedSkill({
        db: testDb.db,
        bucket,
        userId,
        skillId,
        notUpdatedAfter: new Date(updatedAt.getTime() - 5000),
      })).resolves.toBe(false)
      expect(await allSkills()).toHaveLength(1)
    })

    it('never touches another user\'s row', async () => {
      const { skillId, updatedAt } = await seedBroken()

      await expect(discardUnfinishedSkill({
        db: testDb.db,
        bucket,
        userId: otherUserId,
        skillId,
        notUpdatedAfter: updatedAt,
      })).resolves.toBe(false)
    })
  })

  describe('quotas', () => {
    it('answers 403 at the 50 skill cap', async () => {
      for (let index = 0; index < 50; index += 1) {
        await seedSkill(testDb.db, userId, { name: `skill-${index}` })
      }

      const manifest = await stage(openSkillFiles())

      expect(await rejection(commit(manifest.stageId))).toMatchObject({
        status: 403,
        code: 'skills-limit',
      })
    })

    it('still allows an update at the 50 skill cap', async () => {
      let existingId = ''

      for (let index = 0; index < 50; index += 1) {
        existingId = await seedSkill(testDb.db, userId, {
          name: index === 49 ? 'review-pr' : `skill-${index}`,
        })
      }

      await seedSkillVersion(testDb.db, {
        skillId: existingId,
        userId,
        version: 1,
        files: [{ path: 'SKILL.md', sha256: shaOf('x') }],
      })

      const manifest = await stage(openSkillFiles())

      await expect(commit(manifest.stageId, {
        asUpdateOf: existingId,
      })).resolves.toMatchObject({ kind: 'pending' })
    })

    it('answers 413 when unique blobs would pass 50 MiB', async () => {
      const skillId = await seedSkill(testDb.db, userId, { name: 'big' })

      await testDb.db.insert(schema.skillFiles).values({
        skillId,
        userId,
        version: 1,
        path: 'SKILL.md',
        blobSha256: shaOf('big'),
        bytes: SKILLS_MAX_USER_BYTES - 10,
        kind: 'skill-md',
      })

      const manifest = await stage(openSkillFiles())

      expect(await rejection(commit(manifest.stageId))).toMatchObject({
        status: 413,
        code: 'skills-storage-limit',
      })
    })

    it('counts a blob shared by several versions once', async () => {
      const skillId = await seedSkill(testDb.db, userId, { name: 'shared' })

      for (const version of [1, 2, 3]) {
        await testDb.db.insert(schema.skillFiles).values({
          skillId,
          userId,
          version,
          path: 'SKILL.md',
          blobSha256: shaOf('same-blob'),
          bytes: SKILLS_MAX_USER_BYTES / 2,
          kind: 'skill-md',
        })
      }

      const manifest = await stage(openSkillFiles())

      await expect(commit(manifest.stageId)).resolves.toMatchObject({
        kind: 'created',
      })
    })
  })

  describe('failure', () => {
    it('removes the half-created skill when a blob write fails', async () => {
      const manifest = await stage(openSkillFiles())

      bucket.put.mockImplementationOnce(async () => {
        throw new Error('R2 unavailable')
      })

      await expect(commit(manifest.stageId)).rejects.toThrow('R2 unavailable')

      expect(await allSkills()).toHaveLength(0)
      expect(await testDb.db.select().from(schema.skillVersions))
        .toHaveLength(0)
      expect(await testDb.db.select().from(schema.skillFiles)).toHaveLength(0)
      expect(kv.values.has(skillStageKey(manifest.stageId))).toBe(true)
    })

    it('answers 404 when a staged file expired before the commit', async () => {
      const manifest = await stage(openSkillFiles())

      for (const key of [...bucket.objects.keys()]) {
        bucket.objects.delete(key)
      }

      expect(await rejection(commit(manifest.stageId))).toMatchObject({
        status: 404,
      })
      expect(await allSkills()).toHaveLength(0)
    })
  })
})
