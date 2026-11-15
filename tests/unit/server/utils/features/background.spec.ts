import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBackgroundFeatureCheck } from '~~/server/utils/features/background'
import type { FeatureEvaluationConfig } from '~~/server/utils/features/provider'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import {
  SKILLS_FEATURE_CONFIG,
  createFakeSkillKv,
  grantFeature,
} from '../../../../setup/helpers/skills-db'
import type { FakeSkillKv } from '../../../../setup/helpers/skills-db'

describe('createBackgroundFeatureCheck', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeSkillKv
  let userId: number

  function createCheck(
    config: FeatureEvaluationConfig = SKILLS_FEATURE_CONFIG,
  ) {
    return createBackgroundFeatureCheck({
      flag: 'skills',
      db: testDb.db,
      kv,
      config,
    })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    kv = createFakeSkillKv()
    userId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
  })

  it('is inactive for an account without a grant or a role', async () => {
    expect(await createCheck().isActiveForUser(userId)).toBe(false)
  })

  it('is active for an account with an allow grant', async () => {
    await grantFeature(testDb.db, userId)

    expect(await createCheck().isActiveForUser(userId)).toBe(true)
  })

  it('is inactive for a deny grant', async () => {
    await grantFeature(testDb.db, userId, 'skills', 'deny')

    expect(await createCheck().isActiveForUser(userId)).toBe(false)
  })

  it('is active for an admin role', async () => {
    testDb.sqlite.prepare(
      'insert into user_roles (user_id, role, created_at) values (?, ?, 1)',
    ).run(userId, 'admin')
    testDb.sqlite
      .prepare('update users set email_verified = 1 where id = ?')
      .run(userId)

    expect(await createCheck().isActiveForUser(userId)).toBe(true)
  })

  it('is inactive for a user that does not exist', async () => {
    expect(await createCheck().isActiveForUser(987_654)).toBe(false)
  })

  it('reports a kill switch before evaluating anyone', () => {
    const check = createCheck({
      ...SKILLS_FEATURE_CONFIG,
      featuresDisabled: 'Skills',
    })

    expect(check.isKillSwitched).toBe(true)
    expect(kv.get).not.toHaveBeenCalled()
  })

  it('reports the wildcard kill switch and ignores one on another flag', () => {
    expect(createCheck({
      ...SKILLS_FEATURE_CONFIG,
      featuresDisabled: '*',
    }).isKillSwitched).toBe(true)
    expect(createCheck({
      ...SKILLS_FEATURE_CONFIG,
      featuresDisabled: 'artifacts',
    }).isKillSwitched).toBe(false)
  })

  it('turns the flag off for everyone while a kill switch is on', async () => {
    await grantFeature(testDb.db, userId)

    const check = createCheck({
      ...SKILLS_FEATURE_CONFIG,
      featuresDisabled: 'skills',
    })

    expect(await check.isActiveForUser(userId)).toBe(false)
  })

  it('evaluates an account once and loads the rules once', async () => {
    const otherUserId = await seedUser(testDb.db, null)

    await grantFeature(testDb.db, userId)

    const batchSpy = vi.spyOn(testDb.db, 'batch')
    const check = createCheck()

    expect(await check.isActiveForUser(userId)).toBe(true)
    expect(await check.isActiveForUser(userId)).toBe(true)
    expect(await check.isActiveForUser(otherUserId)).toBe(false)
    expect(batchSpy).toHaveBeenCalledTimes(2)
    expect(kv.get).toHaveBeenCalledTimes(1)
  })

  it('evaluates nobody until asked', () => {
    const batchSpy = vi.spyOn(testDb.db, 'batch')

    createCheck()

    expect(batchSpy).not.toHaveBeenCalled()
    expect(kv.get).not.toHaveBeenCalled()
  })
})
