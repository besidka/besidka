import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { createFakeConnectorKv } from '../../setup/helpers/connectors-oauth'
import { createFakeBucket } from '../../setup/helpers/google-connections'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const SCHEDULED_TIME = Date.UTC(2026, 10, 22, 12, 0, 0)
const HOURLY_CRON = '0 * * * *'

function createLoggerDouble() {
  const set = vi.fn()
  const emit = vi.fn().mockReturnValue(undefined)
  const createLogger = vi.fn().mockReturnValue({ set, emit })

  return { set, emit, createLogger }
}

async function importSweep() {
  return import('../../../server/plugins/google-access-sweep')
}

describe('Google access sweep plugin', () => {
  let testDb: MemoryExtractionTestDb

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    vi.stubGlobal('useKV', () => createFakeConnectorKv())
    testDb = createMemoryExtractionTestDb()
    vi.stubGlobal('useDb', () => testDb.db)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('deletes copies left after access ended and emits 200', async () => {
    const userId = await seedUser(testDb.db, null)
    const bucket = createFakeBucket()

    await testDb.db.insert(schema.googleConnections).values({
      userId,
      clientMode: 'besidka',
      grantedScopes: [],
      status: 'needs_reauth',
    })
    await testDb.db.insert(schema.files).values({
      userId,
      storageKey: 'u/drive.pdf',
      name: 'Drive.pdf',
      size: 1,
      type: 'application/pdf',
      externalSource: 'google',
    })

    const { set, emit, createLogger } = createLoggerDouble()
    const { runGoogleAccessSweepJob } = await importSweep()

    await runGoogleAccessSweepJob({
      controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: testDb.db,
      storage: bucket,
    })

    expect(createLogger).toHaveBeenCalledWith({
      method: 'CRON',
      path: '/internal/jobs/google-access-sweep',
      requestId: `google-access-sweep-${SCHEDULED_TIME}`,
    })
    expect(set).toHaveBeenCalledWith({
      attributes: {
        googleAccessSweep: {
          cron: HOURLY_CRON,
          tokensCleared: 0,
          usersCleaned: 1,
          filesDeleted: 1,
          incompleteUsers: 0,
          revokedRowsDeleted: 0,
        },
      },
    })
    expect(emit).toHaveBeenCalledWith({ status: 200 })
    expect(bucket.deletedBatches[0]).toEqual(['u/drive.pdf'])
  })

  it('emits 500 and logs the error when the database fails', async () => {
    const failingDb = {
      update: () => {
        throw new Error('d1 down')
      },
    }
    const { set, emit, createLogger } = createLoggerDouble()
    const { runGoogleAccessSweepJob } = await importSweep()

    await runGoogleAccessSweepJob({
      controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: failingDb as never,
    })

    expect(set).toHaveBeenCalledWith({
      attributes: { googleAccessSweep: { error: 'd1 down' } },
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
