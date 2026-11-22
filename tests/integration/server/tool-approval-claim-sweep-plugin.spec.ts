import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const SCHEDULED_TIME = Date.UTC(2026, 10, 15, 12, 0, 0)
const HOURLY_CRON = '0 * * * *'
const HOUR_MS = 60 * 60 * 1000

function createLoggerDouble() {
  const set = vi.fn()
  const emit = vi.fn().mockReturnValue(undefined)
  const createLogger = vi.fn().mockReturnValue({ set, emit })

  return { set, emit, createLogger }
}

async function importSweep() {
  return import('../../../server/plugins/tool-approval-claim-sweep')
}

describe('tool approval claim sweep plugin', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let chatId: string

  async function seedClaim(approvalId: string, hoursOld: number) {
    await testDb.db.insert(schema.toolApprovalClaims).values({
      approvalId,
      userId,
      chatPublicId: chatId,
      messagePublicId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      status: 'done',
      createdAt: new Date(SCHEDULED_TIME - hoursOld * HOUR_MS),
    })
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    chatId = (await seedChat(testDb.db, userId)).id
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('deletes claims older than 48 hours and emits 200', async () => {
    await seedClaim('approval_old', 50)
    await seedClaim('approval_new', 2)

    const { set, emit, createLogger } = createLoggerDouble()
    const { runToolApprovalClaimSweepJob } = await importSweep()

    await runToolApprovalClaimSweepJob({
      controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: testDb.db,
    })

    expect(createLogger).toHaveBeenCalledWith({
      method: 'CRON',
      path: '/internal/jobs/tool-approval-claim-sweep',
      requestId: `tool-approval-claim-sweep-${SCHEDULED_TIME}`,
    })
    expect(set).toHaveBeenCalledWith({
      attributes: {
        toolApprovalClaimSweep: { cron: HOURLY_CRON, deleted: 1 },
      },
    })
    expect(emit).toHaveBeenCalledWith({ status: 200 })

    const remaining = await testDb.db.select()
      .from(schema.toolApprovalClaims)

    expect(remaining.map(claim => claim.approvalId))
      .toEqual(['approval_new'])
  })

  it('emits 500 and logs the error when the database fails', async () => {
    const failingDb = {
      select: () => {
        throw new Error('d1 down')
      },
    }
    const { set, emit, createLogger } = createLoggerDouble()
    const { runToolApprovalClaimSweepJob } = await importSweep()

    await runToolApprovalClaimSweepJob({
      controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: failingDb as never,
    })

    expect(set).toHaveBeenCalledWith({
      attributes: { toolApprovalClaimSweep: { error: 'd1 down' } },
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
