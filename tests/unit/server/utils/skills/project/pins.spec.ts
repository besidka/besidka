import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROJECT_SKILLS_ALWAYS_MAX,
  PROJECT_SKILLS_ALWAYS_MAX_TOKENS,
  PROJECT_SKILLS_MAX,
} from '#shared/utils/skills-policy'
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
  seedSkill,
  seedSkillWithFiles,
} from '../../../../../setup/helpers/skills-db'
import type { FakeSkillBucket } from '../../../../../setup/helpers/skills-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const schema = await import('~~/server/db/schema')
const {
  deleteProjectSkillsForProject,
  listProjectSkills,
  setProjectSkills,
} = await import('~~/server/utils/skills/project/pins')

const logger = { set: vi.fn() }

function skillMd(name: string, body: string) {
  return `---\nname: ${name}\ndescription: About ${name}\n---\n${body}\n`
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, message: string, why?: string }
  }

  throw new Error('Expected a rejection')
}

describe('project skill pins', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number
  let otherUserId: number
  let projectId: string

  async function seedRunnable(
    owner: number,
    name: string,
    body = 'BODY',
    skill: Record<string, unknown> = {},
  ) {
    return (await seedSkillWithFiles(testDb.db, bucket, {
      userId: owner,
      files: { 'SKILL.md': skillMd(name, body) },
      skill: { name, enabled: true, modelInvocable: false, ...skill },
    })).skillId
  }

  function set(
    entries: Array<{ skillId: string, level: 'always' | 'prefer' }>,
    overrides: { owner?: number, project?: string } = {},
  ) {
    return setProjectSkills(
      testDb.db,
      bucket,
      overrides.owner ?? userId,
      overrides.project ?? projectId,
      entries,
      logger,
    )
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db)
    otherUserId = await seedUser(testDb.db)
    projectId = await seedProject(testDb.db, userId)
    logger.set.mockClear()
  })

  afterEach(() => {
    testDb.close()
  })

  it('stores the list in the given order and reads it back', async () => {
    const first = await seedRunnable(userId, 'first-skill')
    const second = await seedRunnable(userId, 'second-skill')
    const view = await set([
      { skillId: second, level: 'prefer' },
      { skillId: first, level: 'always' },
    ])

    expect(view.pins.map(pin => [pin.name, pin.level, pin.position])).toEqual([
      ['second-skill', 'prefer', 0],
      ['first-skill', 'always', 1],
    ])
    expect(view.pins[1]!.state).toBe('active')
    expect(view.pins[1]!.tokens).toBeGreaterThan(0)
    expect(view.pins[0]!.tokens).toBeNull()
    expect(view.alwaysTokens).toBe(view.pins[1]!.tokens)
  })

  it('replaces the previous list and clears it with an empty one', async () => {
    const first = await seedRunnable(userId, 'first-skill')
    const second = await seedRunnable(userId, 'second-skill')

    await set([{ skillId: first, level: 'always' }])
    await set([{ skillId: second, level: 'prefer' }])

    expect((await listProjectSkills(
      testDb.db,
      bucket,
      userId,
      projectId,
      logger,
    )).pins.map(pin => pin.name)).toEqual(['second-skill'])

    const cleared = await set([])

    expect(cleared.pins).toEqual([])
  })

  it('refuses a project the user does not own as not found', async () => {
    const skill = await seedRunnable(userId, 'first-skill')
    const foreignProject = await seedProject(testDb.db, otherUserId)

    expect((await failureOf(
      set([{ skillId: skill, level: 'prefer' }], { project: foreignProject }),
    )).status).toBe(404)
    expect((await failureOf(
      listProjectSkills(testDb.db, bucket, userId, foreignProject, logger),
    )).status).toBe(404)
  })

  it('refuses another user\'s skill and an unknown id the same way', async () => {
    const foreign = await seedRunnable(otherUserId, 'foreign-skill')

    expect((await failureOf(
      set([{ skillId: foreign, level: 'prefer' }]),
    )).status).toBe(404)
    expect((await failureOf(
      set([{ skillId: 'not-an-id!', level: 'prefer' }]),
    )).status).toBe(404)
  })

  it('refuses a duplicate, too many pins and too many always-loaded', async () => {
    const skills: string[] = []

    for (let index = 0; index <= PROJECT_SKILLS_MAX; index++) {
      skills.push(await seedSkill(testDb.db, userId, {
        name: `bulk-${index}`,
        enabled: false,
      }))
    }

    expect((await failureOf(set([
      { skillId: skills[0]!, level: 'prefer' },
      { skillId: skills[0]!, level: 'always' },
    ]))).status).toBe(400)
    expect((await failureOf(set(skills.map((skillId) => {
      return { skillId, level: 'prefer' as const }
    })))).status).toBe(400)

    const tooManyAlways = await failureOf(set(
      skills.slice(0, PROJECT_SKILLS_ALWAYS_MAX + 1).map((skillId) => {
        return { skillId, level: 'always' as const }
      }),
    ))

    expect(tooManyAlways.status).toBe(400)
    expect(tooManyAlways.why).toContain(String(PROJECT_SKILLS_ALWAYS_MAX))
  })

  it('refuses a broken skill and keeps an Off one without enabling it', async () => {
    const broken = await seedSkill(testDb.db, userId, {
      name: 'broken-skill',
      status: 'broken',
    })
    const off = await seedRunnable(userId, 'off-skill', 'BODY', {
      enabled: false,
    })

    expect((await failureOf(
      set([{ skillId: broken, level: 'prefer' }]),
    )).status).toBe(400)

    const view = await set([{ skillId: off, level: 'always' }])
    const [row] = await testDb.db.select({ enabled: schema.skills.enabled })
      .from(schema.skills)

    expect(view.pins[0]!.state).toBe('off')
    expect(view.pins[0]!.tokens).toBeNull()
    expect(row!.enabled).toBe(false)
  })

  it('reports needs-review skills as not loading', async () => {
    const pending = await seedRunnable(userId, 'pending-skill', 'BODY', {
      status: 'needs-review',
    })
    const view = await set([{ skillId: pending, level: 'prefer' }])

    expect(view.pins[0]!.state).toBe('needs-review')
  })

  it('refuses always-loaded skills over the project token cap', async () => {
    const huge = 'word '.repeat(
      Math.ceil((PROJECT_SKILLS_ALWAYS_MAX_TOKENS * 3.2) / 5),
    )
    const first = await seedRunnable(userId, 'huge-one', huge)
    const second = await seedRunnable(userId, 'huge-two', huge)

    expect((await set([{ skillId: first, level: 'always' }])).pins).toHaveLength(1)

    const failure = await failureOf(set([
      { skillId: first, level: 'always' },
      { skillId: second, level: 'always' },
    ]))

    expect(failure.status).toBe(400)
    expect(failure.why).toContain('tokens')
    expect((await set([
      { skillId: first, level: 'always' },
      { skillId: second, level: 'prefer' },
    ])).pins).toHaveLength(2)
  })

  it('deletes the pins of a project and no other', async () => {
    const skill = await seedRunnable(userId, 'first-skill')
    const otherProject = await seedProject(testDb.db, userId)

    await set([{ skillId: skill, level: 'always' }])
    await set([{ skillId: skill, level: 'prefer' }], { project: otherProject })

    expect(await deleteProjectSkillsForProject(
      testDb.db,
      userId,
      projectId,
    )).toBe(1)
    expect((await testDb.db.select().from(schema.projectSkills))
      .map(row => row.projectId)).toEqual([otherProject])
  })
})
