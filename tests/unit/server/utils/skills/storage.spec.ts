import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  putFakeBlob,
  seedSkill,
  seedSkillVersion,
  shaOf,
} from '../../../../setup/helpers/skills-db'
import type { FakeSkillBucket } from '../../../../setup/helpers/skills-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const {
  deleteSkillPrefix,
  parseSkillBlobKey,
  pruneSkillVersions,
  putSkillBlob,
  putSkillBlobs,
  skillBlobKey,
  skillPrefix,
  skillStagingUserPrefix,
  skillUserPrefix,
} = await import('~~/server/utils/skills/storage')

const { sha256Hex } = await import('#shared/utils/knowledge-hash')

const HOST_SKILLS_DIRECTORY = join(process.cwd(), 'skills')
const SHA = 'ab12'.repeat(16)

describe('skill key builder', () => {
  it('derives the content-addressed layout', () => {
    expect(skillBlobKey(7, 'skl12', SHA)).toBe(
      `user-skills/u7/skl12/blobs/${SHA}`,
    )
    expect(skillPrefix(7, 'skl12')).toBe('user-skills/u7/skl12/')
    expect(skillUserPrefix(7)).toBe('user-skills/u7/')
    expect(skillStagingUserPrefix(7)).toBe('skills-staging/u7/')
  })

  it('round-trips through parseSkillBlobKey', () => {
    expect(parseSkillBlobKey(skillBlobKey(7, 'skl12', SHA))).toEqual({
      userId: 7,
      skillId: 'skl12',
      sha256: SHA,
    })
  })

  it.each([
    'user-skills/u7/skl12/SKILL.md',
    'user-skills/u7/skl12/blobs/SKILL.md',
    `user-skills/u07/skl12/blobs/${SHA}`,
    `user-skills/u7/../skl12/blobs/${SHA}`,
    `skills/u7/skl12/blobs/${SHA}`,
    `user-skills/u7/skl12/blobs/${SHA.toUpperCase()}`,
  ])('does not parse %s as a blob key', (key) => {
    expect(parseSkillBlobKey(key)).toBeNull()
  })

  it.each(['..', '.', 'a/b', 'a/../b', 'SKILL.md', '', 'a b', '%2e%2e'])(
    'refuses the skill id %j',
    (skillId) => {
      expect(() => skillBlobKey(1, skillId, SHA)).toThrow()
      expect(() => skillPrefix(1, skillId)).toThrow()
    },
  )

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'refuses the user id %s',
    (userId) => {
      expect(() => skillBlobKey(userId, 'skl1', SHA)).toThrow()
      expect(() => skillUserPrefix(userId)).toThrow()
      expect(() => skillStagingUserPrefix(userId)).toThrow()
    },
  )

  it.each([
    '',
    'SKILL.md',
    '../etc/passwd',
    'a'.repeat(63),
    'g'.repeat(64),
    SHA.toUpperCase(),
    `${SHA}/SKILL.md`,
  ])('refuses the hash %j', (sha256) => {
    expect(() => skillBlobKey(1, 'skl1', sha256)).toThrow()
  })

  describe('never public', () => {
    const hostSkillNames = readdirSync(HOST_SKILLS_DIRECTORY, {
      withFileTypes: true,
    })
      .filter((entry) => {
        return entry.isDirectory()
      })
      .map((entry) => {
        return entry.name
      })
    const userIds = [1, 7, 1234567]
    const skillIds = ['skl1', 'abcXYZ0123', 'A', 'z'.repeat(64)]
    const keys = userIds.flatMap((userId) => {
      return skillIds.map((skillId) => {
        return skillBlobKey(userId, skillId, SHA)
      })
    })

    it('finds the host skills the discovery routes serve', () => {
      expect(hostSkillNames.length).toBeGreaterThan(0)
    })

    it('stays outside the host skills directory and its routes', () => {
      for (const key of keys) {
        expect(key.startsWith('user-skills/u')).toBe(true)
        expect(key.startsWith('skills/')).toBe(false)
        expect(key).not.toContain('..')
        expect(key).not.toContain('.well-known')
        expect(key).not.toContain('agent-skills')
        expect(key).not.toMatch(/SKILL\.md/i)
      }
    })

    it('never equals a key the host mount resolves', () => {
      const mountKeys = hostSkillNames.map((name) => {
        return `${name}/SKILL.md`
      })

      for (const key of keys) {
        expect(mountKeys).not.toContain(key)
        expect(hostSkillNames).not.toContain(key.split('/')[0])
      }
    })

    it('carries no user-controlled text, only ids and a hash', () => {
      for (const key of keys) {
        expect(key).toMatch(
          /^user-skills\/u[1-9]\d*\/[A-Za-z0-9]{1,64}\/blobs\/[0-9a-f]{64}$/,
        )
      }
    })
  })
})

