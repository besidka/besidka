import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import { seedSkill } from '../../../../setup/helpers/skills-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const { readSkillLookalikeContext } = await import(
  '~~/server/utils/skills/lookalike-context'
)

describe('readSkillLookalikeContext', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let otherUserId: number
  let firstSkillId: string

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
    firstSkillId = await seedSkill(testDb.db, userId, { name: 'first-skill' })
    await seedSkill(testDb.db, userId, { name: 'second-skill' })
    await seedSkill(testDb.db, otherUserId, { name: 'someone-elses-skill' })
  })

  afterEach(() => {
    testDb.close()
  })

  it('lists the account skill names and no other account names', async () => {
    const context = await readSkillLookalikeContext({
      db: testDb.db,
      userId,
      sourceUrl: null,
    })

    expect(context.otherSkillNames.sort()).toEqual([
      'first-skill',
      'second-skill',
    ])
    expect(context.source).toBeNull()
  })

  it('leaves the checked skill out of its own list', async () => {
    const context = await readSkillLookalikeContext({
      db: testDb.db,
      userId,
      sourceUrl: null,
      excludeSkillId: firstSkillId,
    })

    expect(context.otherSkillNames).toEqual(['second-skill'])
  })

  it('reads owner and repository from a GitHub source link', async () => {
    const context = await readSkillLookalikeContext({
      db: testDb.db,
      userId,
      sourceUrl: 'https://github.com/anthropic/skills',
    })

    expect(context.source).toBe('anthropic/skills')
  })

  it('gives no source for a link that is not a GitHub skill link', async () => {
    const context = await readSkillLookalikeContext({
      db: testDb.db,
      userId,
      sourceUrl: 'https://example.com/a/b',
    })

    expect(context.source).toBeNull()
  })
})
