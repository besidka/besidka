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
import {
  createSkillsRouteEvent,
  stubSkillsRouteGlobals,
} from '../../../../../setup/helpers/skills-route'
import type { SkillsRouteEvent } from '../../../../../setup/helpers/skills-route'

const mocks = vi.hoisted(() => ({
  featureOn: true,
  env: {} as Record<string, unknown>,
  logger: { set: vi.fn() },
}))

vi.mock('cloudflare:workers', () => ({ env: mocks.env }))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

vi.mock('nuxt/server', async () => {
  const { skillsNuxtServerMockFactory } = await import(
    '../../../../../setup/helpers/skills-route'
  )

  return await skillsNuxtServerMockFactory()
})

vi.mock('~~/server/utils/features/guards', () => ({
  requireFeature: async (_event: unknown, flag: string) => {
    if (!mocks.featureOn || flag !== 'skills') {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }

    return { active: true }
  },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

const ROUTES = {
  get: '~~/server/api/v1/projects/[id]/skills/index.get',
  put: '~~/server/api/v1/projects/[id]/skills/index.put',
} as const

type RouteName = keyof typeof ROUTES

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number }
  }

  throw new Error('Expected a rejection')
}

describe('project skills routes', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number
  let projectId: string
  let skillId: string

  async function call(
    name: RouteName,
    partial: Partial<SkillsRouteEvent> = {},
  ) {
    const { default: handler } = await import(ROUTES[name])

    return await (handler as (input: unknown) => Promise<any>)(
      createSkillsRouteEvent({ params: { id: projectId }, ...partial }),
    )
  }

  beforeEach(async () => {
    mocks.featureOn = true
    mocks.logger.set.mockClear()
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db, null)
    projectId = await seedProject(testDb.db, userId)
    stubSkillsRouteGlobals({
      userId,
      db: testDb.db,
      kv: createFakeSkillKv(),
      bucket,
    })
    skillId = (await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: {
        'SKILL.md': '---\nname: review-pr\ndescription: Review\n---\nBody\n',
      },
      skill: { name: 'review-pr', enabled: true },
    })).skillId
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe.each([
    ['get', {}],
    ['put', { body: { skills: [] } }],
  ] as Array<[RouteName, Partial<SkillsRouteEvent>]>)('%s', (name, partial) => {
    it('answers 401 without a session', async () => {
      stubSkillsRouteGlobals({
        userId: 0,
        db: testDb.db,
        kv: createFakeSkillKv(),
        bucket,
      })

      expect((await failureOf(call(name, partial))).status).toBe(401)
    })

    it('answers 404 when the skills flag is off', async () => {
      mocks.featureOn = false

      expect((await failureOf(call(name, partial))).status).toBe(404)
    })

    it('answers 404 for another user\'s project', async () => {
      const otherUserId = await seedUser(testDb.db, null)
      const foreign = await seedProject(testDb.db, otherUserId)

      expect((await failureOf(
        call(name, { ...partial, params: { id: foreign } }),
      )).status).toBe(404)
    })
  })

  it('stores a list and reads it back', async () => {
    const saved = await call('put', {
      body: { skills: [{ skillId, level: 'always' }] },
    })
    const read = await call('get')

    expect(saved.pins).toHaveLength(1)
    expect(read.pins[0]).toMatchObject({
      skillId,
      name: 'review-pr',
      level: 'always',
      state: 'active',
    })
    expect(read.limits).toEqual({ always: 3, total: 20, alwaysTokens: 12000 })
  })

  it('answers 400 for an unknown level or an extra field', async () => {
    expect((await failureOf(call('put', {
      body: { skills: [{ skillId, level: 'sometimes' }] },
    }))).status).toBe(400)
    expect((await failureOf(call('put', {
      body: { skills: [], extra: true },
    }))).status).toBe(400)
  })

  it('answers 404 for a skill that is not the user\'s', async () => {
    const otherUserId = await seedUser(testDb.db, null)
    const { skillId: foreignSkill } = await seedSkillWithFiles(
      testDb.db,
      bucket,
      {
        userId: otherUserId,
        files: { 'SKILL.md': '---\nname: x\ndescription: x\n---\nB\n' },
        skill: { name: 'foreign', enabled: true },
      },
    )

    expect((await failureOf(call('put', {
      body: { skills: [{ skillId: foreignSkill, level: 'prefer' }] },
    }))).status).toBe(404)
  })
})