describe('putSkillBlob', () => {
  let bucket: FakeSkillBucket

  beforeEach(() => {
    bucket = createFakeSkillBucket()
  })

  it('writes a blob under the key derived from its content hash', async () => {
    const result = await putSkillBlob({
      bucket,
      userId: 3,
      skillId: 'skl5',
      content: '# Skill',
    })
    const expectedSha = await sha256Hex(new TextEncoder().encode('# Skill'))

    expect(result).toEqual({
      sha256: expectedSha,
      key: `user-skills/u3/skl5/blobs/${expectedSha}`,
      bytes: 7,
      written: true,
    })
    expect(bucket.put).toHaveBeenCalledWith(
      result.key,
      expect.any(Uint8Array),
      expect.objectContaining({ customMetadata: { sha256: expectedSha } }),
    )
  })

  it('does not write the same content twice for one skill', async () => {
    const first = await putSkillBlob({
      bucket,
      userId: 3,
      skillId: 'skl5',
      content: 'same',
    })
    const second = await putSkillBlob({
      bucket,
      userId: 3,
      skillId: 'skl5',
      content: 'same',
    })

    expect(first.written).toBe(true)
    expect(second.written).toBe(false)
    expect(second.key).toBe(first.key)
    expect(bucket.put).toHaveBeenCalledTimes(1)
  })

  it('keeps blobs of different skills and users apart', async () => {
    await putSkillBlob({ bucket, userId: 3, skillId: 'skl5', content: 'x' })
    await putSkillBlob({ bucket, userId: 3, skillId: 'skl6', content: 'x' })
    await putSkillBlob({ bucket, userId: 4, skillId: 'skl5', content: 'x' })

    expect(bucket.put).toHaveBeenCalledTimes(3)
    expect(bucket.objects.size).toBe(3)
  })

  it('writes only the changed files of a save, one after another', async () => {
    await putSkillBlobs({
      bucket,
      userId: 3,
      skillId: 'skl5',
      contents: ['SKILL.md v1', 'references/a.md'],
    })
    bucket.putCalls.length = 0

    const results = await putSkillBlobs({
      bucket,
      userId: 3,
      skillId: 'skl5',
      contents: ['SKILL.md v2', 'references/a.md'],
    })

    expect(results.map((result) => {
      return result.written
    })).toEqual([true, false])
    expect(bucket.putCalls).toHaveLength(1)
  })

  it('accepts binary content', async () => {
    const result = await putSkillBlob({
      bucket,
      userId: 3,
      skillId: 'skl5',
      content: new Uint8Array([1, 2, 3]),
    })

    expect(result.bytes).toBe(3)
  })
})

describe('deleteSkillPrefix', () => {
  it('deletes a skill prefix page by page with batched deletes', async () => {
    const bucket = createFakeSkillBucket(2)

    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      putFakeBlob(bucket, 7, 'skl1', shaOf(seed))
    }

    putFakeBlob(bucket, 7, 'skl2', shaOf('a'))

    const deleted = await deleteSkillPrefix(skillPrefix(7, 'skl1'), bucket)

    expect(deleted).toBe(5)
    expect(bucket.deleteCalls.map((keys) => {
      return keys.length
    })).toEqual([2, 2, 1])
    expect([...bucket.objects.keys()]).toEqual([
      skillBlobKey(7, 'skl2', shaOf('a')),
    ])
  })

  it.each([
    'user-skills/',
    'user-skills/u7',
    'user-skills/u0/',
    'user-skills/u7/skl1',
    'user-skills/u7/../u8/',
    'skills/',
    'knowledge/u7/',
    'documents/7/',
    '',
  ])('refuses the prefix %j', async (prefix) => {
    const bucket = createFakeSkillBucket()

    await expect(deleteSkillPrefix(prefix, bucket)).rejects.toThrow()
    expect(bucket.list).not.toHaveBeenCalled()
  })

  it('accepts the staging prefix of one user', async () => {
    const bucket = createFakeSkillBucket()

    bucket.objects.set('skills-staging/u7/stage1/SKILL.md', {
      bytes: new Uint8Array([1]),
      uploaded: new Date(0),
    })

    expect(
      await deleteSkillPrefix(skillStagingUserPrefix(7), bucket),
    ).toBe(1)
  })
})

