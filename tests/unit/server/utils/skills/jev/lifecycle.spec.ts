import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JEV_SKILL_SCREENING } from '#shared/utils/jev-policy'
import { analyzeSkillFiles } from '#shared/utils/skills/analyze'
import type { SkillArchiveFile } from '#shared/utils/skills/archive'
import { createSkillJevMark } from '#shared/utils/skills/jev-findings'
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
  createFakeSkillKv,
  seedSkill,
  seedSkillVersion,
  seedSkillWithFiles,
  shaOf,
} from '../../../../../setup/helpers/skills-db'
import type {
  FakeSkillBucket,
  FakeSkillKv,
} from '../../../../../setup/helpers/skills-db'
import { skillMarkdown } from '../../../../../setup/helpers/skill-archives'

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  invalidateStorageCache: vi.fn(async () => undefined),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    experimental_decide: (...args: unknown[]) => mocks.decide(...args),
  }
})

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
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
const { saveSkillChanges } = await import(
  '~~/server/utils/skills/versions/save'
)
const { restoreSkillVersion } = await import(
  '~~/server/utils/skills/versions/restore'
)
const { pruneSkillVersions } = await import('~~/server/utils/skills/storage')
const { deleteUserSkill, purgeUserSkills } = await import(
  '~~/server/utils/skills/cleanup'
)
const {
  deleteSkillJevMarks,
  moveSkillJevMarks,
  purgeUserSkillJevMarks,
  skillJevMarksKey,
  skillJevStageKey,
  toStoredJevFindingCounts,
} = await import('~~/server/utils/skills/jev/store')

const encoder = new TextEncoder()
const logger = { set: vi.fn() }

function archiveFile(path: string, text: string): SkillArchiveFile {
  return { path, bytes: encoder.encode(text), text }
}

function storedResult(
  overrides: Partial<{
    questionSetVersion: number
    marks: number
    unchecked: number
    versionSha256: string
  }> = {},
) {
  return {
    questionSetVersion: overrides.questionSetVersion
      ?? JEV_SKILL_SCREENING.questionSetVersion,
    status: 'ok' as const,
    marks: Array.from({ length: overrides.marks ?? 2 }, (_value, index) => {
      return createSkillJevMark({
        path: 'SKILL.md',
        startLine: index + 1,
        endLine: index + 2,
        question: 'k1_send_out',
        score: 0.9,
      })
    }),
    unchecked: Array.from({ length: overrides.unchecked ?? 1 }, () => {
      return { path: 'references/a.md', startLine: 3, endLine: 9 }
    }),
    tooLarge: false,
    callsSpent: 3,
    screenedAt: 1,
    versionSha256: overrides.versionSha256 ?? null,
  }
}

