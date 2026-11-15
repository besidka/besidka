import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  createFakeSkillKv,
  putFakeBlob,
  seedSkill,
  shaOf,
} from '../../setup/helpers/skills-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const SCHEDULED_TIME = Date.UTC(2026, 10, 13, 12, 0, 0)
const HOURLY_CRON = '0 * * * *'

function createLoggerDouble() {
  const set = vi.fn()
  const emit = vi.fn().mockReturnValue(undefined)
  const createLogger = vi.fn().mockReturnValue({ set, emit })

  return { set, emit, createLogger }
}

async function importSweep() {
  return import('../../../server/plugins/skills-storage-sweep')
}

describe('skills storage sweep plugin', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let skillId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    skillId = await seedSkill(testDb.db, userId)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('logs the sweep counts and emits 200', async () => {
    const bucket = createFakeSkillBucket()
    const kv = createFakeSkillKv()

    putFakeBlob(bucket, userId, skillId, shaOf('orphan'), new Date(0))

    const { set, emit, createLogger } = createLoggerDouble()
    const { runSkillsStorageSweepJob } = await importSweep()

    await runSkillsStorageSweepJob({
      controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: testDb.db,
      bucket,
      kv,
    })

    expect(createLogger).toHaveBeenCalledWith({
      method: 'CRON',
      path: '/internal/jobs/skills-storage-sweep',
      requestId: `skills-storage-sweep-${SCHEDULED_TIME}`,
    })
    expect(set).toHaveBeenCalledWith({
      attributes: {
        skillsStorageSweep: {
          cron: HOURLY_CRON,
          stagingObjectsDeleted: 0,
          orphanBlobsDeleted: 1,
          blobObjectsScanned: 1,
          unrecognisedObjects: 0,
        },
      },
    })
    expect(emit).toHaveBeenCalledWith({ status: 200 })
    expect(bucket.objects.size).toBe(0)
  })

  it('emits 500 and logs the error when the bucket fails', async () => {
    const bucket = createFakeSkillBucket()

    bucket.list.mockRejectedValue(new Error('r2 down'))

    const { set, emit, createLogger } = createLoggerDouble()
    const { runSkillsStorageSweepJob } = await importSweep()

    await runSkillsStorageSweepJob({
      controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: testDb.db,
      bucket,
      kv: createFakeSkillKv(),
    })

    expect(set).toHaveBeenCalledWith({
      attributes: { skillsStorageSweep: { error: 'r2 down' } },
    })
    expect(emit).toHaveBeenCalledWith({ status: 500 })
  })

  it('registers a handler that ignores other crons', async () => {
    const hooks: Array<(payload: unknown) => Promise<void>> = []
    const plugin = (await importSweep()).default as unknown as (
      nitroApp: unknown,
    ) => void

    plugin({
      hooks: {
        hook: (_name: string, handler: (payload: unknown) => Promise<void>) => {
          hooks.push(handler)
        },
      },
    })

    expect(hooks).toHaveLength(1)
    await expect(hooks[0]!({
      controller: { cron: '*/5 * * * *', scheduledTime: SCHEDULED_TIME },
    })).resolves.toBeUndefined()
  })
})
