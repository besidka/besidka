import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  SKILL_UPDATE_RECHECK_MS,
  getSkillUpdateAvailable,
  markSkillUpdateSeen,
  readSkillUpdateState,
} from '~~/server/utils/skills/import/update-state'
import type { FeatureEvaluationConfig } from '~~/server/utils/features/provider'
import { sweepSkillUpdates } from '~~/server/utils/skills/import/update-sweep'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../../setup/helpers/memory-extraction-db'
import {
  SKILLS_FEATURE_CONFIG,
  createFakeSkillKv,
  grantFeature,
  seedSkill,
} from '../../../../../setup/helpers/skills-db'
import type { FakeSkillKv } from '../../../../../setup/helpers/skills-db'
import {
  GITHUB_SHA_ONE,
  GITHUB_SHA_TWO,
  createGithubMock,
} from '../../../../../setup/helpers/github-mock'
import type { GithubMock } from '../../../../../setup/helpers/github-mock'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const NOW = new Date(Date.UTC(2026, 10, 14, 12, 0, 0))
const TAG_SHA = '4'.repeat(40)
const NEWER_TAG_SHA = '5'.repeat(40)

describe('sweepSkillUpdates', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeSkillKv
  let github: GithubMock
  let userId: number

  async function seedGithubSkill(
    values: Partial<typeof schema.skills.$inferInsert> = {},
  ) {
    return await seedSkill(testDb.db, userId, {
      sourceKind: 'github',
      sourceUrl: 'https://github.com/o/r',
      sourceRef: 'main',
      sourcePath: 'skills/a',
      sourceVersion: GITHUB_SHA_ONE,
      ...values,
    })
  }

  async function sweep(
    options: {
      now?: Date
      limit?: number
      fetchImpl?: typeof fetch
      featureConfig?: FeatureEvaluationConfig
    } = {},
  ) {
    return await sweepSkillUpdates({
      db: testDb.db,
      kv,
      now: options.now ?? NOW,
      limit: options.limit,
      fetchImpl: options.fetchImpl ?? github.fetch as unknown as typeof fetch,
      featureConfig: options.featureConfig ?? SKILLS_FEATURE_CONFIG,
    })
  }

  function forgetCachedRefs() {
    for (const key of [...kv.values.keys()]) {
      if (key.startsWith('skills:github:')) {
        kv.values.delete(key)
      }
    }
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    kv = createFakeSkillKv()
    github = createGithubMock()
    github.setBranch('main', GITHUB_SHA_ONE)
    userId = await seedUser(testDb.db, null)
    await grantFeature(testDb.db, userId)
  })

  afterEach(() => {
    testDb.close()
  })

  it('flags a release tag that is newer than the one the skill is on', async () => {
    github.tags.set('2.1.2', { sha: TAG_SHA })
    github.tags.set('2.1.3', { sha: NEWER_TAG_SHA })

    const skillId = await seedGithubSkill({
      sourceRef: '2.1.2',
      sourceVersion: TAG_SHA,
    })
    const result = await sweep()
    const state = await readSkillUpdateState(kv, userId)

    expect(result).toMatchObject({
      skillsChecked: 1,
      updatesFound: 1,
      upToDate: 0,
    })
    expect(state[skillId]!.latest).toEqual({
      ref: '2.1.3',
      sha: NEWER_TAG_SHA,
      tag: '2.1.3',
    })
    expect(getSkillUpdateAvailable(state[skillId], {
      sourceRef: '2.1.2',
      sourceVersion: TAG_SHA,
    })).toEqual({ label: '2.1.3', ref: '2.1.3' })
  })

  it('flags nothing when the skill is on the newest release', async () => {
    github.tags.set('2.1.2', { sha: TAG_SHA })

    const skillId = await seedGithubSkill({
      sourceRef: '2.1.2',
      sourceVersion: TAG_SHA,
    })
    const result = await sweep()
    const state = await readSkillUpdateState(kv, userId)

    expect(result).toMatchObject({ updatesFound: 0, upToDate: 1 })
    expect(getSkillUpdateAvailable(state[skillId], {
      sourceRef: '2.1.2',
      sourceVersion: TAG_SHA,
    })).toBeNull()
  })

  it('flags a moved branch head with its short commit', async () => {
    github.setBranch('main', GITHUB_SHA_TWO)

    const skillId = await seedGithubSkill()
    const result = await sweep()
    const state = await readSkillUpdateState(kv, userId)

    expect(result.updatesFound).toBe(1)
    expect(getSkillUpdateAvailable(state[skillId], {
      sourceRef: 'main',
      sourceVersion: GITHUB_SHA_ONE,
    })).toEqual({ label: GITHUB_SHA_TWO.slice(0, 7), ref: 'main' })
  })

  it('does not flag a branch whose head has not moved', async () => {
    await seedGithubSkill()

    expect(await sweep()).toMatchObject({ updatesFound: 0, upToDate: 1 })
  })

  it('flags nothing for a repository that is gone, and clears an older flag', async () => {
    github.setBranch('main', GITHUB_SHA_TWO)

    const skillId = await seedGithubSkill()

    await sweep()
    forgetCachedRefs()
    github.repoStatus = 404

    const result = await sweep({
      now: new Date(NOW.getTime() + SKILL_UPDATE_RECHECK_MS + 1000),
    })
    const state = await readSkillUpdateState(kv, userId)

    expect(result).toMatchObject({ missing: 1, updatesFound: 0, failed: 0 })
    expect(state[skillId]!.latest).toBeUndefined()
  })

  it('flags nothing for a branch that no longer exists', async () => {
    const skillId = await seedGithubSkill({ sourceRef: 'gone-branch' })
    const result = await sweep()

    expect(result.missing).toBe(1)
    expect((await readSkillUpdateState(kv, userId))[skillId]!.latest)
      .toBeUndefined()
  })

  it('changes nothing on a network error and waits before trying again', async () => {
    github.setBranch('main', GITHUB_SHA_TWO)

    const skillId = await seedGithubSkill()

    await sweep()
    forgetCachedRefs()

    const before = (await readSkillUpdateState(kv, userId))[skillId]!
    const failing = vi.fn(async () => {
      throw new TypeError('network down')
    }) as unknown as typeof fetch
    const later = new Date(NOW.getTime() + SKILL_UPDATE_RECHECK_MS + 1000)
    const result = await sweep({ now: later, fetchImpl: failing })
    const after = (await readSkillUpdateState(kv, userId))[skillId]!

    expect(result).toMatchObject({ failed: 1, updatesFound: 0 })
    expect(after.latest).toEqual(before.latest)
    expect(after.checkedAt).toBe(before.checkedAt)
    expect(after.retryAfter).toBeGreaterThan(later.getTime())

    const retried = await sweep({
      now: new Date(later.getTime() + 60_000),
      fetchImpl: failing,
    })

    expect(retried.skillsConsidered).toBe(1)
    expect(retried.failed).toBe(0)
    expect(failing).toHaveBeenCalledTimes(1)
  })

  it('looks at a skill at most once in 24 hours', async () => {
    await seedGithubSkill()
    await sweep()
    forgetCachedRefs()
    github.fetch.mockClear()

    await sweep({ now: new Date(NOW.getTime() + 60 * 60 * 1000) })

    expect(github.fetch).not.toHaveBeenCalled()

    await sweep({ now: new Date(NOW.getTime() + SKILL_UPDATE_RECHECK_MS + 1) })

    expect(github.fetch).toHaveBeenCalledTimes(1)
  })

  it('reads one ref list for the skills of one repository, and downloads no archive', async () => {
    await seedGithubSkill()
    await seedGithubSkill({ sourcePath: 'skills/b' })
    await seedGithubSkill({ sourcePath: 'skills/c' })

    const result = await sweep()

    expect(result.skillsChecked).toBe(3)
    expect(github.urls()).toEqual([
      'https://github.com/o/r.git/info/refs?service=git-upload-pack',
    ])
  })

  it('stops at the per-run cap and leaves the rest for the next run', async () => {
    await seedGithubSkill()
    await seedGithubSkill({ sourcePath: 'skills/b' })
    await seedGithubSkill({ sourcePath: 'skills/c' })

    const first = await sweep({ limit: 2 })
    const second = await sweep({ limit: 2 })

    expect(first.skillsChecked).toBe(2)
    expect(first.skillsConsidered).toBe(3)
    expect(second.skillsChecked).toBe(1)
  })

  it('skips a skill pinned to a commit, a non-GitHub skill and a broken one', async () => {
    await seedGithubSkill({ sourceRef: GITHUB_SHA_ONE })
    await seedSkill(testDb.db, userId, { sourceKind: 'zip' })
    await seedGithubSkill({ status: 'broken' })

    expect(await sweep()).toMatchObject({ skillsConsidered: 0 })
    expect(github.fetch).not.toHaveBeenCalled()
  })

  it('ends the run when GitHub rate limits it, and changes nothing', async () => {
    const other = createGithubMock('p', 'q')

    other.setBranch('main', GITHUB_SHA_ONE)
    await seedGithubSkill()
    await seedGithubSkill({ sourceUrl: 'https://github.com/p/q' })

    const limited = vi.fn(async () => {
      return new Response('', { status: 429 })
    }) as unknown as typeof fetch
    const result = await sweep({ fetchImpl: limited })

    expect(result).toMatchObject({ rateLimited: true, failed: 1 })
    expect(limited).toHaveBeenCalledTimes(1)
  })

  it('stops showing an update once the review records that nothing changed', async () => {
    github.tags.set('2.1.2', { sha: TAG_SHA })
    github.tags.set('2.1.3', { sha: NEWER_TAG_SHA })

    const skillId = await seedGithubSkill({
      sourceRef: '2.1.2',
      sourceVersion: TAG_SHA,
    })
    const skill = { sourceRef: '2.1.2', sourceVersion: TAG_SHA }

    await sweep()
    expect(getSkillUpdateAvailable(
      (await readSkillUpdateState(kv, userId))[skillId],
      skill,
    )).not.toBeNull()

    await markSkillUpdateSeen(kv, {
      userId,
      skillId,
      target: { ref: '2.1.3', sha: NEWER_TAG_SHA, tag: '2.1.3' },
    })
    expect(getSkillUpdateAvailable(
      (await readSkillUpdateState(kv, userId))[skillId],
      skill,
    )).toBeNull()

    forgetCachedRefs()
    github.tags.set('2.1.4', { sha: '6'.repeat(40) })
    await sweep({ now: new Date(NOW.getTime() + SKILL_UPDATE_RECHECK_MS + 1) })

    expect(getSkillUpdateAvailable(
      (await readSkillUpdateState(kv, userId))[skillId],
      skill,
    )).toEqual({ label: '2.1.4', ref: '2.1.4' })
  })

  describe('feature gate', () => {
    async function seedOtherUserSkill(
      grant: 'allow' | 'deny' | null,
      values: Partial<typeof schema.skills.$inferInsert> = {},
    ) {
      const otherUserId = await seedUser(testDb.db, null)

      if (grant) {
        await grantFeature(testDb.db, otherUserId, 'skills', grant)
      }

      await seedSkill(testDb.db, otherUserId, {
        sourceKind: 'github',
        sourceUrl: 'https://github.com/o/r',
        sourceRef: 'main',
        sourcePath: 'skills/other',
        sourceVersion: GITHUB_SHA_ONE,
        ...values,
      })

      return otherUserId
    }

    it('skips an account that does not have the skills feature', async () => {
      const ungrantedUserId = await seedOtherUserSkill(null)

      await seedGithubSkill()

      const result = await sweep()

      expect(result).toMatchObject({
        skillsConsidered: 1,
        skillsChecked: 1,
        usersSkipped: 1,
        killSwitched: false,
      })
      expect(await readSkillUpdateState(kv, ungrantedUserId)).toEqual({})
    })

    it('skips an account with a deny grant', async () => {
      const deniedUserId = await seedOtherUserSkill('deny')

      await seedGithubSkill()

      const result = await sweep()

      expect(result).toMatchObject({ skillsChecked: 1, usersSkipped: 1 })
      expect(await readSkillUpdateState(kv, deniedUserId)).toEqual({})
    })

    it('makes no GitHub request when nobody has the feature', async () => {
      await seedOtherUserSkill(null)
      testDb.sqlite.prepare('delete from feature_grants').run()
      await seedGithubSkill()

      const result = await sweep()

      expect(result).toMatchObject({
        skillsChecked: 0,
        skillsConsidered: 0,
        usersSkipped: 2,
      })
      expect(github.fetch).not.toHaveBeenCalled()
    })

    it('evaluates an account once however many skills it has', async () => {
      await seedGithubSkill()
      await seedGithubSkill({ sourcePath: 'skills/b' })
      await seedGithubSkill({ sourcePath: 'skills/c' })

      const batchSpy = vi.spyOn(testDb.db, 'batch')
      const result = await sweep()

      expect(result.skillsChecked).toBe(3)
      expect(batchSpy).toHaveBeenCalledTimes(1)
    })

    it('stops on a kill switch before reading anything or calling GitHub', async () => {
      await seedGithubSkill()

      const selectSpy = vi.spyOn(testDb.db, 'select')
      const result = await sweep({
        featureConfig: {
          ...SKILLS_FEATURE_CONFIG,
          featuresDisabled: 'skills',
        },
      })

      expect(result).toMatchObject({
        killSwitched: true,
        skillsChecked: 0,
        skillsConsidered: 0,
      })
      expect(github.fetch).not.toHaveBeenCalled()
      expect(selectSpy).not.toHaveBeenCalled()
      expect(kv.get).not.toHaveBeenCalled()
      expect(await readSkillUpdateState(kv, userId)).toEqual({})
    })

    it('stops on the wildcard kill switch', async () => {
      await seedGithubSkill()

      const result = await sweep({
        featureConfig: { ...SKILLS_FEATURE_CONFIG, featuresDisabled: '*' },
      })

      expect(result.killSwitched).toBe(true)
      expect(github.fetch).not.toHaveBeenCalled()
    })

    it('ignores a kill switch on another flag', async () => {
      await seedGithubSkill()

      const result = await sweep({
        featureConfig: {
          ...SKILLS_FEATURE_CONFIG,
          featuresDisabled: 'artifacts',
        },
      })

      expect(result).toMatchObject({ killSwitched: false, skillsChecked: 1 })
    })

    it('stops when the host mode turns features off', async () => {
      await seedGithubSkill()

      const result = await sweep({
        featureConfig: { ...SKILLS_FEATURE_CONFIG, featuresHostMode: 'off' },
      })

      expect(result).toMatchObject({ skillsChecked: 0, usersSkipped: 1 })
      expect(github.fetch).not.toHaveBeenCalled()
    })
  })

  it('changes no skill row', async () => {
    github.setBranch('main', GITHUB_SHA_TWO)

    const skillId = await seedGithubSkill()
    const [before] = await testDb.db.select().from(schema.skills)
      .where(eq(schema.skills.id, skillId))

    await sweep()

    const [after] = await testDb.db.select().from(schema.skills)
      .where(eq(schema.skills.id, skillId))

    expect(after).toEqual(before)
  })
})
