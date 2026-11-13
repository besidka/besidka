import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    return exception as {
      status: number
      code?: string
      data?: Record<string, unknown>
    }
  }

  throw new Error('Expected a rejection')
}

describe('POST /api/v1/skills/import/commit', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeSkillKv
  let bucket: FakeSkillBucket
  let userId: number

  async function preview(
    bytes: Uint8Array = validSkillArchive(),
  ) {
    const handler = await importHandler(
      '~~/server/api/v1/skills/import/preview.post',
    )

    return await handler(createUploadEvent(bytes))
  }

  async function commit(body: unknown) {
    const handler = await importHandler(
      '~~/server/api/v1/skills/import/commit.post',
    )
    const event = createSkillsRouteEvent({ body })
    const result = await handler(event)

    return { result, status: event.status }
  }

  beforeEach(async () => {
    mocks.featureOn = true
    testDb = createMemoryExtractionTestDb()
    kv = createFakeSkillKv()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db, null)
    stubSkillsRouteGlobals({ userId, db: testDb.db, kv, bucket })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('answers 404 when the skills flag is off', async () => {
    const staged = await preview()

    mocks.featureOn = false

    expect((await failureOf(commit({
      stageId: staged.stageId,
      acknowledged: true,
      licenceAcknowledged: true,
    }))).status).toBe(404)
    expect(await testDb.db.select().from(schema.skills)).toHaveLength(0)
  })

  it('answers 401 without a session', async () => {
    stubSkillsRouteGlobals({ userId: 0, db: testDb.db, kv, bucket })

    expect((await failureOf(commit({
      stageId: 'a'.repeat(32),
      acknowledged: true,
    }))).status).toBe(401)
  })

  it('creates a disabled skill with 201 after the preview', async () => {
    const staged = await preview()
    const { result, status } = await commit({
      stageId: staged.stageId,
      acknowledged: true,
      licenceAcknowledged: true,
    })

    expect(status).toBe(201)
    expect(result).toMatchObject({
      kind: 'created',
      name: 'review-pr',
      version: 1,
      enabled: false,
      status: 'ready',
    })
  })

  it('rejects a body without acknowledged: true or with a bad stage id', async () => {
    const staged = await preview()

    expect(await failureOf(commit({ stageId: staged.stageId })))
      .toMatchObject({ status: 400, code: 'invalid-request' })
    expect((await failureOf(commit({
      stageId: staged.stageId,
      acknowledged: false,
    }))).status).toBe(400)
    expect((await failureOf(commit({
      stageId: '../../x',
      acknowledged: true,
    }))).status).toBe(400)
  })

  it('requires the licence tick for a skill with no licence', async () => {
    const staged = await preview()

    expect(await failureOf(commit({
      stageId: staged.stageId,
      acknowledged: true,
    }))).toMatchObject({
      status: 400,
      code: 'licence-acknowledgement-required',
    })
  })

  it('answers 409 on a collision and resolves both ways', async () => {
    const first = await preview()

    await commit({
      stageId: first.stageId,
      acknowledged: true,
      licenceAcknowledged: true,
    })

    const second = await preview(validSkillArchive({}, skillMarkdown({
      description: 'A second version',
    })))
    const collision = await failureOf(commit({
      stageId: second.stageId,
      acknowledged: true,
      licenceAcknowledged: true,
    }))

    expect(collision).toMatchObject({
      status: 409,
      code: 'name-taken',
      data: { stageId: second.stageId },
    })

    const asUpdate = await commit({
      stageId: second.stageId,
      acknowledged: true,
      licenceAcknowledged: true,
      asUpdateOf: collision.data!.asUpdateOf,
    })

    expect(asUpdate.status).toBe(200)
    expect(asUpdate.result).toMatchObject({ kind: 'pending', version: 2 })

    const third = await preview(validSkillArchive({}, skillMarkdown({
      description: 'A third one',
    })))
    const renamed = await commit({
      stageId: third.stageId,
      acknowledged: true,
      licenceAcknowledged: true,
      name: 'review-pr-copy',
    })

    expect(renamed.status).toBe(201)
    expect(renamed.result).toMatchObject({ name: 'review-pr-copy' })
  })
})