describe('skill screening lifecycle', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let kv: FakeSkillKv
  let userId: number

  async function stage(files: SkillArchiveFile[]) {
    const analysis = await analyzeSkillFiles({ files, folderName: null })

    if (!analysis.ok) {
      throw new Error(`Sample is invalid: ${analysis.code}`)
    }

    return await stageSkillImport({
      kv,
      bucket,
      userId,
      source: 'zip',
      sourceVersion: 'sha256-aaaaaaaaaaaaaaaa',
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
      licenseAcknowledged: true,
      logger,
      ...extra,
    })
  }

  async function versionRow(skillId: string, version: number) {
    const [row] = await testDb.db.select()
      .from(schema.skillVersions)
      .where(and(
        eq(schema.skillVersions.skillId, skillId),
        eq(schema.skillVersions.version, version),
      ))

    return row
  }

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

  const openFiles = () => [
    archiveFile('SKILL.md', skillMarkdown()),
    archiveFile('references/checklist.md', '- Check tests\n'),
  ]

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    kv = createFakeSkillKv()
    userId = await seedUser(testDb.db, null)
    mocks.decide.mockReset()
    vi.stubGlobal('useKV', () => kv)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  describe('commit', () => {
    it('copies the counts into findings and keeps the marks for version 1', async () => {
      const manifest = await stage(openFiles())

      kv.values.set(
        skillJevStageKey(manifest.stageId),
        JSON.stringify(storedResult()),
      )

      const result = await commit(manifest.stageId)

      expect(result.kind).toBe('created')

      const row = await versionRow(result.id, 1)

      expect(row?.findings).toMatchObject({
        ...manifest.findingCounts,
        'jev:marked': 2,
        'jev:unchecked': 1,
        'jev:questionSet': JEV_SKILL_SCREENING.questionSetVersion,
      })
      expect(kv.values.has(skillJevMarksKey(userId, result.id, 1))).toBe(true)
      expect(kv.values.has(skillJevStageKey(manifest.stageId))).toBe(false)
    })

    it('leaves the rule counts as they were', async () => {
      const manifest = await stage(openFiles())

      kv.values.set(
        skillJevStageKey(manifest.stageId),
        JSON.stringify(storedResult({ marks: 9 })),
      )

      const result = await commit(manifest.stageId)
      const findings = (await versionRow(result.id, 1))?.findings ?? {}

      for (const [key, count] of Object.entries(manifest.findingCounts)) {
        expect(findings[key]).toBe(count)
      }
    })

    it('stores nothing about Jev when no check ran', async () => {
      const manifest = await stage(openFiles())
      const result = await commit(manifest.stageId)
      const findings = (await versionRow(result.id, 1))?.findings ?? {}

      expect(Object.keys(findings).some(key => key.startsWith('jev:')))
        .toBe(false)
      expect(kv.values.has(skillJevMarksKey(userId, result.id, 1))).toBe(false)
    })

    it('ignores a result of another question set', async () => {
      const manifest = await stage(openFiles())

      kv.values.set(
        skillJevStageKey(manifest.stageId),
        JSON.stringify(storedResult({
          questionSetVersion: JEV_SKILL_SCREENING.questionSetVersion + 1,
        })),
      )

      const result = await commit(manifest.stageId)
      const findings = (await versionRow(result.id, 1))?.findings ?? {}

      expect(Object.keys(findings).some(key => key.startsWith('jev:')))
        .toBe(false)
      expect(kv.values.has(skillJevMarksKey(userId, result.id, 1))).toBe(false)
    })

    it('keeps the stage result when the commit fails, for a retry', async () => {
      const existingId = await seedExisting()
      const manifest = await stage(openFiles())

      kv.values.set(
        skillJevStageKey(manifest.stageId),
        JSON.stringify(storedResult()),
      )

      await expect(commit(manifest.stageId)).rejects.toMatchObject({
        status: 409,
        code: 'name-taken',
      })
      expect(kv.values.has(skillJevStageKey(manifest.stageId))).toBe(true)

      const result = await commit(manifest.stageId, { asUpdateOf: existingId })

      expect(result.kind).toBe('pending')
    })
  })

  describe('an update that waits for review', () => {
    async function commitPending() {
      const existingId = await seedExisting()
      const manifest = await stage(openFiles())

      kv.values.set(
        skillJevStageKey(manifest.stageId),
        JSON.stringify(storedResult()),
      )

      const result = await commit(manifest.stageId, { asUpdateOf: existingId })

      if (result.kind !== 'pending') {
        throw new Error('expected a pending version')
      }

      return { skillId: existingId, pending: result }
    }

    it('keeps the marks under the pending version', async () => {
      const { skillId, pending } = await commitPending()

      expect(kv.values.has(
        skillJevMarksKey(userId, skillId, pending.pendingVersion),
      )).toBe(true)
      expect((await versionRow(skillId, pending.pendingVersion))?.findings)
        .toMatchObject({ 'jev:marked': 2 })
    })

    it('moves the marks and the counts to the accepted version', async () => {
      const { skillId, pending } = await commitPending()
      const accepted = await acceptPendingSkillVersion({
        db: testDb.db,
        bucket,
        userId,
        skillId,
        version: pending.pendingVersion,
        sha256: pending.sha256,
        licenseAcknowledged: true,
        kv,
      })

      expect(kv.values.has(
        skillJevMarksKey(userId, skillId, pending.pendingVersion),
      )).toBe(false)
      expect(kv.values.has(
        skillJevMarksKey(userId, skillId, accepted.version),
      )).toBe(true)
      expect((await versionRow(skillId, accepted.version))?.findings)
        .toMatchObject({
          'jev:marked': 2,
          'jev:unchecked': 1,
          'jev:questionSet': JEV_SKILL_SCREENING.questionSetVersion,
        })
    })

    it('moves no marks left behind by another pending version', async () => {
      const { skillId, pending } = await commitPending()
      const key = skillJevMarksKey(userId, skillId, pending.pendingVersion)
      const stale = JSON.parse(kv.values.get(key)!)

      kv.values.set(key, JSON.stringify({
        ...stale,
        versionSha256: 'f'.repeat(64),
      }))

      const accepted = await acceptPendingSkillVersion({
        db: testDb.db,
        bucket,
        userId,
        skillId,
        version: pending.pendingVersion,
        sha256: pending.sha256,
        licenseAcknowledged: true,
        kv,
      })

      expect(kv.values.has(
        skillJevMarksKey(userId, skillId, accepted.version),
      )).toBe(false)
      expect(kv.values.has(key)).toBe(false)
    })

    it('deletes the marks when the update is rejected', async () => {
      const { skillId, pending } = await commitPending()

      await rejectPendingSkillVersion({
        db: testDb.db,
        userId,
        skillId,
        version: pending.pendingVersion,
        sha256: pending.sha256,
        kv,
      })

      expect(kv.values.has(
        skillJevMarksKey(userId, skillId, pending.pendingVersion),
      )).toBe(false)
    })

    it('deletes the marks of a pending version that a newer one replaces', async () => {
      const { skillId, pending } = await commitPending()
      const second = await stage([
        archiveFile('SKILL.md', skillMarkdown({ body: 'Changed body\n' })),
      ])
      const replaced = await commit(second.stageId, { asUpdateOf: skillId })

      expect(replaced.kind).toBe('pending')
      expect(kv.values.has(
        skillJevMarksKey(userId, skillId, pending.pendingVersion),
      )).toBe(false)
    })
  })

  describe('marks go with their version', () => {
    function seedMarks(skillId: string, versions: number[]) {
      for (const version of versions) {
        kv.values.set(
          skillJevMarksKey(userId, skillId, version),
          JSON.stringify(storedResult()),
        )
      }
    }

    it('deletes the marks of the versions a prune removes', async () => {
      const skillId = await seedSkill(testDb.db, userId, { currentVersion: 3 })

      for (const version of [1, 2, 3]) {
        await seedSkillVersion(testDb.db, {
          skillId,
          userId,
          version,
          files: [{ path: 'SKILL.md', sha256: shaOf(`v${version}`) }],
        })
      }

      seedMarks(skillId, [1, 2, 3])

      await pruneSkillVersions({
        db: testDb.db,
        bucket,
        userId,
        skillId,
        keep: 1,
      })

      expect([...kv.values.keys()]).toEqual([
        skillJevMarksKey(userId, skillId, 3),
      ])
    })

    it('deletes the marks of a deleted skill, and only of that skill', async () => {
      const first = await seedSkill(testDb.db, userId, { currentVersion: 2 })
      const second = await seedSkill(testDb.db, userId, { currentVersion: 1 })

      for (const version of [1, 2]) {
        await seedSkillVersion(testDb.db, {
          skillId: first,
          userId,
          version,
          files: [{ path: 'SKILL.md', sha256: shaOf(`a${version}`) }],
        })
      }

      await seedSkillVersion(testDb.db, {
        skillId: second,
        userId,
        version: 1,
        files: [{ path: 'SKILL.md', sha256: shaOf('b1') }],
      })
      seedMarks(first, [1, 2])
      seedMarks(second, [1])

      await deleteUserSkill(
        testDb.db,
        { userId, skillId: first, logger },
        bucket,
      )

      expect([...kv.values.keys()]).toEqual([
        skillJevMarksKey(userId, second, 1),
      ])
    })

    it('purges every marks entry of the user on account deletion', async () => {
      const skillId = await seedSkill(testDb.db, userId)

      seedMarks(skillId, [1, 2])
      kv.values.set(skillJevMarksKey(userId + 1, 'other', 1), '{}')
      Object.assign(kv, {
        list: vi.fn(async (options: { prefix: string }) => {
          return {
            keys: [...kv.values.keys()]
              .filter(key => key.startsWith(options.prefix))
              .map(name => ({ name })),
            list_complete: true,
          }
        }),
      })

      await purgeUserSkills(testDb.db, userId, logger, bucket)

      expect([...kv.values.keys()]).toEqual([
        skillJevMarksKey(userId + 1, 'other', 1),
      ])
    })

    it('never fails the caller of a per-version delete when the store does', async () => {
      kv.delete.mockRejectedValue(new Error('kv down'))

      await expect(deleteSkillJevMarks({
        userId,
        skillId: 'abc',
        versions: [1, 2],
        kv,
      })).resolves.toBeUndefined()
      await expect(moveSkillJevMarks({
        userId,
        skillId: 'abc',
        fromVersion: 1,
        toVersion: 2,
        versionSha256: 'a'.repeat(64),
        kv: null,
      })).resolves.toBeNull()
      await expect(purgeUserSkillJevMarks({ userId, kv: null }))
        .resolves.toBeUndefined()
    })

    it('lets the account purge fail so the deletion can be retried', async () => {
      kv.values.set(skillJevMarksKey(userId, 'abc', 1), '{}')
      kv.delete.mockRejectedValue(new Error('kv down'))
      Object.assign(kv, {
        list: vi.fn(async () => {
          return {
            keys: [{ name: skillJevMarksKey(userId, 'abc', 1) }],
            list_complete: true,
          }
        }),
      })

      await expect(purgeUserSkillJevMarks({ userId, kv }))
        .rejects.toThrow('kv down')
      await expect(purgeUserSkills(testDb.db, userId, logger, bucket))
        .rejects.toThrow('kv down')
    })

    it('keeps the old marks when the new key cannot be written', async () => {
      const sha256 = 'c'.repeat(64)
      const oldKey = skillJevMarksKey(userId, 'abc', 1)

      kv.values.set(oldKey, JSON.stringify(storedResult({
        versionSha256: sha256,
      })))
      kv.put.mockRejectedValue(new Error('kv down'))

      await moveSkillJevMarks({
        userId,
        skillId: 'abc',
        fromVersion: 1,
        toVersion: 2,
        versionSha256: sha256,
        kv,
      })

      expect(kv.values.has(oldKey)).toBe(true)
    })

    it('ignores marks stored for other content than the version has', async () => {
      const key = skillJevMarksKey(userId, 'abc', 1)

      kv.values.set(key, JSON.stringify(storedResult({
        versionSha256: 'd'.repeat(64),
      })))

      await expect(moveSkillJevMarks({
        userId,
        skillId: 'abc',
        fromVersion: 1,
        toVersion: 2,
        versionSha256: 'e'.repeat(64),
        kv,
      })).resolves.toBeNull()
      expect(kv.values.has(skillJevMarksKey(userId, 'abc', 2))).toBe(false)
      expect(kv.values.has(key)).toBe(false)
    })

    it('reads counts only for the current question set', () => {
      expect(toStoredJevFindingCounts(null)).toEqual({})
      expect(toStoredJevFindingCounts(
        storedResult({ questionSetVersion: 0 }),
      )).toEqual({})
      expect(toStoredJevFindingCounts(storedResult())).toEqual({
        'jev:marked': 2,
        'jev:unchecked': 1,
        'jev:questionSet': JEV_SKILL_SCREENING.questionSetVersion,
      })
    })
  })

  describe('editor and restore paths run no check', () => {
    async function seedScreenedSkill() {
      return await seedSkillWithFiles(testDb.db, bucket, {
        userId,
        files: {
          'SKILL.md': skillMarkdown(),
          'references/notes.md': 'Original\n',
        },
        skill: { name: 'review-pr' },
        versionValues: {
          findings: { 'rulesVersion': 3, 'high': 1, 'jev:marked': 4 },
        },
      })
    }

    it('drops the Jev counts on an in-app save and sends nothing', async () => {
      const { skillId } = await seedScreenedSkill()
      const saved = await saveSkillChanges({
        db: testDb.db,
        bucket,
        userId,
        skillId,
        baseVersion: 1,
        changes: [
          { op: 'put', path: 'references/notes.md', content: 'Edited\n' },
        ],
        note: null,
        logger,
      })
      const findings = (await versionRow(skillId, saved.version))?.findings
        ?? {}

      expect(Object.keys(findings).some(key => key.startsWith('jev:')))
        .toBe(false)
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('drops the Jev counts when a version is restored and sends nothing', async () => {
      const { skillId } = await seedScreenedSkill()
      const saved = await saveSkillChanges({
        db: testDb.db,
        bucket,
        userId,
        skillId,
        baseVersion: 1,
        changes: [
          { op: 'put', path: 'references/notes.md', content: 'Edited\n' },
        ],
        note: null,
        logger,
      })
      const restored = await restoreSkillVersion({
        db: testDb.db,
        bucket,
        userId,
        skillId,
        version: 1,
        baseVersion: saved.version,
        note: null,
        logger,
      })

      expect(restored.unchanged).toBe(false)

      if (restored.unchanged) {
        return
      }

      const findings = (await versionRow(skillId, restored.version))
        ?.findings ?? {}

      expect(Object.keys(findings).some(key => key.startsWith('jev:')))
        .toBe(false)
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('has no path from the editor, restore or MCP code to Jev', () => {
      const root = process.cwd()
      const directories = [
        'server/utils/skills/versions',
        'server/utils/mcp/private',
        'server/mcp/tools',
      ]
      const guarded = directories.flatMap((directory) => {
        return readdirSync(join(root, directory))
          .filter((name) => {
            return directory !== 'server/utils/skills/versions'
              ? /skill/i.test(name)
              : name.endsWith('.ts')
          })
          .map(name => join(root, directory, name))
      })
      const forbidden = [
        'jev/skill-screening',
        'jev/client',
        'jev/roles',
        'skills/jev/screen',
        'jevDecide',
        'experimental_decide',
      ]

      expect(guarded.length).toBeGreaterThan(10)

      for (const path of guarded) {
        const source = readFileSync(path, 'utf8')

        for (const needle of forbidden) {
          expect(source, `${path} mentions ${needle}`).not.toContain(needle)
        }
      }
    })
  })
})
