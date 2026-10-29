import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: mocks.loggerSet }),
}))

vi.mock('evlog', () => ({
  createError: (input: { message?: string, status?: number }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

interface BuiltQuery {
  toSQL: () => { sql: string, params: unknown[] }
}

type DeletedRows = [
  Array<{ id: number }>,
  Array<{ scopes: unknown }>,
  Array<{ scopes: unknown }>,
]

function createDb(deletedRows: DeletedRows = [[], [], []]) {
  const db = drizzle({} as never)
  const batch = vi.fn(async (_queries: BuiltQuery[]) => deletedRows)

  Object.assign(db, { batch })

  return { db, batch }
}

async function getRevokeHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/connected-apps/[clientId]/revoke.post'
  )

  return module.default
}

function revokeEvent(clientId: string) {
  return {
    context: {},
    params: { clientId },
  } as any
}

describe('connected apps revoke API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('assertNotCrossSiteRequest', vi.fn())
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
    vi.stubGlobal('setResponseStatus', (
      _event: unknown,
      code: number,
    ) => {
      return { code }
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '5' },
      session: { token: 'session-token' },
    }))
  })

  it('returns 401 without a session', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))
    vi.stubGlobal('useDb', () => createDb().db)

    const handler = await getRevokeHandler()

    await expect(handler(revokeEvent('client-1')))
      .rejects.toMatchObject({ status: 401 })
  })

  it('returns 404 when the user has no grant of any kind for the app',
    async () => {
      const { db } = createDb([[], [], []])

      vi.stubGlobal('useDb', () => db)

      const handler = await getRevokeHandler()

      await expect(handler(revokeEvent('client-1')))
        .rejects.toMatchObject({ status: 404 })
    })

  it('revokes a live grant whose consent row was already deleted',
    async () => {
      const { db } = createDb([
        [{ id: 1 }],
        [{ scopes: ['openid', 'chats:read'] }],
        [],
      ])

      vi.stubGlobal('useDb', () => db)

      const handler = await getRevokeHandler()
      const response = await handler(revokeEvent('client-1'))

      expect(response).toEqual({ code: 204 })
      expect(mocks.loggerSet).toHaveBeenCalledWith({
        userId: 5,
        attributes: {
          legalConsent: {
            action: 'oauth_revoked',
            oauthClientId: 'client-1',
            scopes: ['openid', 'chats:read'],
          },
        },
      })
    })

  it('deletes access tokens, refresh tokens and the consent for that app',
    async () => {
      const { db, batch } = createDb([
        [{ id: 1 }],
        [{ scopes: ['openid'] }],
        [{ scopes: ['openid', 'chats:read'] }],
      ])

      vi.stubGlobal('useDb', () => db)

      const handler = await getRevokeHandler()
      const response = await handler(revokeEvent('client-1'))
      const statements = batch.mock.calls[0]![0].map((query) => {
        return query.toSQL()
      })

      expect(response).toEqual({ code: 204 })
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
        expect(statement.sql).toContain('"client_id" = ?')
        expect(statement.sql).toContain('returning')
        expect(statement.params).toEqual([5, 'client-1'])
      }
    })

  it('surfaces a failed delete as a 500', async () => {
    const { db, batch } = createDb()

    batch.mockRejectedValueOnce(new Error('d1 unavailable'))
    vi.stubGlobal('useDb', () => db)

    const handler = await getRevokeHandler()

    await expect(handler(revokeEvent('client-1')))
      .rejects.toMatchObject({ status: 500 })
  })

  it('logs the revocation as a legal consent event without tokens',
    async () => {
      const { db } = createDb([
        [],
        [],
        [{ scopes: ['openid', 'memory:write'] }],
      ])

      vi.stubGlobal('useDb', () => db)

      const handler = await getRevokeHandler()

      await handler(revokeEvent('client-1'))

      expect(mocks.loggerSet).toHaveBeenCalledWith({
        userId: 5,
        attributes: {
          legalConsent: {
            action: 'oauth_revoked',
            oauthClientId: 'client-1',
            scopes: ['openid', 'memory:write'],
          },
        },
      })
      expect(JSON.stringify(mocks.loggerSet.mock.calls))
        .not.toContain('session-token')
    })
})
