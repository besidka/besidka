import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  CONNECTOR_AUDIT_PRUNE_BATCH,
  CONNECTOR_AUDIT_RETENTION_DAYS,
} from '#shared/utils/connectors-policy'
import {
  createMemoryExtractionTestDb,
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
const DAY_MS = 24 * 60 * 60 * 1000
const CONNECTOR_PUBLIC_ID = 'skl1'

function createLoggerDouble() {
  const set = vi.fn()
  const emit = vi.fn().mockReturnValue(undefined)
  const createLogger = vi.fn().mockReturnValue({ set, emit })

  return { set, emit, createLogger }
}

async function importPlugin() {
  return import('../../../server/plugins/connector-audit-prune')
}

describe('connector audit prune plugin', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  function auditRow(daysOld: number, toolName = 'search') {
    return {
      userId,
      connectorId: CONNECTOR_PUBLIC_ID,
      connectorHost: 'mcp.example.com',
      toolName,
      argsHmac: 'hmac',
      resultBytes: 12,
      outcome: 'ok' as const,
      approval: 'not-applicable' as const,
      path: 'worker' as const,
      durationMs: 40,
      createdAt: new Date(SCHEDULED_TIME - daysOld * DAY_MS),
    }
  }

  async function seedAuditRows(daysOlds: number[]) {
    for (const [index, daysOld] of daysOlds.entries()) {
      await testDb.db.insert(schema.connectorToolCalls)
        .values(auditRow(daysOld, `tool-${index}`))
    }
  }

  async function remainingToolNames() {
    const rows = await testDb.db.select({
      toolName: schema.connectorToolCalls.toolName,
    }).from(schema.connectorToolCalls)

    return rows.map(row => row.toolName).sort()
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('keeps the retention at 90 days', () => {
    expect(CONNECTOR_AUDIT_RETENTION_DAYS).toBe(90)
  })

  it('deletes rows at 91 days, keeps rows at 89 days and emits 200', async () => {
    await seedAuditRows([91, 89])

    const { set, emit, createLogger } = createLoggerDouble()
    const { runConnectorAuditPruneJob } = await importPlugin()

    await runConnectorAuditPruneJob({
      controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: testDb.db,
    })

    expect(createLogger).toHaveBeenCalledWith({
      method: 'CRON',
      path: '/internal/jobs/connector-audit-prune',
      requestId: `connector-audit-prune-${SCHEDULED_TIME}`,
    })
    expect(set).toHaveBeenCalledWith({
      attributes: {
        connectorAuditPrune: {
          cron: HOURLY_CRON,
          deleted: 1,
          batches: 1,
          truncated: false,
        },
      },
    })
    expect(emit).toHaveBeenCalledWith({ status: 200 })
    expect(await remainingToolNames()).toEqual(['tool-1'])
  })

  it('handles an empty table', async () => {
    const { set, emit, createLogger } = createLoggerDouble()
    const { runConnectorAuditPruneJob } = await importPlugin()

    await runConnectorAuditPruneJob({
      controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: testDb.db,
    })

    expect(set).toHaveBeenCalledWith({
      attributes: {
        connectorAuditPrune: {
          cron: HOURLY_CRON,
          deleted: 0,
          batches: 1,
          truncated: false,
        },
      },
    })
    expect(emit).toHaveBeenCalledWith({ status: 200 })
  })

  it('drains a backlog in full batches and stops at a short batch', async () => {
    const expiredCount = CONNECTOR_AUDIT_PRUNE_BATCH + 7

    await testDb.db.batch(
      Array.from({ length: expiredCount }, (_unused, index) => {
        return testDb.db.insert(schema.connectorToolCalls)
          .values(auditRow(91 + index / expiredCount, `old-${index}`))
      }) as never,
    )
    await seedAuditRows([10])

    const { pruneConnectorAuditRows } = await import(
      '~~/server/utils/connectors/audit-prune'
    )
    const result = await pruneConnectorAuditRows({
      db: testDb.db,
      now: new Date(SCHEDULED_TIME),
    })

    expect(result).toEqual({
      deleted: expiredCount,
      batches: 2,
      isTruncated: false,
    })
    expect(await remainingToolNames()).toEqual(['tool-0'])
  })

  it('stops when the runtime cap is spent and leaves the rest', async () => {
    const expiredCount = CONNECTOR_AUDIT_PRUNE_BATCH * 2 + 3

    await testDb.db.batch(
      Array.from({ length: expiredCount }, (_unused, index) => {
        return testDb.db.insert(schema.connectorToolCalls)
          .values(auditRow(91 + index / expiredCount, `old-${index}`))
      }) as never,
    )

    const clockReadingsMs = [0, 0, 5000, 20000]
    const readClockMs = vi.fn(() => clockReadingsMs.shift() ?? 20000)
    const { pruneConnectorAuditRows } = await import(
      '~~/server/utils/connectors/audit-prune'
    )
    const result = await pruneConnectorAuditRows({
      db: testDb.db,
      now: new Date(SCHEDULED_TIME),
      maxRuntimeMs: 10000,
      readClockMs,
    })

    expect(result).toEqual({
      deleted: CONNECTOR_AUDIT_PRUNE_BATCH * 2,
      batches: 2,
      isTruncated: true,
    })

    const rows = await testDb.db.select({
      id: schema.connectorToolCalls.id,
    }).from(schema.connectorToolCalls)

    expect(rows).toHaveLength(3)
  })

  it('emits 500 and logs the error when the database fails', async () => {
    const failingDb = {
      select: () => {
        throw new Error('d1 down')
      },
    }
    const { set, emit, createLogger } = createLoggerDouble()
    const { runConnectorAuditPruneJob } = await importPlugin()

    await runConnectorAuditPruneJob({
      controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: failingDb as never,
    })

    expect(set).toHaveBeenCalledWith({
      attributes: { connectorAuditPrune: { error: 'd1 down' } },
    })
    expect(emit).toHaveBeenCalledWith({ status: 500 })
  })

  it('registers a handler that ignores other crons', async () => {
    const hooks: Array<(payload: unknown) => Promise<void>> = []
    const plugin = (await importPlugin()).default as unknown as (
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
