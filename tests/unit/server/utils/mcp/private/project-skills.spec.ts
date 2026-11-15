import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedProject,
  seedUser,
} from '../../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  createFakeSkillKv,
  seedSkillWithFiles,
} from '../../../../../setup/helpers/skills-db'
import type { FakeSkillBucket } from '../../../../../setup/helpers/skills-db'

const mocks = vi.hoisted(() => ({
  available: true,
  writeLimit: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

vi.mock('~~/server/utils/mcp/private/skills', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private/skills')
  >()

  return {
    ...original,
    assertMcpSkillsAvailable: vi.fn(async () => {
      if (!mocks.available) {
        throw Object.assign(new Error('unavailable'), {
          status: 404,
          why: 'feature_unavailable',
        })
      }
    }),
    enforceMcpSkillWriteLimit: mocks.writeLimit,
  }
})

const schema = await import('~~/server/db/schema')
const { readMcpProjectSkills, setMcpProjectSkills } = await import(
  '~~/server/utils/mcp/private/project-skills'
)

const logger = { set: vi.fn() }

describe('MCP project skills', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number
  let projectId: string
  let skillId: string

  function context() {
    return {
      db: testDb.db,
      kv: createFakeSkillKv(),
      bucket,
      userId,
      clientId: 'client-1',
      logger,
      siteUrl: 'https://besidka.com',
    } as never
  }

  beforeEach(async () => {
    mocks.available = true
    mocks.writeLimit.mockClear()
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db)
    projectId = await seedProject(testDb.db, userId)
    skillId = (await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: {
        'SKILL.md': '---\nname: review-pr\ndescription: Review\n---\nBody\n',
      },
      skill: { name: 'review-pr', enabled: false },
    })).skillId
  })

  afterEach(() => {
    testDb.close()
  })

  it('pins an Off skill without enabling it and counts the write', async () => {
    const result = await setMcpProjectSkills(context(), {
      projectId,
      skills: [{ skillId, level: 'always' }],
    })
    const [row] = await testDb.db.select({ enabled: schema.skills.enabled })
      .from(schema.skills)

    expect(result.skills).toEqual([
      { skillId, name: 'review-pr', level: 'always', state: 'off' },
    ])
    expect(row!.enabled).toBe(false)
    expect(mocks.writeLimit).toHaveBeenCalledTimes(1)
  })

  it('does not count a refused call against the hourly limit', async () => {
    await expect(setMcpProjectSkills(context(), {
      projectId,
      skills: [{ skillId: 'skl99999', level: 'prefer' }],
    })).rejects.toMatchObject({ status: 404 })
    expect(mocks.writeLimit).not.toHaveBeenCalled()
  })

  it('is unavailable when the skills flag is off', async () => {
    mocks.available = false

    await expect(setMcpProjectSkills(context(), {
      projectId,
      skills: [],
    })).rejects.toMatchObject({ status: 404 })
    expect(await testDb.db.select().from(schema.projectSkills)).toEqual([])
  })

  it('reads the pins only with skills:read and the flag on', async () => {
    await setMcpProjectSkills(context(), {
      projectId,
      skills: [{ skillId, level: 'prefer' }],
    })

    expect(await readMcpProjectSkills(context(), ['projects:read'], projectId))
      .toBeNull()
    expect(await readMcpProjectSkills(
      context(),
      ['projects:read', 'skills:read'],
      projectId,
    )).toEqual([
      { skillId, name: 'review-pr', level: 'prefer', state: 'off' },
    ])

    mocks.available = false

    expect(await readMcpProjectSkills(
      context(),
      ['skills:read'],
      projectId,
    )).toBeNull()
  })
})
