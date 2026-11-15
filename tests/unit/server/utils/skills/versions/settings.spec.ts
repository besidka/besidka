import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../../setup/helpers/memory-extraction-db'
import { seedSkill } from '../../../../../setup/helpers/skills-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const { updateSkillSettings } = await import(
  '~~/server/utils/skills/versions/settings'
)

const logger = { set: vi.fn() }

describe('updateSkillSettings and the needs-review status', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  function change(
    skillId: string,
    mode: 'off' | 'auto' | 'ask',
    licenseAcknowledged?: boolean,
  ) {
    return updateSkillSettings({
      db: testDb.db,
      userId,
      skillId,
      changes: { mode },
      licenseAcknowledged,
      logger,
    })
  }

  async function skillRow(skillId: string) {
    const [row] = await testDb.db.select()
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId))

    return row!
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db)
  })

  afterEach(() => {
    testDb.close()
  })

  it('turns a needs-review skill ready when the user switches it on',
    async () => {
      const skillId = await seedSkill(testDb.db, userId, {
        status: 'needs-review',
        enabled: false,
        createdVia: 'mcp',
      })

      await change(skillId, 'auto')

      expect(await skillRow(skillId)).toMatchObject({
        enabled: true,
        status: 'ready',
      })
    })

  it.each(['none', 'custom'] as const)(
    'needs the license tick to switch on a needs-review skill with a %s '
    + 'license',
    async (licenseClass) => {
      const skillId = await seedSkill(testDb.db, userId, {
        status: 'needs-review',
        enabled: false,
        licenseClass,
        createdVia: 'mcp',
      })

      await expect(change(skillId, 'auto')).rejects.toMatchObject({
        status: 400,
        code: 'license-acknowledgement-required',
      })
      await expect(change(skillId, 'auto', false)).rejects.toMatchObject({
        status: 400,
      })

      expect(await skillRow(skillId)).toMatchObject({
        enabled: false,
        status: 'needs-review',
      })

      await change(skillId, 'auto', true)

      expect(await skillRow(skillId)).toMatchObject({
        enabled: true,
        status: 'ready',
      })
    },
  )

  it('needs no tick for an open license, a reviewed skill or switching off',
    async () => {
      const openId = await seedSkill(testDb.db, userId, {
        status: 'needs-review',
        enabled: false,
        licenseClass: 'open',
      })
      const readyId = await seedSkill(testDb.db, userId, {
        status: 'ready',
        enabled: false,
        licenseClass: 'none',
      })
      const offId = await seedSkill(testDb.db, userId, {
        status: 'needs-review',
        enabled: true,
        licenseClass: 'none',
      })

      await change(openId, 'ask')
      await change(readyId, 'ask')
      await change(offId, 'off')

      expect((await skillRow(openId)).enabled).toBe(true)
      expect((await skillRow(readyId)).enabled).toBe(true)
      expect((await skillRow(offId)).enabled).toBe(false)
    })

  it('keeps needs-review while an update is pending or the mode is off',
    async () => {
      const pendingId = await seedSkill(testDb.db, userId, {
        status: 'needs-review',
        enabled: false,
        pendingVersion: 2,
      })
      const offId = await seedSkill(testDb.db, userId, {
        status: 'needs-review',
        enabled: false,
      })

      await change(pendingId, 'ask')
      await change(offId, 'off')

      expect((await skillRow(pendingId)).status).toBe('needs-review')
      expect((await skillRow(offId)).status).toBe('needs-review')
    })

  it('leaves a ready skill ready', async () => {
    const skillId = await seedSkill(testDb.db, userId, { enabled: false })

    await change(skillId, 'ask')

    expect(await skillRow(skillId)).toMatchObject({
      enabled: true,
      status: 'ready',
    })
  })
})
