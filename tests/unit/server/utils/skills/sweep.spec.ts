import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  putFakeBlob,
  seedSkill,
  seedSkillVersion,
  shaOf,
} from '../../../../setup/helpers/skills-db'
import type {
  FakeSkillBucket,
  FakeSkillKv,
} from '../../../../setup/helpers/skills-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const {
  SKILL_SWEEP_BLOB_CURSOR_KEY,
  SKILL_SWEEP_STAGING_CURSOR_KEY,
  sweepSkillStorage,
} = await import('~~/server/utils/skills/sweep')
const { skillBlobKey } = await import('~~/server/utils/skills/storage')

const NOW = new Date('2026-11-13T12:00:00.000Z')
const TWO_HOURS_AGO = new Date(NOW.getTime() - 2 * 60 * 60 * 1000)
const TEN_MINUTES_AGO = new Date(NOW.getTime() - 10 * 60 * 1000)

describe('sweepSkillStorage', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let kv: FakeSkillKv
  let userId: number
  let skillId: string

  function sweep() {
    return sweepSkillStorage({ db: testDb.db, bucket, kv, now: NOW })
  }

  function stageObject(key: string, uploaded: Date) {
    bucket.objects.set(key, { bytes: new Uint8Array([1]), uploaded })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    kv = createFakeSkillKv()
    userId = await seedUser(testDb.db, null)
    skillId = await seedSkill(testDb.db, userId)
    await seedSkillVersion(testDb.db, {
      skillId,
      userId,
      version: 1,
      files: [{ path: 'SKILL.md', sha256: shaOf('referenced') }],
    })
  })

  afterEach(() => {
    testDb.close()
  })

  it('keeps a blob that a skill file references', async () => {
    const key = putFakeBlob(
      bucket,
      userId,
      skillId,
      shaOf('referenced'),
      TWO_HOURS_AGO,
    )
    const result = await sweep()

    expect(result.orphanBlobsDeleted).toBe(0)
    expect(bucket.objects.has(key)).toBe(true)
  })

  it('deletes an old blob that no skill file references', async () => {
    const key = putFakeBlob(
      bucket,
      userId,
      skillId,
      shaOf('orphan'),
      TWO_HOURS_AGO,
    )
    const result = await sweep()

    expect(result.orphanBlobsDeleted).toBe(1)
    expect(bucket.objects.has(key)).toBe(false)
  })

  it('keeps a young unreferenced blob: its save may still be writing rows', async () => {
    const key = putFakeBlob(
      bucket,
      userId,
      skillId,
      shaOf('orphan'),
      TEN_MINUTES_AGO,
    )
    const result = await sweep()

    expect(result.orphanBlobsDeleted).toBe(0)
    expect(bucket.objects.has(key)).toBe(true)
  })

  it('matches a blob to its own skill, not to a sibling with the same hash', async () => {
    const siblingId = await seedSkill(testDb.db, userId)
    const siblingKey = putFakeBlob(
      bucket,
      userId,
      siblingId,
      shaOf('referenced'),
      TWO_HOURS_AGO,
    )

    await sweep()

    expect(bucket.objects.has(siblingKey)).toBe(false)
  })

  it('deletes the blobs of a skill whose rows are gone', async () => {
    const key = putFakeBlob(
      bucket,
      userId,
      'skl99999',
      shaOf('referenced'),
      TWO_HOURS_AGO,
    )

    await sweep()

    expect(bucket.objects.has(key)).toBe(false)
  })

  it('leaves objects that are not blob keys alone and counts them', async () => {
    stageObject('user-skills/u1/skl1/SKILL.md', TWO_HOURS_AGO)
    stageObject(`user-skills/u1/skl1/blobs/${'Z'.repeat(64)}`, TWO_HOURS_AGO)

    const result = await sweep()

    expect(result.unrecognisedObjects).toBe(2)
    expect(bucket.objects.size).toBe(2)
  })

  it('deletes staged files older than one hour and keeps younger ones', async () => {
    stageObject('skills-staging/u1/old/SKILL.md', TWO_HOURS_AGO)
    stageObject('skills-staging/u1/new/SKILL.md', TEN_MINUTES_AGO)

    const result = await sweep()

    expect(result.stagingObjectsDeleted).toBe(1)
    expect([...bucket.objects.keys()]).toEqual([
      'skills-staging/u1/new/SKILL.md',
    ])
  })

  it('deletes in batches and never lists more than two pages per pass', async () => {
    bucket = createFakeSkillBucket(2)

    for (let index = 0; index < 7; index++) {
      putFakeBlob(
        bucket,
        userId,
        skillId,
        shaOf(`orphan${index}`),
        TWO_HOURS_AGO,
      )
    }

    const result = await sweep()
    const blobListCalls = bucket.listCalls.filter((call) => {
      return call.prefix === 'user-skills/'
    })

    expect(blobListCalls).toHaveLength(2)
    expect(result.orphanBlobsDeleted).toBe(4)
    expect(bucket.objects.size).toBe(3)
  })

  it('resumes from the saved cursor and clears it at the end', async () => {
    bucket = createFakeSkillBucket(2)

    for (let index = 0; index < 5; index++) {
      putFakeBlob(
        bucket,
        userId,
        skillId,
        shaOf(`orphan${index}`),
        TWO_HOURS_AGO,
      )
    }

    const keysBefore = [...bucket.objects.keys()].sort()

    await sweep()

    expect(kv.values.get(SKILL_SWEEP_BLOB_CURSOR_KEY)).toBe(keysBefore[3])

    const second = await sweep()

    expect(second.orphanBlobsDeleted).toBe(1)
    expect(kv.values.has(SKILL_SWEEP_BLOB_CURSOR_KEY)).toBe(false)
    expect(bucket.objects.size).toBe(0)
  })

  it('keeps separate cursors for staged files and blobs', async () => {
    bucket = createFakeSkillBucket(1)
    stageObject('skills-staging/u1/a/SKILL.md', TEN_MINUTES_AGO)
    stageObject('skills-staging/u1/b/SKILL.md', TEN_MINUTES_AGO)
    stageObject('skills-staging/u1/c/SKILL.md', TEN_MINUTES_AGO)

    await sweep()

    expect(kv.values.has(SKILL_SWEEP_STAGING_CURSOR_KEY)).toBe(true)
    expect(kv.values.has(SKILL_SWEEP_BLOB_CURSOR_KEY)).toBe(false)
  })

  it('drops a stored cursor when listing fails, so the next run starts over', async () => {
    kv.values.set(SKILL_SWEEP_STAGING_CURSOR_KEY, 'stale-cursor')
    bucket.list.mockRejectedValueOnce(new Error('bad cursor'))

    await expect(sweep()).rejects.toThrow('bad cursor')

    expect(kv.values.has(SKILL_SWEEP_STAGING_CURSOR_KEY)).toBe(false)
  })

  it('does nothing on an empty bucket', async () => {
    expect(await sweep()).toEqual({
      stagingObjectsDeleted: 0,
      orphanBlobsDeleted: 0,
      blobObjectsScanned: 0,
      unrecognisedObjects: 0,
    })
  })

  it('looks blobs up in groups, not one query per object', async () => {
    const selectSpy = vi.spyOn(testDb.db, 'select')

    for (let index = 0; index < 30; index++) {
      putFakeBlob(
        bucket,
        userId,
        skillId,
        shaOf(`orphan${index}`),
        TWO_HOURS_AGO,
      )
    }

    await sweep()

    expect(selectSpy).toHaveBeenCalledTimes(1)
    expect(bucket.objects.has(
      skillBlobKey(userId, skillId, shaOf('orphan0')),
    )).toBe(false)
  })
})
