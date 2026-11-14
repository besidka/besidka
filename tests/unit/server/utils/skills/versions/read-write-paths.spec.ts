import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { extractSkillArchive } from '#shared/utils/skills/archive'
import { SKILL_DIFF_MAX_FILES } from '#shared/utils/skills-policy'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedChat,
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
const { diffSkillVersions } = await import(
  '~~/server/utils/skills/versions/diff'
)
const { buildSkillArchive, readSkillVersionFiles } = await import(
  '~~/server/utils/skills/versions/files'
)
const { getSkillDetail, listSkillVersions, listUserSkills } = await import(
  '~~/server/utils/skills/versions/view'
)
const { updateSkillSettings } = await import(
  '~~/server/utils/skills/versions/settings'
)
const { deleteUserSkill } = await import('~~/server/utils/skills/cleanup')

const logger = { set: vi.fn() }

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string, message?: string }
  }

  throw new Error('Expected a rejection')
}

describe('skill reads, settings and delete', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number
  let skillId: string

  async function save(
    baseVersion: number,
    changes: Parameters<typeof saveSkillChanges>[0]['changes'],
  ) {
    return await saveSkillChanges({
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

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db)
    skillId = (await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: {
        'SKILL.md': skillMarkdown(),
        'references/notes.md': 'One\nTwo\nThree\n',
        'references/same.md': 'Unchanged\n',
      },
      skill: { name: 'review-pr', enabled: true },
    })).skillId
    logger.set.mockClear()
  })

  afterEach(() => {
    testDb.close()
  })

  describe('diff', () => {
    it('shows what version v would change in the current one', async () => {
      await save(1, [
        { op: 'put', path: 'references/notes.md', content: 'One\n2\nThree\n' },
        { op: 'put', path: 'references/added.md', content: 'New\n' },
        { op: 'delete', path: 'references/same.md' },
      ])

      const diff = await diffSkillVersions({
        db: testDb.db,
        bucket,
        userId,
        skillId,
        version: 1,
      })

      expect(diff.from.version).toBe(2)
      expect(diff.to.version).toBe(1)
      expect(diff.diff.unchanged).toBe(1)
      expect(diff.diff.files.map((file) => {
        return [file.path, file.status]
      })).toEqual([
        ['references/added.md', 'removed'],
        ['references/notes.md', 'modified'],
        ['references/same.md', 'added'],
      ])
    })

    it('compares against another version and reads only changed blobs', async () => {
      await save(1, [
        { op: 'put', path: 'references/notes.md', content: 'Changed\n' },
      ])

      bucket.get.mockClear()

      const diff = await diffSkillVersions({
        db: testDb.db,
        bucket,
        userId,
        skillId,
        version: 2,
        against: 1,
      })

      expect(diff.diff.files).toHaveLength(1)
      expect(bucket.get).toHaveBeenCalledTimes(2)
    })

    it('answers 404 for an unknown version', async () => {
      expect(await failureOf(diffSkillVersions({
        db: testDb.db,
        bucket,
        userId,
        skillId,
        version: 9,
      }))).toMatchObject({ status: 404, code: 'version-not-found' })
    })

    it('reads at most 50 changed files and lists the rest as skipped', async () => {
      const changes = Array.from(
        { length: SKILL_DIFF_MAX_FILES + 5 },
        (_unused, index) => {
          return {
            op: 'put' as const,
            path: `many/f${String(index).padStart(3, '0')}.md`,
            content: `${index}\n`,
          }
        },
      )

      await save(1, changes.slice(0, 50))
      await save(2, changes.slice(50))

      const diff = await diffSkillVersions({
        db: testDb.db,
        bucket,
        userId,
        skillId,
        version: 3,
        against: 1,
      })

      expect(diff.diff.files).toHaveLength(SKILL_DIFF_MAX_FILES)
      expect(diff.skipped).toHaveLength(5)
    })
  })

  describe('files and download', () => {
    it('lists the files with their editability', async () => {
      const result = await readSkillVersionFiles({
        db: testDb.db,
        bucket,
        userId,
        skillId,
      })

      expect(result.version).toBe(1)
      expect(result.files).toHaveLength(3)
      expect(result.files.every((file) => {
        return file.editable
      })).toBe(true)
    })

    it('reads one file as text and answers 404 for a missing path', async () => {
      const file = await readSkillVersionFiles({
        db: testDb.db,
        bucket,
        userId,
        skillId,
        path: 'references/notes.md',
      })

      expect(file).toMatchObject({ text: 'One\nTwo\nThree\n', kind: 'reference' })
      expect(await failureOf(readSkillVersionFiles({
        db: testDb.db,
        bucket,
        userId,
        skillId,
        path: 'nope.md',
      }))).toMatchObject({ status: 404, code: 'file-not-found' })
    })

    it('answers 409 when the blob is missing', async () => {
      const [row] = await testDb.db.select()
        .from(schema.skillFiles)
        .where(eq(schema.skillFiles.path, 'references/notes.md'))

      bucket.objects.delete(
        `user-skills/u${userId}/${skillId}/blobs/${row!.blobSha256}`,
      )

      expect(await failureOf(readSkillVersionFiles({
        db: testDb.db,
        bucket,
        userId,
        skillId,
        path: 'references/notes.md',
      }))).toMatchObject({ status: 409, code: 'files-missing' })
    })

    it('marks licence files of an open skill and oversized files read-only', async () => {
      const { skillId: openId } = await seedSkillWithFiles(testDb.db, bucket, {
        userId,
        files: {
          'SKILL.md': skillMarkdown({ name: 'open-skill' }),
          'LICENSE': 'MIT text\n',
          'big.md': 'x'.repeat(256 * 1024 + 1),
        },
        skill: { name: 'open-skill', licenseClass: 'open' },
      })
      const result = await readSkillVersionFiles({
        db: testDb.db,
        bucket,
        userId,
        skillId: openId,
      })

      expect(Object.fromEntries(result.files.map((file) => {
        return [file.path, file.editable]
      }))).toEqual({ 'SKILL.md': true, 'LICENSE': false, 'big.md': false })
    })

    it('builds a zip the importer reads back', async () => {
      const archive = await buildSkillArchive({
        db: testDb.db,
        bucket,
        userId,
        skillId,
      })
      const extracted = extractSkillArchive(archive.bytes)

      expect(archive).toMatchObject({ name: 'review-pr', filesCount: 3 })
      expect(extracted.ok).toBe(true)

      if (extracted.ok) {
        expect(extracted.folderName).toBe('review-pr')
        expect(extracted.files.map((file) => {
          return file.path
        }).sort()).toEqual([
          'SKILL.md',
          'references/notes.md',
          'references/same.md',
        ])
      }
    })

    it('does not read another user\'s skill', async () => {
      const otherUserId = await seedUser(testDb.db)

      expect(await failureOf(buildSkillArchive({
        db: testDb.db,
        bucket,
        userId: otherUserId,
        skillId,
      }))).toMatchObject({ status: 404 })
    })
  })

  describe('list and detail', () => {
    it('counts sources and exposes the command', async () => {
      const seed = async (
        name: string,
        values: Partial<typeof schema.skills.$inferInsert>,
      ) => {
        await seedSkillWithFiles(testDb.db, bucket, {
          userId,
          files: { 'SKILL.md': skillMarkdown({ name }) },
          skill: { name, ...values },
        })
      }

      await seed('imported-skill', { sourceKind: 'zip' })
      await seed('from-github', { sourceKind: 'github' })
      await seed('from-agent', { sourceKind: 'mcp' })
      await seed('only-command', {
        slashName: 'run-it',
        modelInvocable: false,
      })
      await seed('auto', { modelInvocable: true })

      const otherUserId = await seedUser(testDb.db)

      await seedSkillWithFiles(testDb.db, bucket, {
        userId: otherUserId,
        files: { 'SKILL.md': skillMarkdown({ name: 'foreign' }) },
        skill: { name: 'foreign' },
      })

      const result = await listUserSkills(testDb.db, userId)

      expect(result.skills).toHaveLength(6)
      expect(result.counts).toEqual({
        sources: { all: 6, created: 3, imported: 2, apps: 1 },
      })
      expect(result.skills.find((skill) => {
        return skill.name === 'only-command'
      })).toMatchObject({ command: 'run-it', slashCommand: true })
      expect(result.skills.find((skill) => {
        return skill.name === 'auto'
      })).toMatchObject({ command: null, slashCommand: false })
      expect(result.skills.every((skill) => {
        return !('userId' in skill)
      })).toBe(true)
    })

    it('returns the detail with files, licence and the pending version', async () => {
      await save(1, [
        { op: 'put', path: 'references/notes.md', content: 'Edited\n' },
      ])
      await testDb.db.insert(schema.skillVersions).values({
        skillId,
        userId,
        version: 3,
        origin: 'update',
        sha256: 'd'.repeat(64),
        filesCount: 1,
        bytes: 1,
        licenseClass: 'open',
      })
      await testDb.db.update(schema.skills)
        .set({ pendingVersion: 3 })
        .where(eq(schema.skills.id, skillId))

      const detail = await getSkillDetail(testDb.db, userId, skillId)
      const versions = await listSkillVersions(testDb.db, userId, skillId)

      expect(detail).toMatchObject({
        currentVersion: 2,
        pendingVersion: 3,
        licence: { class: 'authored', filesLocked: false },
      })
      expect(detail.files).toHaveLength(3)
      expect(detail.currentVersionInfo).toMatchObject({
        version: 2,
        origin: 'editor',
        isCurrent: true,
      })
      expect(detail.pendingVersionInfo).toMatchObject({
        version: 3,
        isPending: true,
      })
      expect(versions.versions.map((version) => {
        return version.version
      })).toEqual([3, 2, 1])
    })
  })

  describe('settings', () => {
    it('changes the mode and the hint without creating a version', async () => {
      const result = await updateSkillSettings({
        db: testDb.db,
        userId,
        skillId,
        changes: {
          mode: 'off',
          argumentHint: 'What to review',
        },
        logger,
      })
      const versions = await testDb.db.select()
        .from(schema.skillVersions)
        .where(eq(schema.skillVersions.skillId, skillId))

      expect(result).toMatchObject({
        enabled: false,
        argumentHint: 'What to review',
        currentVersion: 1,
      })
      expect(versions).toHaveLength(1)
    })

    function patch(changes: Parameters<typeof updateSkillSettings>[0]['changes']) {
      return updateSkillSettings({
        db: testDb.db,
        userId,
        skillId,
        changes,
        logger,
      })
    }

    async function slashNameOf(id: string) {
      const [row] = await testDb.db
        .select({ slashName: schema.skills.slashName })
        .from(schema.skills)
        .where(eq(schema.skills.id, id))

      return row!.slashName
    }

    it('sets the two columns from one mode and never touches the command', async () => {
      await testDb.db.update(schema.skills)
        .set({
          enabled: false,
          modelInvocable: false,
          slashName: 'keep-me',
        })
        .where(eq(schema.skills.id, skillId))

      await expect(patch({ mode: 'auto' })).resolves.toMatchObject({
        enabled: true,
        modelInvocable: true,
        command: 'keep-me',
      })
      await expect(patch({ mode: 'ask' })).resolves.toMatchObject({
        enabled: true,
        modelInvocable: false,
        command: 'keep-me',
      })
      await expect(patch({ mode: 'off' })).resolves.toMatchObject({
        enabled: false,
        modelInvocable: false,
        command: 'keep-me',
      })
    })

    it('succeeds for a reserved skill name', async () => {
      await testDb.db.update(schema.skills)
        .set({ name: 'memory', enabled: false })
        .where(eq(schema.skills.id, skillId))

      await expect(patch({ mode: 'auto' })).resolves.toMatchObject({
        name: 'memory',
        enabled: true,
        modelInvocable: true,
        command: null,
        slashCommand: false,
      })
    })

    it('sets a command and derives slashCommand from it', async () => {
      const result = await patch({ command: 'review-pr' })

      expect(result).toMatchObject({
        command: 'review-pr',
        slashCommand: true,
        enabled: true,
      })
      expect(await slashNameOf(skillId)).toBe('review-pr')
    })

    it('trims the command and drops one leading slash', async () => {
      await expect(patch({ command: '  /review-pr ' })).resolves
        .toMatchObject({ command: 'review-pr' })
    })

    it('clears the command with null and keeps the mode', async () => {
      await patch({ command: 'review-pr' })

      const result = await patch({ command: null })

      expect(result).toMatchObject({
        command: null,
        slashCommand: false,
        enabled: true,
      })
      expect(await slashNameOf(skillId)).toBeNull()
    })

    it('treats an empty command as clearing it', async () => {
      await patch({ command: 'review-pr' })

      await expect(patch({ command: '   ' })).resolves
        .toMatchObject({ command: null, slashCommand: false })
    })

    it('keeps the command when only the hint changes', async () => {
      await patch({ command: 'review-pr' })

      await expect(patch({ argumentHint: 'A link' })).resolves
        .toMatchObject({ command: 'review-pr', argumentHint: 'A link' })
    })

    it('allows setting the command the skill already has', async () => {
      await patch({ command: 'review-pr' })

      await expect(patch({ command: 'review-pr' })).resolves
        .toMatchObject({ command: 'review-pr' })
    })

    it.each(['memory', '/model', 'help', 'new'])(
      'refuses the reserved command %s with 400 reserved-name',
      async (command) => {
        expect(await failureOf(patch({ command })))
          .toMatchObject({ status: 400, code: 'reserved-name' })
        expect(await slashNameOf(skillId)).toBeNull()
      },
    )

    it.each(['Foo', '/Foo', 'a_b', 'a--b', 'two words'])(
      'refuses the invalid command %j with 400 reserved-name',
      async (command) => {
        expect(await failureOf(patch({ command })))
          .toMatchObject({ status: 400, code: 'reserved-name' })
        expect(await slashNameOf(skillId)).toBeNull()
      },
    )

    it('refuses a command another skill of the user has with 409', async () => {
      await seedSkillWithFiles(testDb.db, bucket, {
        userId,
        files: { 'SKILL.md': skillMarkdown({ name: 'other-skill' }) },
        skill: { name: 'other-skill', slashName: 'shared' },
      })

      const failure = await failureOf(patch({ command: 'shared' }))

      expect(failure).toMatchObject({
        status: 409,
        code: 'command-taken',
        message: '/shared is already a command',
      })
      expect(await slashNameOf(skillId)).toBeNull()
    })

    it('allows a command another user has', async () => {
      const otherUserId = await seedUser(testDb.db)

      await seedSkillWithFiles(testDb.db, bucket, {
        userId: otherUserId,
        files: { 'SKILL.md': skillMarkdown({ name: 'theirs' }) },
        skill: { name: 'theirs', slashName: 'shared' },
      })

      await expect(patch({ command: 'shared' })).resolves
        .toMatchObject({ command: 'shared' })
    })

    it('changes the mode and the command together', async () => {
      await expect(patch({ mode: 'ask', command: 'review-pr' })).resolves
        .toMatchObject({
          enabled: true,
          modelInvocable: false,
          command: 'review-pr',
        })
    })

    it('logs whether the skill has a command, not the command', async () => {
      await patch({ command: 'private-command' })

      const logged = JSON.stringify(logger.set.mock.calls)

      expect(logged).toContain('"hasCommand":true')
      expect(logged).not.toContain('private-command')
    })

    it('refuses a broken skill for Auto and Only when I ask', async () => {
      await testDb.db.update(schema.skills)
        .set({ status: 'broken', enabled: false })
        .where(eq(schema.skills.id, skillId))

      expect(await failureOf(updateSkillSettings({
        db: testDb.db,
        userId,
        skillId,
        changes: { mode: 'ask' },
        logger,
      }))).toMatchObject({ status: 409, code: 'skill-broken' })
    })

    it('refuses to enable a broken skill but allows needs-review', async () => {
      await testDb.db.update(schema.skills)
        .set({ status: 'broken', enabled: false })
        .where(eq(schema.skills.id, skillId))

      expect(await failureOf(updateSkillSettings({
        db: testDb.db,
        userId,
        skillId,
        changes: { mode: 'auto' },
        logger,
      }))).toMatchObject({ status: 409, code: 'skill-broken' })

      await testDb.db.update(schema.skills)
        .set({ status: 'needs-review' })
        .where(eq(schema.skills.id, skillId))

      await expect(updateSkillSettings({
        db: testDb.db,
        userId,
        skillId,
        changes: { mode: 'auto' },
        logger,
      })).resolves.toMatchObject({ enabled: true })
    })

    it('answers 404 for another user', async () => {
      const otherUserId = await seedUser(testDb.db)

      expect(await failureOf(updateSkillSettings({
        db: testDb.db,
        userId: otherUserId,
        skillId,
        changes: { mode: 'off' },
        logger,
      }))).toMatchObject({ status: 404 })
    })
  })

  describe('deleteUserSkill', () => {
    it('removes the rows, the chat choices and the R2 prefix of one skill', async () => {
      const keep = await seedSkillWithFiles(testDb.db, bucket, {
        userId,
        files: { 'SKILL.md': skillMarkdown({ name: 'kept' }) },
        skill: { name: 'kept' },
      })
      const chat = await seedChat(testDb.db, userId)

      await testDb.db.insert(schema.skillChatSettings).values([
        {
          userId,
          chatPublicId: chat.id,
          skillId,
          enabled: true,
        },
        {
          userId,
          chatPublicId: chat.id,
          skillId: keep.skillId,
          enabled: true,
        },
      ])
      await save(1, [
        { op: 'put', path: 'references/notes.md', content: 'Edited\n' },
      ])

      const result = await deleteUserSkill(
        testDb.db,
        { userId, skillId, logger },
        bucket,
      )

      expect(result).toMatchObject({
        skillDeleted: true,
        skillVersionsDeleted: 2,
        skillChatSettingsDeleted: 1,
        objectCleanupFailed: false,
      })
      expect(result.skillObjectsDeleted).toBeGreaterThan(0)
      expect([...bucket.objects.keys()].some((key) => {
        return key.includes(`/${skillId}/`)
      })).toBe(false)
      expect([...bucket.objects.keys()].some((key) => {
        return key.includes(`/${keep.skillId}/`)
      })).toBe(true)
      expect(await testDb.db.select({ id: schema.skills.id })
        .from(schema.skills)).toEqual([{ id: keep.skillId }])
      expect(JSON.stringify(logger.set.mock.calls)).toContain(skillId)
    })

    it('deletes nothing of another user and keeps the objects', async () => {
      const otherUserId = await seedUser(testDb.db)
      const objectsBefore = bucket.objects.size
      const result = await deleteUserSkill(
        testDb.db,
        { userId: otherUserId, skillId, logger },
        bucket,
      )

      expect(result.skillDeleted).toBe(false)
      expect(bucket.objects.size).toBe(objectsBefore)
    })

    it('keeps going when the R2 prefix delete fails', async () => {
      bucket.list.mockRejectedValueOnce(new Error('R2 down'))

      const result = await deleteUserSkill(
        testDb.db,
        { userId, skillId, logger },
        bucket,
      )

      expect(result).toMatchObject({
        skillDeleted: true,
        objectCleanupFailed: true,
      })
      expect(await testDb.db.select().from(schema.skills)).toEqual([])
    })
  })
})