describe('pruneSkillVersions', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number
  let skillId: string

  async function seedVersions(count: number) {
    for (let version = 1; version <= count; version++) {
      await seedSkillVersion(testDb.db, {
        skillId,
        userId,
        version,
        files: [
          { path: 'SKILL.md', sha256: shaOf(`skill${version}`) },
          { path: 'references/shared.md', sha256: shaOf('shared') },
        ],
      })
      putFakeBlob(bucket, userId, skillId, shaOf(`skill${version}`))
    }

    putFakeBlob(bucket, userId, skillId, shaOf('shared'))
  }

  async function remainingVersions(): Promise<number[]> {
    const rows = await testDb.db.select({
      version: schema.skillVersions.version,
    }).from(schema.skillVersions)

    return rows
      .map((row) => {
        return row.version
      })
      .sort((first, second) => {
        return first - second
      })
  }

  function hasBlob(seed: string, owner: string = skillId): boolean {
    return bucket.objects.has(skillBlobKey(userId, owner, shaOf(seed)))
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db, null)
    skillId = await seedSkill(testDb.db, userId, { currentVersion: 25 })
  })

  afterEach(() => {
    testDb.close()
  })

  it('does nothing while the skill has no more versions than it keeps', async () => {
    await seedVersions(20)
    await testDb.db.update(schema.skills).set({ currentVersion: 20 })

    const result = await pruneSkillVersions({
      db: testDb.db,
      bucket,
      userId,
      skillId,
    })

    expect(result).toEqual({ versionsPruned: 0, blobsDeleted: 0 })
    expect(bucket.delete).not.toHaveBeenCalled()
  })

  it('keeps the newest 20 versions and deletes the rest', async () => {
    await seedVersions(25)

    const result = await pruneSkillVersions({
      db: testDb.db,
      bucket,
      userId,
      skillId,
    })

    expect(result.versionsPruned).toBe(5)
    expect(await remainingVersions()).toEqual(
      Array.from({ length: 20 }, (_value, index) => {
        return index + 6
      }),
    )

    const files = await testDb.db.select({
      version: schema.skillFiles.version,
    }).from(schema.skillFiles)

    expect(Math.min(...files.map((file) => {
      return file.version
    }))).toBe(6)
  })

  it('deletes only blobs that no remaining version references', async () => {
    await seedVersions(25)

    const result = await pruneSkillVersions({
      db: testDb.db,
      bucket,
      userId,
      skillId,
    })

    expect(result.blobsDeleted).toBe(5)
    expect(bucket.deleteCalls).toHaveLength(1)

    for (let version = 1; version <= 5; version++) {
      expect(hasBlob(`skill${version}`)).toBe(false)
    }

    expect(hasBlob('shared')).toBe(true)
    expect(hasBlob('skill6')).toBe(true)
  })

  it('keeps the pending version even when it is old', async () => {
    await seedVersions(25)
    await testDb.db.update(schema.skills).set({ pendingVersion: 2 })

    const result = await pruneSkillVersions({
      db: testDb.db,
      bucket,
      userId,
      skillId,
    })

    expect(result.versionsPruned).toBe(4)
    expect((await remainingVersions()).slice(0, 2)).toEqual([2, 6])
    expect(hasBlob('skill2')).toBe(true)
  })

  it('keeps the current version even when it is old', async () => {
    await seedVersions(25)
    await testDb.db.update(schema.skills).set({ currentVersion: 1 })

    await pruneSkillVersions({ db: testDb.db, bucket, userId, skillId })

    expect((await remainingVersions())[0]).toBe(1)
    expect(hasBlob('skill1')).toBe(true)
  })

  it('keeps versions pinned by a share', async () => {
    await seedVersions(25)

    const result = await pruneSkillVersions({
      db: testDb.db,
      bucket,
      userId,
      skillId,
      pinnedVersions: [3, 4],
    })

    expect(result.versionsPruned).toBe(3)
    expect((await remainingVersions()).slice(0, 3)).toEqual([3, 4, 6])
    expect(hasBlob('skill3')).toBe(true)
    expect(hasBlob('skill1')).toBe(false)
  })

  it('honours a custom number of kept versions', async () => {
    await seedVersions(6)
    await testDb.db.update(schema.skills).set({ currentVersion: 6 })

    const result = await pruneSkillVersions({
      db: testDb.db,
      bucket,
      userId,
      skillId,
      keep: 2,
    })

    expect(result.versionsPruned).toBe(4)
    expect(await remainingVersions()).toEqual([5, 6])
  })

  it('leaves another skill of the same user untouched', async () => {
    const otherSkillId = await seedSkill(testDb.db, userId, {
      currentVersion: 1,
    })

    await seedVersions(25)
    await seedSkillVersion(testDb.db, {
      skillId: otherSkillId,
      userId,
      version: 1,
      files: [{ path: 'SKILL.md', sha256: shaOf('skill1') }],
    })
    putFakeBlob(bucket, userId, otherSkillId, shaOf('skill1'))

    await pruneSkillVersions({ db: testDb.db, bucket, userId, skillId })

    const files = await testDb.db.select().from(schema.skillFiles)

    expect(files.filter((file) => {
      return file.skillId === otherSkillId
    })).toHaveLength(1)
    expect(hasBlob('skill1', otherSkillId)).toBe(true)
  })

  it('does nothing for a skill that belongs to another user', async () => {
    await seedVersions(25)

    const result = await pruneSkillVersions({
      db: testDb.db,
      bucket,
      userId: userId + 1000,
      skillId,
    })

    expect(result).toEqual({ versionsPruned: 0, blobsDeleted: 0 })
    expect(await remainingVersions()).toHaveLength(25)
  })
})
