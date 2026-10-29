import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'

const SCHEDULED_TIME = Date.UTC(2026, 9, 29, 12, 0, 0)
const ONE_DAY_SECONDS = 24 * 60 * 60

interface BuiltQuery {
  toSQL: () => { sql: string, params: unknown[] }
}

function rowsOf(count: number) {
  return Array.from({ length: count }, (_value, index) => {
    return { id: index + 1 }
  })
}

function makeThenable<Query extends object>(
  query: Query,
  resolveRows: () => unknown[],
): Query {
  return Object.assign(query, {
    then: (
      resolve: (rows: unknown[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      return Promise.resolve(resolveRows()).then(resolve, reject)
    },
  })
}

function createSweepDb(options: {
  accessTokenBatches?: number[]
  refreshTokenBatches?: number[]
  clientBatches?: number[]
  clientDeleteError?: Error
} = {}) {
  const db = drizzle({} as never)
  const accessTokenBatches = [...(options.accessTokenBatches ?? [0])]
  const refreshTokenBatches = [...(options.refreshTokenBatches ?? [0])]
  const clientBatches = [...(options.clientBatches ?? [0])]
  const executed: BuiltQuery[] = []
  const realDelete = db.delete.bind(db)
  const realSelect = db.select.bind(db)
  const batch = vi.fn(async (queries: BuiltQuery[]) => {
    executed.push(...queries)

    return [rowsOf(0), rowsOf(refreshTokenBatches.shift() ?? 0)]
  })

  Object.assign(db, {
    batch,
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
              const tableName = /delete from "(\w+)"/.exec(
                (returning as unknown as BuiltQuery).toSQL().sql,
              )?.[1]

              return makeThenable(returning, () => {
                executed.push(returning as unknown as BuiltQuery)

                if (
                  tableName === 'oauth_clients'
                  && options.clientDeleteError
                ) {
                  throw options.clientDeleteError
                }

                return rowsOf(tableName === 'oauth_clients'
                  ? clientBatches.shift() ?? 0
                  : accessTokenBatches.shift() ?? 0)
              })
            },
          })
        },
      })
    },
    select: (...args: Parameters<typeof realSelect>) => {
      const builder = realSelect(...args)
      const realFrom = builder.from.bind(builder)

      return Object.assign(builder, {
        from: (...fromArgs: Parameters<typeof realFrom>) => {
          const query = realFrom(...fromArgs)
          const realWhere = query.where.bind(query)

          return Object.assign(query, {
            where: (condition: Parameters<typeof realWhere>[0]) => {
              const filtered = realWhere(condition)
              const realOrderBy = filtered.orderBy.bind(filtered)

              return Object.assign(filtered, {
                orderBy: (...orderArgs: Parameters<typeof realOrderBy>) => {
                  const ordered = realOrderBy(...orderArgs)
                  const realLimit = ordered.limit.bind(ordered)

                  return Object.assign(ordered, {
                    limit: (limit: number) => {
                      const limited = realLimit(limit)

                      return makeThenable(limited, () => {
                        executed.push(limited as unknown as BuiltQuery)

                        return rowsOf(clientBatches[0] ?? 0)
                      })
                    },
                  })
                },
              })
            },
          })
        },
      })
    },
  })

  return { db, batch, executed }
}

function createLoggerDouble() {
  const set = vi.fn()
  const emit = vi.fn()
  const createLogger = vi.fn().mockReturnValue({ set, emit })

  return { set, emit, createLogger }
}

async function importSweep() {
  return import('../../../server/plugins/oauth-grant-sweep')
}

