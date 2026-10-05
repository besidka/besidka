import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import type { SQL } from 'drizzle-orm'
import * as schema from '../../../server/db/schema'

const sqlBuilder = drizzle({} as any)

const SCHEDULED_TIME = Date.UTC(2026, 9, 5, 12, 0, 0)
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000

function createSweepDb(deletedRows: { id: number }[]) {
  const returning = vi.fn(async () => deletedRows)
  const where = vi.fn(() => ({ returning }))
  const deleteFrom = vi.fn(() => ({ where }))

  return {
    db: { delete: deleteFrom },
    deleteFrom,
    where,
  }
}

function createLoggerDouble() {
  const set = vi.fn()
  const emit = vi.fn()
  const createLogger = vi.fn().mockReturnValue({ set, emit })

  return { set, emit, createLogger }
}

describe('push subscription sweep plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('deletes expired rows with one statement and logs the count', async () => {
    const { db, deleteFrom, where } = createSweepDb([{ id: 1 }, { id: 2 }])
    const { set, emit, createLogger } = createLoggerDouble()
    const { runPushSubscriptionSweepJob } = await import(
      '../../../server/plugins/push-subscription-sweep'
    )

    await runPushSubscriptionSweepJob({
      controller: { cron: '0 * * * *', scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: db as any,
    })

    expect(deleteFrom).toHaveBeenCalledTimes(1)
    expect(where).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith({
      attributes: { pushSweep: { deleted: 2 } },
    })
    expect(emit).toHaveBeenCalledWith({ status: 200 })
  })

  it('uses a 60 day cutoff for last_seen_at and the created_at fallback', async () => {
    const { db, where } = createSweepDb([])
    const { set, createLogger } = createLoggerDouble()
    const { runPushSubscriptionSweepJob } = await import(
      '../../../server/plugins/push-subscription-sweep'
    )

    await runPushSubscriptionSweepJob({
      controller: { cron: '0 * * * *', scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: db as any,
    })

    const expectedCutoffSeconds = Math.floor(
      (SCHEDULED_TIME - SIXTY_DAYS_MS) / 1000,
    )
    const rendered = sqlBuilder.delete(schema.pushSubscriptions)
      .where((where.mock.calls[0] as unknown[])[0] as SQL)
      .toSQL()

    expect(rendered.sql).toContain('"last_seen_at" <')
    expect(rendered.sql).toContain('"last_seen_at" is null')
    expect(rendered.sql).toContain('"created_at" <')
    expect(rendered.params).toEqual([
      expectedCutoffSeconds,
      expectedCutoffSeconds,
    ])
    expect(set).toHaveBeenCalledWith({
      attributes: {
        pushSweep: expect.objectContaining({
          cutoff: new Date(SCHEDULED_TIME - SIXTY_DAYS_MS).toISOString(),
        }),
      },
    })
  })

  it('keeps new wide-event paths under the attributes map field', async () => {
    const { db } = createSweepDb([{ id: 1 }])
    const { set, createLogger } = createLoggerDouble()
    const { runPushSubscriptionSweepJob } = await import(
      '../../../server/plugins/push-subscription-sweep'
    )

    await runPushSubscriptionSweepJob({
      controller: { cron: '0 * * * *', scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: db as any,
    })

    for (const call of set.mock.calls) {
      expect(Object.keys(call[0] as object)).toEqual(['attributes'])
    }
  })

  it('emits status 500 when the delete throws', async () => {
    const failingDb = {
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            throw new Error('d1 unavailable')
          }),
        })),
      })),
    }
    const { set, emit, createLogger } = createLoggerDouble()
    const { runPushSubscriptionSweepJob } = await import(
      '../../../server/plugins/push-subscription-sweep'
    )

    await runPushSubscriptionSweepJob({
      controller: { cron: '0 * * * *', scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: failingDb as any,
    })

    expect(set).toHaveBeenCalledWith({
      attributes: { pushSweep: { error: 'd1 unavailable' } },
    })
    expect(emit).toHaveBeenCalledWith({ status: 500 })
  })
})
