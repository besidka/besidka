import { readdirSync, readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { purgeUserGoogleConnections } from '~~/server/utils/account/purge-google-connections'

const migrationsDirectory = new URL(
  '../../../../.drizzle/migrations/',
  import.meta.url,
)

function readGoogleConnectionsStatements(): string[] {
  const directory = readdirSync(migrationsDirectory).find((name) => {
    return readFileSync(
      new URL(`${name}/migration.sql`, migrationsDirectory),
      'utf8',
    ).includes('CREATE TABLE `google_connections`')
  })

  if (!directory) {
    throw new Error('google_connections migration not found')
  }

  return readFileSync(
    new URL(`${directory}/migration.sql`, migrationsDirectory),
    'utf8',
  )
    .split('--> statement-breakpoint')
    .filter((statement) => {
      return statement.includes('`google_connections`')
    })
}

const createdAt = 1_762_560_000

describe('purgeUserGoogleConnections', () => {
  let sqlite: InstanceType<typeof Database>
  let database: ReturnType<typeof drizzle>

  beforeEach(() => {
    sqlite = new Database(':memory:')

    for (const statement of readGoogleConnectionsStatements()) {
      sqlite.exec(statement)
    }

    database = drizzle({ client: sqlite })
    sqlite.exec(`
      insert into google_connections
        (user_id, client_mode, granted_scopes, status, created_at, updated_at)
        values
          (7, 'besidka', '[]', 'active', ${createdAt}, ${createdAt}),
          (7, 'byo', '[]', 'needs_reauth', ${createdAt}, ${createdAt}),
          (8, 'besidka', '[]', 'active', ${createdAt}, ${createdAt});
    `)
  })

  afterEach(() => {
    sqlite.close()
  })

  it('deletes every connection of the user and reports the count', async () => {
    const result = await purgeUserGoogleConnections(7, database as never)

    expect(result).toEqual({ googleConnectionsDeleted: 2 })
    expect(sqlite.prepare(
      'select user_id as userId, client_mode as clientMode from google_connections',
    ).all()).toEqual([{ userId: 8, clientMode: 'besidka' }])
  })

  it('reports zero when the user has no connection', async () => {
    const result = await purgeUserGoogleConnections(99, database as never)

    expect(result).toEqual({ googleConnectionsDeleted: 0 })
    expect(sqlite.prepare(
      'select count(*) as total from google_connections',
    ).get()).toEqual({ total: 3 })
  })

  it('revokes the stored grants before it deletes the rows', async () => {
    const order: string[] = []
    const revoke = vi.fn(async () => {
      const remaining = sqlite.prepare(
        'select count(*) as total from google_connections where user_id = 7',
      ).get() as { total: number }

      order.push(`revoke:${remaining.total}`)

      return { attempted: 2, revoked: 1 }
    })
    const logger = { set: vi.fn() }

    await purgeUserGoogleConnections(7, database as never, { revoke, logger })

    expect(revoke).toHaveBeenCalledWith(database, 7)
    expect(order).toEqual(['revoke:2'])
    expect(logger.set).toHaveBeenCalledWith({
      attributes: { googlePurge: { revokeAttempted: 2, revoked: 1 } },
    })
  })

  it('still deletes the rows when Google revokes nothing', async () => {
    const revoke = vi.fn(async () => ({ attempted: 2, revoked: 0 }))
    const result = await purgeUserGoogleConnections(7, database as never, {
      revoke,
    })

    expect(result).toEqual({ googleConnectionsDeleted: 2 })
  })

  it('keeps one connection per user and client mode', () => {
    expect(() => {
      sqlite.exec(`
        insert into google_connections
          (user_id, client_mode, granted_scopes, status, created_at, updated_at)
          values (7, 'besidka', '[]', 'active', ${createdAt}, ${createdAt});
      `)
    }).toThrow(/UNIQUE/)
  })
})