describe('oauth grant sweep plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
  })

  it('logs zero counts and emits 200 on an empty database', async () => {
    const { db } = createSweepDb()
    const { set, emit, createLogger } = createLoggerDouble()
    const { runOAuthGrantSweepJob } = await importSweep()

    await runOAuthGrantSweepJob({
      controller: { cron: '0 * * * *', scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: db as never,
    })

    expect(set).toHaveBeenCalledWith({
      attributes: {
        oauthSweep: {
          deletedAccessTokens: 0,
          deletedRefreshTokens: 0,
          deletedClients: 0,
        },
      },
    })
    expect(emit).toHaveBeenCalledWith({ status: 200 })
  })

  it('keeps deleting full batches and stops at a short one', async () => {
    const { db } = createSweepDb({
      accessTokenBatches: [100, 100, 3],
      refreshTokenBatches: [100, 2],
    })
    const { set, createLogger } = createLoggerDouble()
    const { runOAuthGrantSweepJob } = await importSweep()

    await runOAuthGrantSweepJob({
      controller: { cron: '0 * * * *', scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: db as never,
    })

    expect(set).toHaveBeenCalledWith({
      attributes: {
        oauthSweep: {
          deletedAccessTokens: 203,
          deletedRefreshTokens: 102,
          deletedClients: 0,
        },
      },
    })
  })

  it('bounds every delete with a LIMIT subquery', async () => {
    const { db, executed } = createSweepDb()
    const { createLogger } = createLoggerDouble()
    const { runOAuthGrantSweepJob } = await importSweep()

    await runOAuthGrantSweepJob({
      controller: { cron: '0 * * * *', scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: db as never,
    })

    const statements = executed.map((query) => {
      return query.toSQL()
    })
    const deletes = statements.filter((statement) => {
      return statement.sql.startsWith('delete from')
    })

    expect(deletes.length).toBeGreaterThanOrEqual(3)

    for (const statement of deletes) {
      expect(statement.sql).toContain('limit')
    }
  })

  it('deletes access tokens of stale refresh tokens first, in one batch',
    async () => {
      const { db, batch } = createSweepDb()
      const { createLogger } = createLoggerDouble()
      const { runOAuthGrantSweepJob } = await importSweep()

      await runOAuthGrantSweepJob({
        controller: { cron: '0 * * * *', scheduledTime: SCHEDULED_TIME },
        createLogger,
        db: db as never,
      })

      const [firstBatch] = batch.mock.calls[0]!
      const tables = firstBatch && batch.mock.calls[0]![0].map((query) => {
        return /delete from "(\w+)"/.exec(query.toSQL().sql)?.[1]
      })

      expect(tables).toEqual(['oauth_access_tokens', 'oauth_refresh_tokens'])
      expect(batch.mock.calls[0]![0][0]!.toSQL().sql)
        .toContain('"refresh_id" in (select "id" from "oauth_refresh_tokens"')
    })

  it('uses a one-day cutoff for tokens and a seven-day cutoff for clients',
    async () => {
      const { db, executed } = createSweepDb()
      const { createLogger } = createLoggerDouble()
      const { runOAuthGrantSweepJob } = await importSweep()

      await runOAuthGrantSweepJob({
        controller: { cron: '0 * * * *', scheduledTime: SCHEDULED_TIME },
        createLogger,
        db: db as never,
      })

      const nowSeconds = SCHEDULED_TIME / 1000
      const params = executed.flatMap((query) => {
        return query.toSQL().params
      })

      expect(params).toContain(nowSeconds - ONE_DAY_SECONDS)
      expect(params).toContain(nowSeconds - 7 * ONE_DAY_SECONDS)
    })

  it('only targets owner-less clients with no consent and no tokens',
    async () => {
      const { db, executed } = createSweepDb()
      const { createLogger } = createLoggerDouble()
      const { runOAuthGrantSweepJob } = await importSweep()

      await runOAuthGrantSweepJob({
        controller: { cron: '0 * * * *', scheduledTime: SCHEDULED_TIME },
        createLogger,
        db: db as never,
      })

      const clientSelect = executed.map((query) => {
        return query.toSQL().sql
      }).find((sql) => {
        return sql.startsWith('select') && sql.includes('from "oauth_clients"')
      })

      expect(clientSelect).toContain('"oauth_clients"."user_id" is null')
      expect(clientSelect).toContain('not exists (select 1 from "oauth_consents"')
      expect(clientSelect)
        .toContain('not exists (select 1 from "oauth_refresh_tokens"')
      expect(clientSelect)
        .toContain('not exists (select 1 from "oauth_access_tokens"')
    })

  it('logs the error and emits 500 when a delete fails', async () => {
    const { db, batch } = createSweepDb()
    const { set, emit, createLogger } = createLoggerDouble()
    const { runOAuthGrantSweepJob } = await importSweep()

    batch.mockRejectedValueOnce(new Error('d1 unavailable'))

    await runOAuthGrantSweepJob({
      controller: { cron: '0 * * * *', scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: db as never,
    })

    expect(set).toHaveBeenCalledWith({
      attributes: { oauthSweep: { error: 'd1 unavailable' } },
    })
    expect(emit).toHaveBeenCalledWith({ status: 500 })
  })

  it('caps the owner-less client select at 50 ids for the D1 limit',
    async () => {
      const { db, executed } = createSweepDb()
      const { createLogger } = createLoggerDouble()
      const { runOAuthGrantSweepJob, OAUTH_SWEEP_CLIENT_BATCH_SIZE }
        = await importSweep()

      await runOAuthGrantSweepJob({
        controller: { cron: '0 * * * *', scheduledTime: SCHEDULED_TIME },
        createLogger,
        db: db as never,
      })

      const clientSelect = executed.map((query) => {
        return query.toSQL()
      }).find((statement) => {
        return statement.sql.startsWith('select')
          && statement.sql.includes('from "oauth_clients"')
      })

      expect(OAUTH_SWEEP_CLIENT_BATCH_SIZE).toBe(50)
      expect(clientSelect!.params).toContain(OAUTH_SWEEP_CLIENT_BATCH_SIZE)
    })

  it('keeps the run successful when the clients step hits a FK error',
    async () => {
      const { db } = createSweepDb({
        accessTokenBatches: [4],
        clientBatches: [2],
        clientDeleteError: new Error('FOREIGN KEY constraint failed'),
      })
      const { set, emit, createLogger } = createLoggerDouble()
      const { runOAuthGrantSweepJob } = await importSweep()

      await runOAuthGrantSweepJob({
        controller: { cron: '0 * * * *', scheduledTime: SCHEDULED_TIME },
        createLogger,
        db: db as never,
      })

      expect(set).toHaveBeenCalledWith({
        attributes: {
          oauthSweep: { clientsError: 'FOREIGN KEY constraint failed' },
        },
      })
      expect(set).toHaveBeenCalledWith({
        attributes: {
          oauthSweep: {
            deletedAccessTokens: 4,
            deletedRefreshTokens: 0,
            deletedClients: 0,
          },
        },
      })
      expect(emit).toHaveBeenCalledWith({ status: 200 })
    })
})
