import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'

const mocks = vi.hoisted(() => {
  return { logError: vi.fn() }
})

vi.mock('evlog', async (importOriginal) => {
  const original = await importOriginal<typeof import('evlog')>()

  return {
    ...original,
    log: { ...original.log, error: mocks.logError },
  }
})

interface BuiltQuery {
  toSQL: () => { sql: string, params: unknown[] }
}

function createDb() {
  const db = drizzle({} as never)
  const batch = vi.fn(async (_queries: BuiltQuery[]) => [])

  Object.assign(db, { batch })

  return { db, batch }
}

async function importRevoke() {
  return import('../../../../server/utils/account/revoke-user-oauth-grants')
}

describe('revokeUserOAuthGrants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes access tokens, refresh tokens and consents in one batch',
    async () => {
      const { db, batch } = createDb()

      vi.stubGlobal('useDb', () => db)

      const { revokeUserOAuthGrants } = await importRevoke()
      const result = await revokeUserOAuthGrants({
        userId: 42,
        trigger: 'reset-password',
        logger: { set: vi.fn() },
      })
      const statements = batch.mock.calls[0]![0].map((query) => {
        return query.toSQL()
      })

      expect(result).toBe(true)
      expect(batch).toHaveBeenCalledTimes(1)
      expect(statements.map((statement) => {
        return /delete from "(\w+)"/.exec(statement.sql)?.[1]
      })).toEqual([
        'oauth_access_tokens',
        'oauth_refresh_tokens',
        'oauth_consents',
      ])

      for (const statement of statements) {
        expect(statement.sql).toContain('"user_id" = ?')
        expect(statement.sql).not.toContain('oauth_clients')
        expect(statement.params).toEqual([42])
      }
    })

  it('logs the revocation with its trigger and no token data', async () => {
    const { db } = createDb()
    const logger = { set: vi.fn() }

    vi.stubGlobal('useDb', () => db)

    const { revokeUserOAuthGrants } = await importRevoke()

    await revokeUserOAuthGrants({
      userId: 42,
      trigger: 'change-password',
      logger,
    })

    expect(logger.set).toHaveBeenCalledWith({
      userId: 42,
      attributes: {
        legalConsent: {
          action: 'oauth_revoked_all',
          trigger: 'change-password',
        },
      },
    })
  })

  it('retries the batch once and succeeds without an alert', async () => {
    const { db, batch } = createDb()
    const logger = { set: vi.fn() }

    batch.mockRejectedValueOnce(new Error('d1 unavailable'))
    vi.stubGlobal('useDb', () => db)

    const { revokeUserOAuthGrants } = await importRevoke()
    const result = await revokeUserOAuthGrants({
      userId: 42,
      trigger: 'revoke-sessions',
      logger,
    })

    expect(result).toBe(true)
    expect(batch).toHaveBeenCalledTimes(2)
    expect(mocks.logError).not.toHaveBeenCalled()
    expect(logger.set).toHaveBeenCalledWith({
      userId: 42,
      attributes: {
        legalConsent: {
          action: 'oauth_revoked_all',
          trigger: 'revoke-sessions',
        },
      },
    })
  })

  it('alerts and reports false after the retry also fails', async () => {
    const { db, batch } = createDb()
    const logger = { set: vi.fn() }
    const legalConsent = {
      action: 'oauth_revoke_all_failed',
      trigger: 'revoke-sessions',
      attempts: 2,
      error: 'd1 unavailable',
    }

    batch.mockRejectedValue(new Error('d1 unavailable'))
    vi.stubGlobal('useDb', () => db)

    const { revokeUserOAuthGrants } = await importRevoke()
    const result = await revokeUserOAuthGrants({
      userId: 42,
      trigger: 'revoke-sessions',
      logger,
    })

    expect(result).toBe(false)
    expect(batch).toHaveBeenCalledTimes(2)
    expect(logger.set).toHaveBeenCalledWith({
      userId: 42,
      attributes: { legalConsent },
    })
    expect(mocks.logError).toHaveBeenCalledWith({
      action: 'oauth_revoke_all_failed',
      alert: true,
      userId: 42,
      attributes: { legalConsent },
    })
  })

  it('also covers the owned clients for the account purge', async () => {
    const { db } = createDb()

    const { buildOAuthGrantDeletes } = await importRevoke()
    const deletes = buildOAuthGrantDeletes(db as never, 42, {
      includeOwnedClients: true,
    })
    const rendered = deletes.accessTokens.toSQL()

    expect(rendered.sql).toContain('"client_id" in (select "client_id"')
    expect(rendered.params).toEqual([42, 42])
  })
})
