import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'

vi.mock('~~/server/utils/files/convert-files-for-ai', () => ({
  invalidateFileCache: vi.fn(),
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: vi.fn(),
}))

interface BuiltQuery {
  toSQL: () => { sql: string, params: unknown[] }
}

function createDb() {
  const db = drizzle({} as never)
  const batch = vi.fn(async (_queries: BuiltQuery[]) => [])

  Object.assign(db, { batch })

  return { db, batch }
}

async function importPurge() {
  return import('../../../../server/utils/account/purge-user-data')
}

describe('purgeUserOAuthData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes OAuth rows in foreign-key order in a single batch', async () => {
    const { db, batch } = createDb()

    vi.stubGlobal('useDb', () => db)

    const { purgeUserOAuthData } = await importPurge()

    await purgeUserOAuthData({ userId: 42, logger: { set: vi.fn() } })

    expect(batch).toHaveBeenCalledTimes(1)

    const statements = batch.mock.calls[0]![0].map((query) => {
      return query.toSQL()
    })
    const tables = statements.map((statement) => {
      return /delete from "(\w+)"/.exec(statement.sql)?.[1]
    })

    expect(tables).toEqual([
      'oauth_access_tokens',
      'oauth_refresh_tokens',
      'oauth_consents',
      'oauth_clients',
    ])
  })

  it('scopes every delete to the user and the clients the user owns',
    async () => {
      const { db, batch } = createDb()

      vi.stubGlobal('useDb', () => db)

      const { purgeUserOAuthData } = await importPurge()

      await purgeUserOAuthData({ userId: 42, logger: { set: vi.fn() } })

      const statements = batch.mock.calls[0]![0].map((query) => {
        return query.toSQL()
      })

      for (const statement of statements.slice(0, 3)) {
        expect(statement.sql).toContain('"user_id" = ?')
        expect(statement.sql).toMatch(
          /"client_id" in \(select "client_id" from "oauth_clients" where "oauth_clients"\."user_id" = \?\)/,
        )
        expect(statement.params).toEqual([42, 42])
      }

      expect(statements[3]!.sql).toContain('"user_id" = ?')
      expect(statements[3]!.params).toEqual([42])
    })

  it('rethrows a batch failure so the account deletion aborts', async () => {
    const { db, batch } = createDb()
    const logger = { set: vi.fn() }

    batch.mockRejectedValueOnce(new Error('d1 unavailable'))
    vi.stubGlobal('useDb', () => db)

    const { purgeUserOAuthData } = await importPurge()

    await expect(purgeUserOAuthData({ userId: 7, logger }))
      .rejects.toThrow('d1 unavailable')
    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      accountPurge: { phase: 'oauth-delete', userId: 7 },
    }))
  })
})
