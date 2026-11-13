import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

const logger = { set: vi.fn() }
const MIT_LICENCE = readFileSync(
  join(process.cwd(), 'tests/fixtures/skills/licences/mit.txt'),
  'utf-8',
)
const ANTHROPIC_LICENCE = readFileSync(
  join(
    process.cwd(),
    'tests/fixtures/skills/licences/anthropic-proprietary.txt',
  ),
  'utf-8',
)

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string, why?: string }
  }

  throw new Error('Expected a rejection')
}

describe('saveSkillChanges', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number
  let otherUserId: number

  async function seedAuthored(
    files: Record<string, string> = {
      'SKILL.md': skillMarkdown(),
      'references/notes.md': 'First note\n',
    },
    skill: Partial<typeof schema.skills.$inferInsert> = {},
  ) {
    return await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files,
      skill: { name: 'review-pr', enabled: true, ...skill },
    })
  }

  function save(
    skillId: string,
    changes: Parameters<typeof saveSkillChanges>[0]['changes'],
    overrides: { baseVersion?: number, note?: string | null } = {},
  ) {
    return saveSkillChanges({
      db: testDb.db,
      bucket,
      userId,
      skillId,
      baseVersion: overrides.baseVersion ?? 1,
      changes,
      note: overrides.note ?? null,
      logger,
    })
  }

  async function skillRow(skillId: string) {
    const [row] = await testDb.db.select()
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId))

    return row!
  }

  async function versionNumbers(skillId: string) {
    const rows = await testDb.db
      .select({ version: schema.skillVersions.version })
      .from(schema.skillVersions)
      .where(eq(schema.skillVersions.skillId, skillId))
      .orderBy(asc(schema.skillVersions.version))

    return rows.map((row) => {
      return row.version
    })
  }

  async function filePaths(skillId: string, version: number) {
    const rows = await testDb.db.select({ path: schema.skillFiles.path })
      .from(schema.skillFiles)
      .where(and(
        eq(schema.skillFiles.skillId, skillId),
        eq(schema.skillFiles.version, version),
      ))
      .orderBy(asc(schema.skillFiles.path))

    return rows.map((row) => {
      return row.path
    })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db)
    otherUserId = await seedUser(testDb.db)
    logger.set.mockClear()
  })

  afterEach(() => {
    testDb.close()
  })

  it('writes the next version with only the changed content', async () => {
    const { skillId, shas } = await seedAuthored()
    const putsBefore = bucket.putCalls.length
    const result = await save(skillId, [
      { op: 'put', path: 'references/notes.md', content: 'Second note\n' },
      { op: 'put', path: 'references/extra.md', content: 'Extra\n' },
    ], { note: 'Added notes' })

    expect(result).toMatchObject({
      unchanged: false,
      version: 2,
      filesCount: 3,
      renamed: false,
      licenseClass: 'authored',
    })
    expect(await versionNumbers(skillId)).toEqual([1, 2])
    expect(await filePaths(skillId, 2)).toEqual([
      'SKILL.md',
      'references/extra.md',
      'references/notes.md',
    ])

    const row = await skillRow(skillId)

    expect(row).toMatchObject({
      currentVersion: 2,
      filesCount: 3,
      enabled: true,
      status: 'ready',
      licenseClass: 'authored',
    })

    const [version] = await testDb.db.select()
      .from(schema.skillVersions)
      .where(and(
        eq(schema.skillVersions.skillId, skillId),
        eq(schema.skillVersions.version, 2),
      ))

    expect(version).toMatchObject({ origin: 'editor', note: 'Added notes' })

    const unchangedFile = await testDb.db.select()
      .from(schema.skillFiles)
      .where(and(
        eq(schema.skillFiles.skillId, skillId),
        eq(schema.skillFiles.version, 2),
        eq(schema.skillFiles.path, 'SKILL.md'),
      ))

    expect(unchangedFile[0]!.blobSha256).toBe(shas['SKILL.md'])
    expect(bucket.putCalls.slice(putsBefore).length).toBeGreaterThan(0)
    expect(
      bucket.putCalls.slice(putsBefore).some((key) => {
        return key.endsWith(shas['SKILL.md']!)
      }),
    ).toBe(false)
  })

  it('refuses a stale base version and leaves nothing behind', async () => {
    const { skillId } = await seedAuthored()

    await save(skillId, [
      { op: 'put', path: 'references/notes.md', content: 'Two\n' },
    ])

    const putsBefore = bucket.putCalls.length
    const failure = await failureOf(save(skillId, [
      { op: 'put', path: 'references/notes.md', content: 'Three\n' },
    ], { baseVersion: 1 }))

    expect(failure).toMatchObject({ status: 409, code: 'stale-base' })
    expect(await versionNumbers(skillId)).toEqual([1, 2])
    expect(await filePaths(skillId, 3)).toEqual([])
    expect((await skillRow(skillId)).currentVersion).toBe(2)
    expect(bucket.putCalls).toHaveLength(putsBefore)
  })

  it('lets exactly one of two concurrent saves from the same base win', async () => {
    const { skillId } = await seedAuthored()
    const outcomes = await Promise.allSettled([
      save(skillId, [
        { op: 'put', path: 'references/notes.md', content: 'Alpha\n' },
      ]),
      save(skillId, [
        { op: 'put', path: 'references/notes.md', content: 'Beta\n' },
      ]),
    ])
    const rejected = outcomes.filter((outcome) => {
      return outcome.status === 'rejected'
    })

    expect(outcomes.filter((outcome) => {
      return outcome.status === 'fulfilled'
    })).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      status: 409,
      code: 'stale-base',
    })
    expect(await versionNumbers(skillId)).toEqual([1, 2])
    expect(await filePaths(skillId, 2)).toHaveLength(2)
  })

  it('returns the current version when nothing changes', async () => {
    const { skillId } = await seedAuthored()
    const result = await save(skillId, [
      { op: 'put', path: 'references/notes.md', content: 'First note\n' },
    ])

    expect(result).toEqual({ unchanged: true, id: skillId, version: 1 })
    expect(await versionNumbers(skillId)).toEqual([1])
  })

  it('keeps a pending update pending and numbers after it', async () => {
    const { skillId } = await seedAuthored()

    await testDb.db.insert(schema.skillVersions).values({
      skillId,
      userId,
      version: 2,
      origin: 'update',
      sha256: 'f'.repeat(64),
      filesCount: 1,
      bytes: 1,
      licenseClass: 'open',
    })
    await testDb.db.update(schema.skills)
      .set({ pendingVersion: 2 })
      .where(eq(schema.skills.id, skillId))

    const result = await save(skillId, [
      { op: 'put', path: 'references/notes.md', content: 'Local edit\n' },
    ])

    expect(result).toMatchObject({ unchanged: false, version: 3 })

    const row = await skillRow(skillId)

    expect(row.currentVersion).toBe(3)
    expect(row.pendingVersion).toBe(2)
  })

  describe('renaming through SKILL.md', () => {
    it('renames the skill and records origin rename', async () => {
      const { skillId } = await seedAuthored()
      const result = await save(skillId, [{
        op: 'put',
        path: 'SKILL.md',
        content: skillMarkdown({ name: 'review-code' }),
      }])

      expect(result).toMatchObject({ version: 2, renamed: true })
      expect((await skillRow(skillId)).name).toBe('review-code')

      const [version] = await testDb.db.select()
        .from(schema.skillVersions)
        .where(and(
          eq(schema.skillVersions.skillId, skillId),
          eq(schema.skillVersions.version, 2),
        ))

      expect(version!.origin).toBe('rename')
    })

    it('refuses a name another skill of the user holds', async () => {
      const { skillId } = await seedAuthored()

      await seedSkillWithFiles(testDb.db, bucket, {
        userId,
        files: { 'SKILL.md': skillMarkdown({ name: 'taken' }) },
        skill: { name: 'taken' },
      })

      const failure = await failureOf(save(skillId, [{
        op: 'put',
        path: 'SKILL.md',
        content: skillMarkdown({ name: 'taken' }),
      }]))

      expect(failure).toMatchObject({ status: 409, code: 'name-taken' })
      expect(await versionNumbers(skillId)).toEqual([1])
      expect((await skillRow(skillId)).name).toBe('review-pr')
    })

    it('allows a name another user holds', async () => {
      const { skillId } = await seedAuthored()

      await seedSkillWithFiles(testDb.db, bucket, {
        userId: otherUserId,
        files: { 'SKILL.md': skillMarkdown({ name: 'shared-name' }) },
        skill: { name: 'shared-name' },
      })

      const result = await save(skillId, [{
        op: 'put',
        path: 'SKILL.md',
        content: skillMarkdown({ name: 'shared-name' }),
      }])

      expect(result).toMatchObject({ renamed: true })
    })

    it('refuses a reserved name while the skill is used as a command', async () => {
      const { skillId } = await seedAuthored(undefined, { slashCommand: true })
      const failure = await failureOf(save(skillId, [{
        op: 'put',
        path: 'SKILL.md',
        content: skillMarkdown({ name: 'memory' }),
      }]))

      expect(failure).toMatchObject({ status: 400, code: 'reserved-name' })
      expect(await versionNumbers(skillId)).toEqual([1])
    })

    it('allows a reserved name when the command toggle is off', async () => {
      const { skillId } = await seedAuthored()
      const result = await save(skillId, [{
        op: 'put',
        path: 'SKILL.md',
        content: skillMarkdown({ name: 'memory' }),
      }])

      expect(result).toMatchObject({ renamed: true })
    })

    it('refuses SKILL.md without a valid name or description', async () => {
      const { skillId } = await seedAuthored()
      const failure = await failureOf(save(skillId, [{
        op: 'put',
        path: 'SKILL.md',
        content: '# No frontmatter\n',
      }]))

      expect(failure).toMatchObject({ status: 400, code: 'frontmatter-invalid' })
      expect(await versionNumbers(skillId)).toEqual([1])
    })
  })

  describe('file operations', () => {
    it('deletes and renames files', async () => {
      const { skillId, shas } = await seedAuthored()
      const result = await save(skillId, [
        { op: 'rename', from: 'references/notes.md', to: 'references/old.md' },
        { op: 'put', path: 'references/new.md', content: 'New\n' },
        { op: 'delete', path: 'references/new.md' },
      ])

      expect(result).toMatchObject({ version: 2, filesCount: 2 })
      expect(await filePaths(skillId, 2)).toEqual([
        'SKILL.md',
        'references/old.md',
      ])

      const [renamed] = await testDb.db.select()
        .from(schema.skillFiles)
        .where(and(
          eq(schema.skillFiles.skillId, skillId),
          eq(schema.skillFiles.version, 2),
          eq(schema.skillFiles.path, 'references/old.md'),
        ))

      expect(renamed!.blobSha256).toBe(shas['references/notes.md'])
    })

    it.each([
      ['a traversal path', { op: 'put', path: '../evil.md', content: 'x' }, 'invalid-path'],
      ['a binary extension', { op: 'put', path: 'tool.exe', content: 'x' }, 'invalid-path'],
      ['a path in the wrong form', { op: 'put', path: './a.md', content: 'x' }, 'invalid-path'],
      ['NUL content', { op: 'put', path: 'a.md', content: 'a\u0000b' }, 'binary-content'],
      ['a case variant of a file', { op: 'put', path: 'References/Notes.md', content: 'x' }, 'path-exists'],
      ['deleting SKILL.md', { op: 'delete', path: 'SKILL.md' }, 'skill-md-required'],
      ['renaming SKILL.md', { op: 'rename', from: 'SKILL.md', to: 'a.md' }, 'skill-md-required'],
      ['deleting a missing file', { op: 'delete', path: 'nope.md' }, 'path-missing'],
      ['renaming a missing file', { op: 'rename', from: 'nope.md', to: 'a.md' }, 'path-missing'],
      ['renaming onto a file', { op: 'rename', from: 'references/notes.md', to: 'SKILL.md' }, 'skill-md-required'],
    ] as const)('refuses %s', async (_label, change, code) => {
      const { skillId } = await seedAuthored()
      const failure = await failureOf(save(skillId, [change]))

      expect(failure.code).toBe(code)
      expect(failure.status).toBeGreaterThanOrEqual(400)
      expect(await versionNumbers(skillId)).toEqual([1])
    })

    it('refuses a rename onto an existing file', async () => {
      const { skillId } = await seedAuthored({
        'SKILL.md': skillMarkdown(),
        'a.md': 'a',
        'b.md': 'b',
      })
      const failure = await failureOf(save(skillId, [
        { op: 'rename', from: 'a.md', to: 'b.md' },
      ]))

      expect(failure).toMatchObject({ status: 400, code: 'path-exists' })
    })

    it('refuses a file over 256 KiB', async () => {
      const { skillId } = await seedAuthored()
      const failure = await failureOf(save(skillId, [{
        op: 'put',
        path: 'big.md',
        content: 'x'.repeat(256 * 1024 + 1),
      }]))

      expect(failure).toMatchObject({ status: 413, code: 'file-too-large' })
    })

    it('counts encoded bytes, not characters', async () => {
      const { skillId } = await seedAuthored()
      const failure = await failureOf(save(skillId, [{
        op: 'put',
        path: 'wide.md',
        content: 'щ'.repeat(130 * 1024),
      }]))

      expect(failure).toMatchObject({ status: 413, code: 'file-too-large' })
    })

    it('refuses a save over 2 MiB of content', async () => {
      const { skillId } = await seedAuthored()
      const changes = Array.from({ length: 9 }, (_unused, index) => {
        return {
          op: 'put' as const,
          path: `part-${index}.md`,
          content: `${index}`.repeat(250 * 1024),
        }
      })
      const failure = await failureOf(save(skillId, changes))

      expect(failure).toMatchObject({ status: 413, code: 'save-too-large' })
      expect(await versionNumbers(skillId)).toEqual([1])
    })

    it('refuses more than 200 files', async () => {
      const files: Record<string, string> = { 'SKILL.md': skillMarkdown() }

      for (let index = 0; index < 199; index++) {
        files[`f${index}.md`] = `${index}`
      }

      const { skillId } = await seedAuthored(files)
      const failure = await failureOf(save(skillId, [
        { op: 'put', path: 'one-too-many.md', content: 'x' },
      ]))

      expect(failure).toMatchObject({ status: 413, code: 'too-many-files' })
    })

    it('refuses when the unique blobs of the user would exceed the cap', async () => {
      const { skillId } = await seedAuthored()

      await testDb.db.insert(schema.skillFiles).values({
        skillId: 'skl9999',
        userId,
        version: 1,
        path: 'huge.md',
        blobSha256: 'a'.repeat(64),
        bytes: 50 * 1024 * 1024,
        kind: 'other',
      })

      const failure = await failureOf(save(skillId, [
        { op: 'put', path: 'references/notes.md', content: 'New content\n' },
      ]))

      expect(failure).toMatchObject({ status: 413, code: 'skills-storage-limit' })
      expect(await versionNumbers(skillId)).toEqual([1])
    })
  })

  describe('licence', () => {
    it.each(['open', 'custom'] as const)(
      'keeps LICENSE and NOTICE as they are in a %s skill',
      async (licenseClass) => {
        const { skillId } = await seedAuthored({
          'SKILL.md': skillMarkdown(),
          'LICENSE': MIT_LICENCE,
          'NOTICE.md': 'Notice\n',
        }, { licenseClass })
        const attempts = [
          { op: 'put' as const, path: 'LICENSE', content: 'changed' },
          { op: 'delete' as const, path: 'LICENSE' },
          { op: 'rename' as const, from: 'LICENSE', to: 'COPYING' },
          { op: 'rename' as const, from: 'NOTICE.md', to: 'notes.md' },
          { op: 'put' as const, path: 'LICENCE.md', content: 'second' },
        ]

        for (const change of attempts) {
          const failure = await failureOf(save(skillId, [change]))

          expect(failure).toMatchObject({
            status: 403,
            code: 'licence-file-locked',
          })
        }

        expect(await versionNumbers(skillId)).toEqual([1])
      },
    )

    it('lets other files change in an open skill', async () => {
      const { skillId } = await seedAuthored({
        'SKILL.md': skillMarkdown(),
        'LICENSE': MIT_LICENCE,
      }, { licenseClass: 'open' })
      const result = await save(skillId, [
        { op: 'put', path: 'references/guide.md', content: 'Guide\n' },
      ])

      expect(result).toMatchObject({ version: 2, licenseClass: 'open' })
    })

    it('blocks a restricted licence file with the section 4 message', async () => {
      const { skillId } = await seedAuthored()
      const failure = await failureOf(save(skillId, [
        { op: 'put', path: 'LICENSE.txt', content: ANTHROPIC_LICENCE },
      ]))

      expect(failure).toMatchObject({ status: 422, code: 'licence-restricted' })
      expect(failure.why).toContain('Anthropic')
      expect(await versionNumbers(skillId)).toEqual([1])
    })

    it('keeps class authored when a permissive licence file is added', async () => {
      const { skillId } = await seedAuthored()
      const result = await save(skillId, [
        { op: 'put', path: 'LICENSE', content: MIT_LICENCE },
      ])
      const row = await skillRow(skillId)

      expect(result).toMatchObject({ licenseClass: 'authored' })
      expect(row.licenseClass).toBe('authored')
      expect(row.licenseFileSha256).toMatch(/^[0-9a-f]{64}$/)
    })

    it('reclassifies a skill that is not authored on every save', async () => {
      const { skillId } = await seedAuthored(undefined, {
        licenseClass: 'none',
        sourceKind: 'zip',
      })
      const result = await save(skillId, [
        { op: 'put', path: 'LICENSE', content: MIT_LICENCE },
      ])

      expect(result).toMatchObject({ licenseClass: 'open' })
      expect((await skillRow(skillId)).licenseClass).toBe('open')
    })

    it('does not block an authored skill on a proprietary licence field alone', async () => {
      const { skillId } = await seedAuthored()
      const result = await save(skillId, [{
        op: 'put',
        path: 'SKILL.md',
        content: skillMarkdown({ extra: 'license: Proprietary' }),
      }])

      expect(result).toMatchObject({ licenseClass: 'authored' })
    })
  })

  describe('findings', () => {
    it('counts what the save adds and removes', async () => {
      const { skillId } = await seedAuthored()

      await save(skillId, [{
        op: 'put',
        path: 'references/notes.md',
        content: 'See https://example.com/page now\n',
      }])

      const [withUrl] = await testDb.db.select()
        .from(schema.skillVersions)
        .where(and(
          eq(schema.skillVersions.skillId, skillId),
          eq(schema.skillVersions.version, 2),
        ))

      expect(withUrl!.findings).toEqual({ url: 1 })

      await save(skillId, [{
        op: 'put',
        path: 'references/notes.md',
        content: 'Plain text again\n',
      }], { baseVersion: 2 })

      const [clean] = await testDb.db.select()
        .from(schema.skillVersions)
        .where(and(
          eq(schema.skillVersions.skillId, skillId),
          eq(schema.skillVersions.version, 3),
        ))

      expect(clean!.findings).toEqual({})
    })

    it('can repair a skill whose blob is missing', async () => {
      const { skillId, shas } = await seedAuthored()

      bucket.objects.delete(
        `user-skills/u${userId}/${skillId}/blobs/${shas['references/notes.md']}`,
      )

      const result = await save(skillId, [{
        op: 'put',
        path: 'references/notes.md',
        content: 'Fixed\n',
      }])

      expect(result).toMatchObject({ version: 2 })
    })
  })

  describe('recovering a broken skill', () => {
    it('marks the skill ready when every blob of the new version exists', async () => {
      const { skillId } = await seedAuthored(undefined, {
        status: 'broken',
        enabled: false,
      })
      const result = await save(skillId, [
        { op: 'put', path: 'references/notes.md', content: 'Fixed\n' },
      ])
      const row = await skillRow(skillId)

      expect(result).toMatchObject({ version: 2, recovered: true })
      expect(row).toMatchObject({ status: 'ready', enabled: false })
    })

    it('stays broken while a blob of the new version is missing', async () => {
      const { skillId, shas } = await seedAuthored(undefined, {
        status: 'broken',
        enabled: false,
      })

      bucket.objects.delete(
        `user-skills/u${userId}/${skillId}/blobs/${shas['references/notes.md']}`,
      )

      const result = await save(skillId, [
        { op: 'put', path: 'references/other.md', content: 'Other\n' },
      ])

      expect(result).toMatchObject({ version: 2, recovered: false })
      expect((await skillRow(skillId)).status).toBe('broken')
    })

    it('leaves other statuses alone', async () => {
      const { skillId } = await seedAuthored(undefined, {
        status: 'needs-review',
      })
      const result = await save(skillId, [
        { op: 'put', path: 'references/notes.md', content: 'Edited\n' },
      ])

      expect(result).toMatchObject({ recovered: false })
      expect((await skillRow(skillId)).status).toBe('needs-review')
    })
  })

  describe('the storage cap', () => {
    async function fillStorage() {
      await testDb.db.insert(schema.skillFiles).values({
        skillId: 'skl9999',
        userId,
        version: 1,
        path: 'huge.md',
        blobSha256: 'a'.repeat(64),
        bytes: 60 * 1024 * 1024,
        kind: 'other',
      })
    }

    it('lets a delete-only save through when the user is over the cap', async () => {
      const { skillId } = await seedAuthored()

      await fillStorage()

      const result = await save(skillId, [
        { op: 'delete', path: 'references/notes.md' },
      ])

      expect(result).toMatchObject({ version: 2, filesCount: 1 })
    })

    it('lets through a save that reuses a blob the skill already holds', async () => {
      const { skillId } = await seedAuthored()

      await fillStorage()

      const result = await save(skillId, [
        { op: 'put', path: 'references/copy.md', content: 'First note\n' },
      ])

      expect(result).toMatchObject({ version: 2, filesCount: 3 })
    })
  })

  it('fails with files-missing when SKILL.md cannot be read', async () => {
    const { skillId, shas } = await seedAuthored()

    bucket.objects.delete(
      `user-skills/u${userId}/${skillId}/blobs/${shas['SKILL.md']}`,
    )

    const failure = await failureOf(save(skillId, [
      { op: 'put', path: 'references/notes.md', content: 'Edit\n' },
    ]))

    expect(failure).toMatchObject({ status: 409, code: 'files-missing' })
  })

  it('answers 404 for another user, an unknown skill and an undecodable id', async () => {
    const { skillId } = await seedAuthored()

    for (const id of [skillId, 'skl424242', '../x']) {
      const failure = await failureOf(saveSkillChanges({
        db: testDb.db,
        bucket,
        userId: otherUserId,
        skillId: id,
        baseVersion: 1,
        changes: [{ op: 'put', path: 'a.md', content: 'x' }],
        note: null,
        logger,
      }))

      expect(failure).toMatchObject({ status: 404, code: 'skill-not-found' })
    }
  })

  it('prunes beyond 20 versions and removes blobs nothing references', async () => {
    const { skillId, shas } = await seedAuthored()
    const firstNoteKey
      = `user-skills/u${userId}/${skillId}/blobs/${shas['references/notes.md']}`

    for (let index = 0; index < 22; index++) {
      await save(skillId, [{
        op: 'put',
        path: 'references/notes.md',
        content: `Revision ${index}\n`,
      }], { baseVersion: index + 1 })
    }

    const versions = await versionNumbers(skillId)

    expect(versions).toHaveLength(20)
    expect(versions.at(-1)).toBe(23)
    expect(bucket.objects.has(firstNoteKey)).toBe(false)
    expect((await skillRow(skillId)).currentVersion).toBe(23)
  })

  it('logs ids and counts, never content', async () => {
    const { skillId } = await seedAuthored()

    await save(skillId, [
      {
        op: 'put',
        path: 'references/secret-plans.md',
        content: 'UNIQUE-CONTENT-MARKER',
      },
      { op: 'put', path: 'SKILL.md', content: skillMarkdown({
        name: 'private-name',
        description: 'private-description-marker',
      }) },
    ], { note: 'private-note-marker' })

    const logged = JSON.stringify(logger.set.mock.calls)

    expect(logged).toContain('"puts":2')
    expect(logged).not.toContain('UNIQUE-CONTENT-MARKER')
    expect(logged).not.toContain('secret-plans')
    expect(logged).not.toContain('private-name')
    expect(logged).not.toContain('private-description-marker')
    expect(logged).not.toContain('private-note-marker')
  })
})
