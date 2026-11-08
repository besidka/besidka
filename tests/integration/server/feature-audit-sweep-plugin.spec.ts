import { describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'

vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)

const {
  FEATURE_AUDIT_SWEEP_BATCH_SIZE,
  FEATURE_AUDIT_SWEEP_MAX_BATCHES,
  runFeatureAuditSweepJob,
} = await import('~~/server/plugins/feature-audit-sweep')

const SCHEDULED_TIME = Date.UTC(2026, 10, 8, 12, 0, 0)
const RETENTION_CUTOFF_SECONDS = (SCHEDULED_TIME / 1000) - 365 * 24 * 60 * 60

interface BuiltQuery {
  toSQL: () => { sql: string, params: unknown[] }
}

function createSweepDb(batches: number[], error?: Error) {
  const db = drizzle({} as never)
  const remaining = [...batches]
  const executed: BuiltQuery[] = []
  const realDelete = db.delete.bind(db)

  Object.assign(db, {
    delete: (table: Parameters<typeof realDelete>[0]) => {
      const builder = realDelete(table)
      const realWhere = builder.where.bind(builder)

      return Object.assign(builder, {
        where: (condition: Parameters<typeof realWhere>[0]) => {
          const query = realWhere(condition)
          const realReturning = query.returning.bind(query)

          return Object.assign(query, {
            returning: (...fields: Parameters<typeof realReturning>) => {
              const returning = realReturning(...fields)

              return Object.assign(returning, {
                then: (resolve: (rows: unknown[]) => unknown) => {
                  executed.push(returning as unknown as BuiltQuery)

                  if (error) {
                    throw error
                  }

                  const count = remaining.shift() ?? 0

                  return Promise.resolve(
                    Array.from({ length: count }, (_value, index) => {
                      return { id: index + 1 }
                    }),
                  ).then(resolve)
                },
              })
            },
          })
        },
      })
    },
  })

  return { db, executed }
}

function createLogger() {
  const fields: Record<string, any>[] = []
  const logger = {
    set: vi.fn((value: Record<string, any>) => {
      fields.push(value)
    }),
    emit: vi.fn(() => null),
  }

  return { logger, fields }
}

async function runSweep(db: unknown) {
  const { logger, fields } = createLogger()

  await runFeatureAuditSweepJob({
    controller: { cron: '0 * * * *', scheduledTime: SCHEDULED_TIME },
    createLogger: (() => logger) as never,
    shipWideEvent: vi.fn(),
    db: db as never,
  })

  return { logger, fields }
}

describe('feature audit sweep', () => {
  it('deletes rows older than 365 days in bounded batches', async () => {
    const { db, executed } = createSweepDb([
      FEATURE_AUDIT_SWEEP_BATCH_SIZE,
      FEATURE_AUDIT_SWEEP_BATCH_SIZE,
      3,
    ])

    const { logger, fields } = await runSweep(db)

    expect(executed).toHaveLength(3)

    const { sql, params } = executed[0]!.toSQL()

    expect(sql).toContain('delete from "feature_audit_log"')
    expect(sql).toContain('"created_at" < ?')
    expect(params).toContain(RETENTION_CUTOFF_SECONDS)
    expect(params).toContain(FEATURE_AUDIT_SWEEP_BATCH_SIZE)
    expect(fields).toContainEqual({
      attributes: {
        featureAuditSweep: { deleted: FEATURE_AUDIT_SWEEP_BATCH_SIZE * 2 + 3 },
      },
    })
    expect(logger.emit).toHaveBeenCalledWith({ status: 200 })
  })

  it('stops after the batch cap', async () => {
    const { db, executed } = createSweepDb(
      Array.from({ length: FEATURE_AUDIT_SWEEP_MAX_BATCHES + 2 }, () => {
        return FEATURE_AUDIT_SWEEP_BATCH_SIZE
      }),
    )

    await runSweep(db)

    expect(executed).toHaveLength(FEATURE_AUDIT_SWEEP_MAX_BATCHES)
  })

  it('reports a failure with status 500', async () => {
    const { db } = createSweepDb([], new Error('d1 down'))

    const { logger, fields } = await runSweep(db)

    expect(fields).toContainEqual({
      attributes: { featureAuditSweep: { error: 'd1 down' } },
    })
    expect(logger.emit).toHaveBeenCalledWith({ status: 500 })
  })
})
