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
import {
  createFakeSkillBucket,
  createFakeSkillKv,
} from '../../../../../setup/helpers/skills-db'
import type {
  FakeSkillBucket,
  FakeSkillKv,
} from '../../../../../setup/helpers/skills-db'
import {
  createSkillsRouteEvent,
  createUploadEvent,
  stubSkillsRouteGlobals,
} from '../../../../../setup/helpers/skills-route'
import {
  skillMarkdown,
  validSkillArchive,
} from '../../../../../setup/helpers/skill-archives'

const mocks = vi.hoisted(() => ({
  featureOn: true,
  logger: { set: vi.fn() },
}))

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

async function importHandler(path: string) {
  const { default: handler } = await import(path)

  return handler as (input: unknown) => Promise<any>
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string }
  }

  throw new Error('Expected a rejection')
}

describe('POST /api/v1/skills/[id]/update/{accept,reject}', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeSkillKv
  let bucket: FakeSkillBucket
  let userId: number
  let skillId: string
  let pendingSha256: string

  async function call(
    action: 'accept' | 'reject',
    body: unknown,
    id: string = skillId,
  ) {
    const handler = await importHandler(
      `~~/server/api/v1/skills/[id]/update/${action}.post`,
    )

    return await handler(createSkillsRouteEvent({ params: { id }, body }))
  }

  async function importSkill(markdown?: string) {
    const previewHandler = await importHandler(
      '~~/server/api/v1/skills/import/preview.post',
    )
    const commitHandler = await importHandler(
      '~~/server/api/v1/skills/import/commit.post',
    )
    const staged = await previewHandler(
      createUploadEvent(validSkillArchive({}, markdown)),
    )
    const created = await commitHandler(createSkillsRouteEvent({
      body: {
        stageId: staged.stageId,
        acknowledged: true,
        licenceAcknowledged: true,
        ...(markdown ? { asUpdateOf: skillId } : {}),
      },
    }))

    return { staged, created }
  }

  beforeEach(async () => {
    mocks.featureOn = true
    testDb = createMemoryExtractionTestDb()
    kv = createFakeSkillKv()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db, null)
    stubSkillsRouteGlobals({ userId, db: testDb.db, kv, bucket })

    skillId = (await importSkill()).created.id

    const update = await importSkill(skillMarkdown({
      description: 'Updated description',
    }))

    pendingSha256 = update.created.sha256
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it.each(['accept', 'reject'] as const)(
    '%s answers 404 when the skills flag is off',
    async (action) => {
      mocks.featureOn = false

      expect((await failureOf(
        call(action, { version: 2, sha256: pendingSha256 }),
      )).status).toBe(404)
    },
  )

  it.each(['accept', 'reject'] as const)(
    '%s answers 401 without a session and 400 for a bad body',
    async (action) => {
      expect(await failureOf(call(action, { version: 2 })))
        .toMatchObject({ status: 400, code: 'invalid-request' })
      expect((await failureOf(
        call(action, { version: 0, sha256: pendingSha256 }),
      )).status).toBe(400)

      stubSkillsRouteGlobals({ userId: 0, db: testDb.db, kv, bucket })

      expect((await failureOf(
        call(action, { version: 2, sha256: pendingSha256 }),
      )).status).toBe(401)
    },
  )

  it('asks for licenceAcknowledged when the update moves an open skill to none', async () => {
    await testDb.db.update(schema.skills)
      .set({ licenseClass: 'open' })
      .where(eq(schema.skills.id, skillId))

    expect(await failureOf(
      call('accept', { version: 2, sha256: pendingSha256 }),
    )).toMatchObject({
      status: 400,
      code: 'licence-acknowledgement-required',
    })
    expect((await testDb.db.select().from(schema.skills))[0]!.pendingVersion)
      .toBe(2)

    const result = await call('accept', {
      version: 2,
      sha256: pendingSha256,
      licenceAcknowledged: true,
    })

    expect(result).toMatchObject({ id: skillId, version: 3 })
  })

  it('accepts the reviewed version and disables the skill', async () => {
    await testDb.db.update(schema.skills)
      .set({ enabled: true })
      .where(eq(schema.skills.id, skillId))

    const result = await call('accept', { version: 2, sha256: pendingSha256 })
    const [skill] = await testDb.db.select().from(schema.skills)

    expect(result).toEqual({ id: skillId, version: 3, enabled: false })
    expect(skill).toMatchObject({
      currentVersion: 3,
      pendingVersion: null,
      enabled: false,
      description: 'Updated description',
    })
  })

  it('answers 409 "changed while you were reviewing it" for a stale body', async () => {
    const failure = await failureOf(
      call('accept', { version: 2, sha256: 'a'.repeat(64) }),
    )

    expect(failure).toMatchObject({ status: 409, code: 'pending-changed' })
    expect((await failureOf(
      call('reject', { version: 7, sha256: pendingSha256 }),
    )).status).toBe(409)
  })

  it('rejects the pending version and keeps the current one', async () => {
    const result = await call('reject', { version: 2, sha256: pendingSha256 })
    const [skill] = await testDb.db.select().from(schema.skills)

    expect(result).toEqual({ id: skillId, rejected: true })
    expect(skill).toMatchObject({ currentVersion: 1, pendingVersion: null })
    expect(await testDb.db.select().from(schema.skillVersions)).toHaveLength(1)
  })

  it('answers 404 for an unknown skill id', async () => {
    expect((await failureOf(
      call('accept', { version: 2, sha256: pendingSha256 }, 'nope!'),
    )).status).toBe(404)
  })
})
