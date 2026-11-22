import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { createMemoryBlobStore } from '../../setup/helpers/artifacts-store'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const SCHEDULED_TIME = Date.UTC(2026, 10, 9, 12, 0, 0)
const HOURLY_CRON = '0 * * * *'
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

function createLoggerDouble(wideEvent: unknown = undefined) {
  const set = vi.fn()
  const emit = vi.fn().mockReturnValue(wideEvent)
  const createLogger = vi.fn().mockReturnValue({ set, emit })

  return { set, emit, createLogger }
}

async function importSweep() {
  return import('../../../server/plugins/artifact-storage-sweep')
}

describe('artifact storage sweep plugin', () => {
  let testDb: MemoryExtractionTestDb
  let viewerId: number

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    testDb = createMemoryExtractionTestDb()
    viewerId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  async function seedOrphanedRow(key: string) {
    await testDb.db.insert(schema.artifactStorage).values({
      artifactId: 4242,
      viewerUserId: viewerId,
      key,
      value: { score: 1 },
      bytes: 11,
    })
  }

  it('logs the deleted count and emits 200', async () => {
    await seedOrphanedRow('first')
    await seedOrphanedRow('second')

    const { set, emit, createLogger } = createLoggerDouble()
    const { runArtifactStorageSweepJob } = await importSweep()

    await runArtifactStorageSweepJob({
      controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: testDb.db,
    })

    expect(createLogger).toHaveBeenCalledWith({
      method: 'CRON',
      path: '/internal/jobs/artifact-storage-sweep',
      requestId: `artifact-storage-sweep-${SCHEDULED_TIME}`,
    })
    expect(set).toHaveBeenCalledWith({
      attributes: {
        artifactStorageSweep: { cron: HOURLY_CRON, deleted: 2 },
      },
    })
    expect(emit).toHaveBeenCalledWith({ status: 200 })
    await expect(testDb.db.select().from(schema.artifactStorage))
      .resolves.toEqual([])
  })

  it('logs zero on an empty table', async () => {
    const { set, emit, createLogger } = createLoggerDouble()
    const { runArtifactStorageSweepJob } = await importSweep()

    await runArtifactStorageSweepJob({
      controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: testDb.db,
    })

    expect(set).toHaveBeenCalledWith({
      attributes: {
        artifactStorageSweep: { cron: HOURLY_CRON, deleted: 0 },
      },
    })
    expect(emit).toHaveBeenCalledWith({ status: 200 })
  })

  it('sweeps with the scheduled time as now', async () => {
    const { createArtifact, decodeArtifactId } = await import(
      '~~/server/utils/artifacts/store'
    )
    const ownerId = await seedUser(testDb.db, null)
    const created = await createArtifact({
      db: testDb.db,
      storage: createMemoryBlobStore(),
      userId: ownerId,
      kind: 'html',
      title: 'Quiz',
      content: '<p>Question 1</p>',
      createdVia: 'chat',
      createdBy: 'model',
    })
    const artifactId = decodeArtifactId(created.artifactId) as number
    const pastScheduledTime = Date.UTC(2024, 0, 15, 12, 0, 0)

    await testDb.db.insert(schema.artifactShares).values({
      artifactId,
      userId: ownerId,
      tokenHash: 'hash',
      tokenEncrypted: 'encrypted',
      createdVia: 'ui',
      revokedAt: new Date(pastScheduledTime - 29 * DAY_MILLISECONDS),
    })
    await testDb.db.insert(schema.artifactStorage).values({
      artifactId,
      viewerUserId: viewerId,
      key: 'progress',
      value: 1,
      bytes: 1,
    })

    const { set, createLogger } = createLoggerDouble()
    const { runArtifactStorageSweepJob } = await importSweep()

    await runArtifactStorageSweepJob({
      controller: { cron: HOURLY_CRON, scheduledTime: pastScheduledTime },
      createLogger,
      db: testDb.db,
    })

    expect(set).toHaveBeenCalledWith({
      attributes: {
        artifactStorageSweep: { cron: HOURLY_CRON, deleted: 0 },
      },
    })
    await expect(testDb.db.select().from(schema.artifactStorage))
      .resolves.toHaveLength(1)
  })

  it('ships the wide event it emits', async () => {
    const wideEvent = { status: 200 }
    const shipWideEvent = vi.fn().mockResolvedValue(undefined)
    const { createLogger } = createLoggerDouble(wideEvent)
    const { runArtifactStorageSweepJob } = await importSweep()

    await runArtifactStorageSweepJob({
      controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      shipWideEvent,
      db: testDb.db,
    })

    expect(shipWideEvent).toHaveBeenCalledWith(wideEvent)
  })

  it('logs the error and emits 500 when the delete fails', async () => {
    const failingDb = {
      delete: () => {
        throw new Error('d1 unavailable\nparams: secret-key')
      },
    }
    const { set, emit, createLogger } = createLoggerDouble()
    const { runArtifactStorageSweepJob } = await importSweep()

    await runArtifactStorageSweepJob({
      controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: failingDb as never,
    })

    expect(set).toHaveBeenCalledWith({
      attributes: { artifactStorageSweep: { error: 'd1 unavailable' } },
    })
    expect(emit).toHaveBeenCalledWith({ status: 500 })
  })

  describe('cloudflare:scheduled hook', () => {
    async function registerPlugin() {
      const hook = vi.fn()
      const { default: plugin } = await importSweep()

      ;(plugin as unknown as (app: unknown) => void)({ hooks: { hook } })

      expect(hook).toHaveBeenCalledWith(
        'cloudflare:scheduled',
        expect.any(Function),
      )

      return hook.mock.calls[0]![1] as (
        context: { controller: { cron: string, scheduledTime: number } },
      ) => Promise<void>
    }

    it('ignores other cron schedules', async () => {
      const useDb = vi.fn(() => testDb.db)

      vi.stubGlobal('useDb', useDb)
      await seedOrphanedRow('kept')

      const handler = await registerPlugin()

      await handler({
        controller: { cron: '*/5 * * * *', scheduledTime: SCHEDULED_TIME },
      })

      expect(useDb).not.toHaveBeenCalled()
      await expect(testDb.db.select().from(schema.artifactStorage))
        .resolves.toHaveLength(1)
    })

    it('runs the sweep on the hourly cron', async () => {
      const useDb = vi.fn(() => testDb.db)

      vi.stubGlobal('useDb', useDb)
      await seedOrphanedRow('purged')

      const handler = await registerPlugin()

      await handler({
        controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      })

      expect(useDb).toHaveBeenCalled()
      await expect(testDb.db.select().from(schema.artifactStorage))
        .resolves.toEqual([])
    })
  })
})
